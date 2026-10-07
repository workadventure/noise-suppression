"""Offline comparison of DTLN (prod TFLite) vs DeepFilterNet3 vs DPDFNet.

Run: .venv/bin/python run_eval.py   (writes out/*.wav, out/results.json)
Then: .venv/bin/python report.py     (writes out/results.md)
"""
import json, os, time, platform
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np
import soundfile as sf
import soxr
import librosa
import onnxruntime as ort
import torch
from pesq import pesq
from pystoi import stoi

torch.set_num_threads(1)
HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
REPO = HERE.parents[2]
CLIPS = REPO / "clips"
DTLN_DIR = REPO / "model"  # the production quantized DTLN models
SR = 48000
VBD = HERE / "vbd"  # VoiceBank+DEMAND test set (Valentini 2017, 48 kHz, CC-BY 4.0)
VBD_N, VBD_SAVE = 50, 6  # pairs evaluated, pairs whose WAVs are written


def load(path, sr=SR):
    x, fs = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    return soxr.resample(x, fs, sr).astype(np.float32) if fs != sr else x


def rs(x, a, b):
    return soxr.resample(x, a, b).astype(np.float32) if a != b else x


# ---------------- test set ----------------
def build_inputs():
    clean = load(CLIPS / "clean-voice.wav")
    sf.write(OUT / "clean-voice__ref48k.wav", clean, SR)
    sf.write(OUT / "clean-voice__ref16k.wav", rs(clean, SR, 16000), 16000)
    items = []
    for noise_name in ["pure-noise", "airconditioning", "white-noise-15s"]:
        n = load(CLIPS / f"{noise_name}.wav")
        n = np.tile(n, int(np.ceil(len(clean) / len(n))))[: len(clean)]
        for snr in (0, 5):
            g = np.sqrt(np.sum(clean**2) / (np.sum(n**2) * 10 ** (snr / 10)))
            mix = clean + g * n
            peak = np.max(np.abs(mix))
            s = 0.9 / peak if peak > 0.9 else 1.0  # same scale on mix and ref keeps SNR
            items.append(dict(name=f"mix_{noise_name}_{snr}dB", noisy=(mix * s).astype(np.float32),
                              clean=(clean * s).astype(np.float32), noise=noise_name, snr=snr))
    names = sorted(f.name for f in (VBD / "clean_testset_wav").glob("*.wav"))
    rng = np.random.default_rng(0)
    for i, f in enumerate(sorted(rng.choice(names, VBD_N, replace=False))):
        items.append(dict(name=f"vbd_{f[:-4]}", noisy=load(VBD / "noisy_testset_wav" / f),
                          clean=load(VBD / "clean_testset_wav" / f), noise="vbd", snr=None, save=i < VBD_SAVE))
    for real in ["dog_barking_noisy", "restaurant_noisy", "trump_vs_helicopter"]:
        items.append(dict(name=real, noisy=load(CLIPS / f"{real}.wav"), clean=None, noise="real", snr=None))
    return items


# ---------------- models (all take/return 48 kHz float32, return (out, seconds)) ----------------
class DTLN:
    """Mirror of noise-suppression/src/runtime.ts infer(): 512/128, rfft mag -> m1 (mask, state) -> irfft -> m2 -> OLA."""
    sr = 16000

    def __init__(self):
        from ai_edge_litert.interpreter import Interpreter
        self.m = []
        for f in ("model_quant_1.tflite", "model_quant_2.tflite"):
            it = Interpreter(str(DTLN_DIR / f), num_threads=1)
            it.allocate_tensors()
            ins = sorted(it.get_input_details(), key=lambda d: d["index"])
            outs = sorted(it.get_output_details(), key=lambda d: d["index"])
            self.m.append((it, ins, outs))

    def run(self, x16):
        L, S = 512, 128
        (i1, in1, o1), (i2, in2, o2) = self.m
        s1 = np.zeros(in1[1]["shape"], np.float32)
        s2 = np.zeros(in2[1]["shape"], np.float32)
        inb = np.zeros(L, np.float32)
        outb = np.zeros(L, np.float32)
        n = len(x16) // S * S
        y = np.zeros(n, np.float32)
        for off in range(0, n, S):
            inb[:-S] = inb[S:]
            inb[-S:] = x16[off:off + S]
            spec = np.fft.rfft(inb)
            i1.set_tensor(in1[0]["index"], np.abs(spec).astype(np.float32).reshape(1, 1, -1))
            i1.set_tensor(in1[1]["index"], s1)
            i1.invoke()
            mask = i1.get_tensor(o1[0]["index"]).reshape(-1)
            s1 = i1.get_tensor(o1[1]["index"])
            est = np.fft.irfft(spec * mask, n=L).astype(np.float32)  # runtime.ts zeroes imag of DC/Nyquist: irfft ignores them too
            i2.set_tensor(in2[0]["index"], est.reshape(1, 1, -1))
            i2.set_tensor(in2[1]["index"], s2)
            i2.invoke()
            blk = i2.get_tensor(o2[0]["index"]).reshape(-1)
            s2 = i2.get_tensor(o2[1]["index"])
            outb[:-S] = outb[S:]
            outb[-S:] = 0
            outb += blk
            y[off:off + S] = outb[:S]
        return y

    def __call__(self, x48):
        x16 = rs(x48, SR, 16000)
        t = time.perf_counter()
        y16 = self.run(x16)
        dt = time.perf_counter() - t
        return rs(y16, 16000, SR), dt


