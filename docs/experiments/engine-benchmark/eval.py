"""Quality, delay and keystroke attenuation of the three engines, through their shipped AudioWorklets.

Renders 50 random VoiceBank+DEMAND test pairs (seed 0, as fullband-denoisers and deepfilternet3-quality-and-speed)
and a synthetic typing clip with `node run.mjs render` (headless Chromium, OfflineAudioContext, default options:
DTLN at 16 kHz; DeepFilterNet3 at 48 kHz, 25 dB limit, pause gate to 45 dB; DeepFilterNet3 without its gate and with
a 1-frame gate lookahead), then scores them.
Run from this directory after ./fetch-data.sh:  .venv/bin/python eval.py
"""
import json, os, subprocess
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
DATA, WORK, RESULTS = HERE / "data", HERE / "work", HERE / "results"
SR = 48000
ENGINES = ["dtln", "deepfilternet", "deepfilternet-gate-off", "deepfilternet-lookahead-1"]


def load(path):
    x, fs = sf.read(path, dtype="float32", always_2d=True)
    return rs(x.mean(axis=1), fs, SR)


def rs(x, a, b):
    return soxr.resample(x, a, b).astype(np.float32) if a != b else x.astype(np.float32)


class DNSMOS:
    """DNSMOS P.835 + P.808 as DNS-Challenge's dnsmos_local.py (non-personalized), 16 kHz, 9.01 s windows."""

    def __init__(self):
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        self.p835 = ort.InferenceSession(str(DATA / "sig_bak_ovr.onnx"), so)
        self.p808 = ort.InferenceSession(str(DATA / "model_v8.onnx"), so)

    def __call__(self, a16):
        fs, L = 16000, 9.01
        n = int(L * fs)
        audio = a16.astype(np.float64)
        while len(audio) < n:
            audio = np.append(audio, audio)
        r = {k: [] for k in ("SIG", "BAK", "OVRL", "P808")}
        for i in range(int(np.floor(len(audio) / fs) - L) + 1):
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
    t = np.dot(est, ref) / np.dot(ref, ref) * ref
    return float(10 * np.log10(np.sum(t**2) / np.sum((est - t) ** 2)))


def hf_lsd(ref48, est48):
    """Log-spectral distance to the clean reference above 8 kHz: what a 16 kHz engine cannot send."""
    S = lambda x: np.abs(librosa.stft(x, n_fft=960, hop_length=480)) ** 2 + 1e-10
    f = np.fft.rfftfreq(960, 1 / SR) > 8000
    R, E = S(ref48)[f], S(est48)[f]
    return float(np.mean(np.sqrt(np.mean((10 * np.log10(R) - 10 * np.log10(E)) ** 2, axis=0))))


def typing(seed=1):
    """16 s: typing 1-11 s, a 2 s pause, typing 13-16 s. Each keystroke is a 3-12 kHz click decaying in ~10 ms."""
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(16 * SR).astype(np.float32) * 1e-3  # faint room noise
    click = np.arange(int(0.04 * SR))
    for start, end in [(1, 11), (13, 16)]:
        t = start
        while t < end:
            burst = rng.standard_normal(len(click)) * np.exp(-click / (0.01 * SR / rng.uniform(1, 3)))
            spec = np.fft.rfft(burst)
            f = np.fft.rfftfreq(len(burst), 1 / SR)
            spec[(f < 3000) | (f > 12000)] *= 0.1
            i = int(t * SR)
            x[i: i + len(click)] += 0.2 * rng.uniform(0.4, 1) * np.fft.irfft(spec, len(burst)).astype(np.float32)
            t += rng.uniform(0.08, 0.25)
    return x


def render(in_dir, out_dir):
    subprocess.run(["node", str(HERE / "run.mjs"), "render", str(in_dir), str(out_dir)], check=True)


def read_output(out_dir, engine, name):
    y = np.nan_to_num(np.fromfile(out_dir / engine / f"{name}.f32", dtype=np.float32))
    return y, (16000 if engine == "dtln" else SR)


