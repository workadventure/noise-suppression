"""Quality of DeepFilterNet3 and DeepFilterNet3_ll through this repository's libDF wasm, as the worklet runs them.

Same test set and metrics as ../fullband-denoisers/run_eval.py (50 random VoiceBank+DEMAND test pairs, seed 0;
PESQ-WB, STOI, SI-SDR, DNSMOS, LSD 8-24 kHz), with and without the 25 dB attenuation limit WorkAdventure uses.
Run from this directory (see README.md for the data):
    .venv/bin/python eval_quality.py ../../../forks/deepfilternet <dir with DeepFilterNet3_onnx.tar.gz and DeepFilterNet3_ll_onnx.tar.gz>
"""
import json, os, subprocess, sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np
import soundfile as sf
import soxr
import librosa
import onnxruntime as ort
from pesq import pesq
from pystoi import stoi

HERE = Path(__file__).parent
VBD = HERE / "vbd"
WORK = HERE / "work"
SR = 48000
VBD_N = 50
WASM, MODELS = Path(sys.argv[1]), Path(sys.argv[2])
CONFIGS = [  # (name, model file, attenuation limit dB)
    ("dfn3_nolimit", "DeepFilterNet3_onnx.tar.gz", 100),
    ("dfn3ll_nolimit", "DeepFilterNet3_ll_onnx.tar.gz", 100),
    ("dfn3_25dB", "DeepFilterNet3_onnx.tar.gz", 25),
    ("dfn3ll_25dB", "DeepFilterNet3_ll_onnx.tar.gz", 25),
]


def load(path):
    x, fs = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    return soxr.resample(x, fs, SR).astype(np.float32) if fs != SR else x


def rs(x, a, b):
    return soxr.resample(x, a, b).astype(np.float32) if a != b else x


class DNSMOS:
    """Same as run_eval.py (DNSMOS/dnsmos_local.py, non-personalized), 16 kHz, 9.01 s windows, 1 s hop."""

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
    c = np.correlate(est, ref, mode="full")
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


def hf_lsd(ref48, est48):
    S = lambda x: np.abs(librosa.stft(x, n_fft=960, hop_length=480)) ** 2 + 1e-10
    f = np.fft.rfftfreq(960, 1 / SR) > 8000
    R, E = S(ref48)[f], S(est48)[f]
    return float(np.mean(np.sqrt(np.mean((10 * np.log10(R) - 10 * np.log10(E)) ** 2, axis=0))))


def main():
    names = sorted(f.name for f in (VBD / "clean_testset_wav").glob("*.wav"))
    rng = np.random.default_rng(0)
    picked = sorted(rng.choice(names, VBD_N, replace=False))
    (WORK / "in").mkdir(parents=True, exist_ok=True)
    clean = {}
    for f in picked:
        noisy = load(VBD / "noisy_testset_wav" / f)
        clean[f] = load(VBD / "clean_testset_wav" / f)
        noisy.astype(np.float32).tofile(WORK / "in" / f"{f[:-4]}.f32")

    for name, model, lim in CONFIGS:
        subprocess.run(["node", str(HERE / "enhance.mjs"), str(WASM), str(MODELS / model), str(lim),
                        str(WORK / "in"), str(WORK / name)], check=True)

    mos = DNSMOS()
    rows = []
    for f in picked:
        c48 = clean[f]
        c16 = rs(c48, SR, 16000)
        outs = {"noisy": np.fromfile(WORK / "in" / f"{f[:-4]}.f32", dtype=np.float32)}
        for name, _, _ in CONFIGS:
            outs[name] = np.fromfile(WORK / name / f"{f[:-4]}.f32", dtype=np.float32)
        for name, y in outs.items():
            y = np.nan_to_num(y)
            y16 = rs(y, SR, 16000)
            c16a, y16a, lag = align(c16, y16, max_lag=1600)
            row = dict(clip=f, model=name, delay_ms=lag / 16,
                       pesq_wb=float(pesq(16000, c16a, y16a, "wb")),
                       stoi=float(stoi(c16a, y16a, 16000, extended=False)), si_sdr=si_sdr(c16a, y16a))
            row.update(mos(y16a))
            y48 = y[3 * lag:] if lag >= 0 else np.concatenate([np.zeros(-3 * lag, np.float32), y])
            n = min(len(c48), len(y48))
            row["hf_lsd_db"] = hf_lsd(c48[:n], y48[:n])
            rows.append(row)
        print(f, flush=True)
    (HERE / "results_ll.json").write_text(json.dumps(rows, indent=1))

    keys = ["pesq_wb", "stoi", "si_sdr", "SIG", "BAK", "OVRL", "hf_lsd_db", "delay_ms"]
    print("\n| model | " + " | ".join(keys) + " |")
    print("|---|" + "---|" * len(keys))
    for name in ["noisy"] + [c[0] for c in CONFIGS]:
        sel = [r for r in rows if r["model"] == name]
        print(f"| {name} | " + " | ".join(f"{np.mean([r[k] for r in sel]):.2f}" for k in keys) + " |")
    # Paired difference LL - standard, per clip, for the two limits
    for lim in ["nolimit", "25dB"]:
        a = {r["clip"]: r for r in rows if r["model"] == f"dfn3_{lim}"}
        b = {r["clip"]: r for r in rows if r["model"] == f"dfn3ll_{lim}"}
        for k in ["pesq_wb", "OVRL", "SIG", "BAK"]:
            d = np.array([b[c][k] - a[c][k] for c in a])
            print(f"LL - std ({lim}) {k}: mean {d.mean():+.3f}, 95% CI ±{1.96 * d.std(ddof=1) / np.sqrt(len(d)):.3f}, "
                  f"LL better on {int((d > 0).sum())}/{len(d)} clips")


if __name__ == "__main__":
    main()