class DFN3:
    def __init__(self):
        from df.enhance import init_df, enhance
        self.model, self.state, _ = init_df()  # default = DeepFilterNet3
        self.enhance = enhance

    def __call__(self, x48):
        t = time.perf_counter()
        y = self.enhance(self.model, self.state, torch.from_numpy(x48)[None]).squeeze(0).numpy()
        return y.astype(np.float32), time.perf_counter() - t


class DPDF:
    def __init__(self, name):
        import dpdfnet
        self.enh = dpdfnet.StreamEnhancer(model=name)
        self.sr = self.enh._model_sr
        self.hop = self.enh._hop_size

    def __call__(self, x48):
        x = rs(x48, SR, self.sr)
        self.enh.reset()
        t = time.perf_counter()
        parts = [self.enh.process(x[i:i + self.hop], sample_rate=self.sr) for i in range(0, len(x), self.hop)]
        parts.append(self.enh.flush())
        dt = time.perf_counter() - t
        y = np.concatenate(parts)[: len(x)]
        return rs(y, self.sr, SR), dt


# ---------------- metrics ----------------
class DNSMOS:
    """Replicates DNSMOS/dnsmos_local.py (non-personalized), 16 kHz, 9.01 s windows, 1 s hop."""

    def __init__(self):
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        self.p835 = ort.InferenceSession(str(HERE / "dnsmos/sig_bak_ovr.onnx"), so)
        self.p808 = ort.InferenceSession(str(HERE / "dnsmos/model_v8.onnx"), so)

    def __call__(self, a16):
        fs, L = 16000, 9.01
        n = int(L * fs)
        audio = a16.astype(np.float64)
        while len(audio) < n:
            audio = np.append(audio, audio)
        hops = int(np.floor(len(audio) / fs) - L) + 1
        r = {k: [] for k in ("SIG", "BAK", "OVRL", "P808")}
        for i in range(hops):
            seg = audio[i * fs: int((i + L) * fs)]
            if len(seg) < n:
                continue
            mel = librosa.feature.melspectrogram(y=seg[:-160], sr=fs, n_fft=321, hop_length=160, n_mels=120)
            mel = ((librosa.power_to_db(mel, ref=np.max) + 40) / 40).T
            r["P808"].append(self.p808.run(None, {"input_1": mel.astype(np.float32)[None]})[0][0][0])
            sig, bak, ovr = self.p835.run(None, {"input_1": seg.astype(np.float32)[None]})[0][0]
            r["SIG"].append(np.poly1d([-0.08397278, 1.22083953, 0.0052439])(sig))
            r["BAK"].append(np.poly1d([-0.13166888, 1.60915514, -0.39604546])(bak))
            r["OVRL"].append(np.poly1d([-0.06766283, 1.11546468, 0.04602535])(ovr))
        return {k: float(np.mean(v)) for k, v in r.items()}


def align(ref, est, max_lag):
    """Shift est so it best matches ref (cross-correlation), trim both to common length."""
    c = np.correlate(est, ref, mode="full")  # lag = index - (len(ref)-1)
    mid = len(ref) - 1
    lo, hi = max(0, mid - max_lag), min(len(c), mid + max_lag + 1)
    lag = int(np.argmax(c[lo:hi]) + lo - mid)
    est = est[lag:] if lag >= 0 else np.concatenate([np.zeros(-lag, est.dtype), est])
    n = min(len(ref), len(est))
    return ref[:n], est[:n], lag


def si_sdr(ref, est):
    ref = ref - ref.mean(); est = est - est.mean()
    a = np.dot(est, ref) / np.dot(ref, ref)
    t = a * ref
    return float(10 * np.log10(np.sum(t**2) / np.sum((est - t) ** 2)))