def main():
    names = sorted(f.name for f in (DATA / "clean_testset_wav").glob("*.wav"))
    picked = sorted(np.random.default_rng(0).choice(names, 50, replace=False))
    (WORK / "vbd").mkdir(parents=True, exist_ok=True)
    clean = {}
    for f in picked:
        clean[f] = load(DATA / "clean_testset_wav" / f)
        load(DATA / "noisy_testset_wav" / f).tofile(WORK / "vbd" / f"{f[:-4]}.f32")
    (WORK / "typing").mkdir(parents=True, exist_ok=True)
    keys = typing()
    keys.tofile(WORK / "typing" / "typing.f32")
    render(WORK / "vbd", WORK / "vbd-out")
    render(WORK / "typing", WORK / "typing-out")

    mos = DNSMOS()
    rows = []
    for f in picked:
        c48 = clean[f]
        c16 = rs(c48, SR, 16000)
        outs = {"noisy": (np.fromfile(WORK / "vbd" / f"{f[:-4]}.f32", dtype=np.float32), SR)}
        outs.update({e: read_output(WORK / "vbd-out", e, f[:-4]) for e in ENGINES})
        for name, (y, fs) in outs.items():
            y16 = rs(y, fs, 16000)
            c16a, y16a, lag = align(c16, y16, max_lag=3200)
            row = dict(clip=f, engine=name, delay_ms=lag / 16,
                       pesq_wb=float(pesq(16000, c16a, y16a, "wb")),
                       stoi=float(stoi(c16a, y16a, 16000, extended=False)), si_sdr=si_sdr(c16a, y16a))
            row.update(mos(y16a))
            y48 = rs(y, fs, SR)
            y48 = y48[3 * lag:] if lag >= 0 else np.concatenate([np.zeros(-3 * lag, np.float32), y48])
            n = min(len(c48), len(y48))
            row["hf_lsd_db"] = hf_lsd(c48[:n], y48[:n])
            rows.append(row)
        print(f, flush=True)

    # Keystrokes: attenuation (input / output energy) per 0.5 s, shifted by each engine's median delay
    def window_db(x, fs, t0, t1):
        return 10 * np.log10(np.sum(x[int(t0 * fs): int(t1 * fs)] ** 2) + 1e-12)

    typing_rows = []
    for e in ENGINES:
        y, fs = read_output(WORK / "typing-out", e, "typing")
        delay = np.median([r["delay_ms"] for r in rows if r["engine"] == e]) / 1000
        x = rs(keys, SR, fs)
        att = lambda t0, t1: window_db(x, fs, t0, t1) - window_db(y, fs, t0 + delay, t1 + delay)
        typing_rows.append(dict(engine=e, first_half_second_db=att(1, 1.5), steady_db=att(5, 11),
                                after_pause_db=att(13, 13.5)))

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "quality.json").write_text(json.dumps({"vbd": rows, "typing": typing_rows}, indent=1))

    keys_ = ["pesq_wb", "stoi", "si_sdr", "SIG", "BAK", "OVRL", "P808", "hf_lsd_db"]
    lines = ["| engine | " + " | ".join(keys_) + " | delay ms (median) |", "|---|" + "---|" * (len(keys_) + 1)]
    for name in ["noisy"] + ENGINES:
        sel = [r for r in rows if r["engine"] == name]
        lines.append(f"| {name} | " + " | ".join(f"{np.mean([r[k] for r in sel]):.2f}" for k in keys_)
                     + f" | {np.median([r['delay_ms'] for r in sel]):.1f} |")
    lines += ["", "| engine | typing, first 0.5 s | typing, steady | first 0.5 s after a 2 s pause |", "|---|---|---|---|"]
    lines += [f"| {r['engine']} | {r['first_half_second_db']:.1f} dB | {r['steady_db']:.1f} dB | {r['after_pause_db']:.1f} dB |"
              for r in typing_rows]
    # Paired differences per clip, with a 95 % confidence interval
    by = lambda e: {r["clip"]: r for r in rows if r["engine"] == e}
    lines.append("")
    for a, b in [("deepfilternet", "dtln"), ("deepfilternet-gate-off", "deepfilternet"),
                 ("deepfilternet-lookahead-1", "deepfilternet")]:
        A, B = by(a), by(b)
        for k in ["pesq_wb", "OVRL"]:
            d = np.array([A[c][k] - B[c][k] for c in A])
            lines.append(f"- {a} − {b}, {k}: {d.mean():+.3f} ± {1.96 * d.std(ddof=1) / np.sqrt(len(d)):.3f} "
                         f"(95 % CI), {a} better on {int((d > 0).sum())}/{len(d)} clips")
    (RESULTS / "quality.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