def hf_fraction(x48):
    P = np.abs(np.fft.rfft(x48)) ** 2
    f = np.fft.rfftfreq(len(x48), 1 / SR)
    return float(P[f > 8000].sum() / max(P.sum(), 1e-20))


def hf_lsd(ref48, est48):
    """Log-spectral distance (dB) restricted to 8-24 kHz, 20 ms frames: how well the >8 kHz band matches the clean one."""
    S = lambda x: np.abs(librosa.stft(x, n_fft=960, hop_length=480)) ** 2 + 1e-10
    f = np.fft.rfftfreq(960, 1 / SR) > 8000
    R, E = S(ref48)[f], S(est48)[f]
    return float(np.mean(np.sqrt(np.mean((10 * np.log10(R) - 10 * np.log10(E)) ** 2, axis=0))))


def loud_norm(x, target_dbfs=-26.0):
    rms = np.sqrt(np.mean(x**2)) + 1e-12
    y = x * 10 ** (target_dbfs / 20) / rms
    peak = np.max(np.abs(y))
    return (y * 0.99 / peak if peak > 0.99 else y).astype(np.float32), bool(peak > 0.99)


def main():
    items = build_inputs()
    models = {"dtln": DTLN(), "dfn3": DFN3(), "dpdfnet2_48khz_hr": DPDF("dpdfnet2_48khz_hr"),
              "dpdfnet2_16k": DPDF("dpdfnet2"), "dpdfnet8_48khz_hr": DPDF("dpdfnet8_48khz_hr")}
    mos = DNSMOS()
    rows, limited = [], []
    ref_dnsmos = mos(rs(items[0]["clean"], SR, 16000))
    for it in items:
        dur = len(it["noisy"]) / SR
        if it.get("save", True) and it["clean"] is not None and it["noise"] == "vbd":
            sf.write(OUT / f"{it['name']}__clean.wav", loud_norm(it["clean"])[0], SR)
        outs = {"noisy": (it["noisy"], 0.0)}
        for mname, m in models.items():
            m(it["noisy"][:SR])  # warm-up (not timed)
            outs[mname] = m(it["noisy"])
        for mname, (y, dt) in outs.items():
            y = np.nan_to_num(y)
            wav, lim = loud_norm(y)
            if lim:
                limited.append(f"{it['name']}__{mname}")
            if it.get("save", True):
                sf.write(OUT / f"{it['name']}__{mname}.wav", wav, SR)
            y16 = rs(y, SR, 16000)
            row = dict(clip=it["name"], model=mname, noise=it["noise"], snr=it["snr"], dur_s=dur,
                       proc_s=dt, rtf=dt / dur if mname != "noisy" else None, hf_frac_above_8k=hf_fraction(y))
            row.update(mos(y16))
            if it["clean"] is not None:
                c16 = rs(it["clean"], SR, 16000)
                c16a, y16a, lag = align(c16, y16, max_lag=1600)  # +-100 ms
                row.update(delay_ms=lag / 16, pesq_wb=float(pesq(16000, c16a, y16a, "wb")),
                           stoi=float(stoi(c16a, y16a, 16000, extended=False)), si_sdr=si_sdr(c16a, y16a))
                c48 = it["clean"]
                y48 = y[3 * lag:] if lag >= 0 else np.concatenate([np.zeros(-3 * lag, np.float32), y])
                n = min(len(c48), len(y48))
                row.update(hf_lsd_db=hf_lsd(c48[:n], y48[:n]), clean_hf_frac_above_8k=hf_fraction(c48))
            rows.append(row)
            print(json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in row.items()}), flush=True)
    import ai_edge_litert, df, dpdfnet, pesq as pq, pystoi
    from importlib.metadata import version
    meta = dict(
        clean_reference_dnsmos=ref_dnsmos, clean_ref_hf_frac_above_8k=hf_fraction(items[0]["clean"]),
        loudness_limited_files=limited, platform=platform.platform(), processor=platform.processor(),
        versions={p: version(p) for p in ["torch", "torchaudio", "deepfilternet", "deepfilterlib", "dpdfnet",
                                           "ai-edge-litert", "onnxruntime", "pesq", "pystoi", "numpy", "soxr", "librosa"]},
        input_sample_rates={f.name: sf.info(f).samplerate for f in sorted(CLIPS.glob("*.wav"))},
    )
    json.dump(dict(meta=meta, rows=rows), open(OUT / "results.json", "w"), indent=1)


if __name__ == "__main__":
    main()
