"""Turn out/results.json into out/results.md (tables only; caveats are appended from CAVEATS)."""
import json
from pathlib import Path

import numpy as np

OUT = Path(__file__).parent / "out"
CAVEATS = """- DTLN = the exact production quantized models (model_quant_1/2.tflite from @workadventure/noise-suppression), run with
  ai-edge-litert (1 thread) through a Python port of runtime.ts infer() (512/128, |rfft| -> m1 -> mask -> irfft -> m2 -> OLA).
  16 kHz only: input is resampled 48k->16k, output 16k->48k (soxr), so it has no energy above 8 kHz by construction.
- DeepFilterNet3 = `df.enhance` offline on the whole file (default model, torch 1 thread). It compensates its own
  algorithmic delay (measured 0 ms), so its streaming latency is NOT measured here; its RTF is a full-utterance
  batch RTF and is not directly comparable to the per-hop streaming loops of DTLN/DPDFNet.
- DPDFNet = `dpdfnet.StreamEnhancer` (ONNX Runtime, intra_op 1 thread) fed one 10 ms hop at a time at the model's native
  rate, so its RTF includes per-hop Python overhead. Measured output delay 40 ms. `dpdfnet2_16k` is resampled like DTLN.
- DNSMOS (P.835 sig_bak_ovr.onnx + P.808 model_v8.onnx, official, non-personalised) runs at 16 kHz: it cannot see or
  reward anything above 8 kHz. VB+DEMAND files are 2-3 s, so DNSMOS loops them to 9.01 s (as dnsmos_local.py does).
- PESQ/STOI/SI-SDR are computed at 16 kHz after cross-correlation delay alignment (+-100 ms), so they also ignore >8 kHz.
  The only fullband measures are E>8k and LSD 8-24k (section 1). The clean VB+DEMAND speech has only ~0.2 % of its
  energy above 8 kHz, so E>8k is a small number for every model; LSD (with a 1e-10 power floor) is the more telling one,
  and a 16 kHz model scores ~57 dB there because it outputs nothing in that band.
- Repo clips are 16 kHz sources (except white-noise-15s.wav): sections 2-3 cannot show any fullband difference.
- Synthetic SNR is computed over the whole clip (speech + pauses), noise looped/trimmed to the speech length.
- Listening WAVs are RMS-normalised to -26 dBFS (not LUFS). Only 6 of the 50 VB+DEMAND pairs are written
  (plus their `__clean` reference); all 50 are in the metrics. Small sample: 50 pairs, 6 synthetic mixes, 3 real clips.
"""
R = json.load(open(OUT / "results.json"))
rows, meta = R["rows"], R["meta"]
MODELS = ["noisy", "dtln", "dfn3", "dpdfnet2_48khz_hr", "dpdfnet2_16k", "dpdfnet8_48khz_hr"]


def mean(sel, k):
    v = [r[k] for r in sel if r.get(k) is not None]
    return np.mean(v) if v else float("nan")


def table(cols, groups, fmt="{:.2f}"):
    """groups: list of (label, rows)."""
    out = ["| " + " | ".join(["model"] + [c for c, _ in cols]) + " |", "|" + "---|" * (len(cols) + 1)]
    for label, sel in groups:
        out.append("| " + " | ".join([label] + [fmt.format(mean(sel, k)) for _, k in cols]) + " |")
    return "\n".join(out)


by = lambda **kw: [r for r in rows if all(r[k] == v for k, v in kw.items())]
INTR = [("PESQ-WB", "pesq_wb"), ("STOI", "stoi"), ("SI-SDR dB", "si_sdr")]
MOS = [("SIG", "SIG"), ("BAK", "BAK"), ("OVRL", "OVRL"), ("P808", "P808")]
BW = [("E>8k %", "hf_pct"), ("LSD 8-24k dB", "hf_lsd_db")]
for r in rows:
    r["hf_pct"] = 100 * r["hf_frac_above_8k"]

vbd = [r for r in rows if r["noise"] == "vbd"]
n_vbd = len({r["clip"] for r in vbd})
md = [f"# Denoiser comparison (offline)\n",
      f"## 1. VoiceBank+DEMAND test subset — primary, 48 kHz ({n_vbd} random pairs, seed 0)\n",
      "Intrusive metrics on 16 kHz-resampled, delay-aligned signals. E>8k = % of output energy above 8 kHz at 48 kHz; "
      f"clean reference = {100 * np.mean([r['clean_hf_frac_above_8k'] for r in vbd if r['model'] == 'noisy']):.2f} %. "
      "LSD 8-24k = log-spectral distance to the clean reference in the 8-24 kHz band (lower = closer).\n",
      table(INTR + MOS + BW, [(m, [r for r in vbd if r["model"] == m]) for m in MODELS]), ""]

syn = [r for r in rows if r["noise"] not in ("vbd", "real")]
md += ["## 2. Synthetic mixes of repo clips — secondary (16 kHz sources)\n",
       "clean-voice.wav (16 kHz source) + noise at 0/5 dB SNR. Average over the 6 mixes:\n",
       table(INTR + MOS, [(m, [r for r in syn if r["model"] == m]) for m in MODELS]), "",
       "Per condition (PESQ-WB / STOI / SI-SDR / DNSMOS OVRL):\n"]
conds = sorted({(r["noise"], r["snr"]) for r in syn})
md.append("| model | " + " | ".join(f"{n} {s} dB" for n, s in conds) + " |")
md.append("|" + "---|" * (len(conds) + 1))
for m in MODELS:
    cells = []
    for n, s in conds:
        r = by(model=m, noise=n, snr=s)[0]
        cells.append(f"{r['pesq_wb']:.2f} / {r['stoi']:.2f} / {r['si_sdr']:.1f} / {r['OVRL']:.2f}")
    md.append(f"| {m} | " + " | ".join(cells) + " |")
md.append("")

real = [r for r in rows if r["noise"] == "real"]
md += ["## 3. Real noisy repo clips — non-intrusive only (16 kHz sources, no clean reference)\n",
       "DNSMOS P.835 OVRL per clip, then the mean of SIG/BAK/OVRL/P808:\n"]
clips = sorted({r["clip"] for r in real})
md.append("| model | " + " | ".join(clips) + " | SIG | BAK | OVRL | P808 |")
md.append("|" + "---|" * (len(clips) + 5))
for m in MODELS:
    sel = [r for r in real if r["model"] == m]
    md.append(f"| {m} | " + " | ".join(f"{by(model=m, clip=c)[0]['OVRL']:.2f}" for c in clips) + " | "
              + " | ".join(f"{mean(sel, k):.2f}" for _, k in MOS) + " |")
md.append("")

md += ["## 4. Real-time factor (processing time / audio duration, single thread, this CPU)\n",
       "| model | RTF (all files) | RTF (VB+DEMAND) | measured delay (ms, median) |", "|---|---|---|---|"]
for m in MODELS[1:]:
    sel = by(model=m)
    rtf = sum(r["proc_s"] for r in sel) / sum(r["dur_s"] for r in sel)
    rtf_v = sum(r["proc_s"] for r in sel if r["noise"] == "vbd") / sum(r["dur_s"] for r in sel if r["noise"] == "vbd")
    d = np.median([r["delay_ms"] for r in sel if r.get("delay_ms") is not None])
    md.append(f"| {m} | {rtf:.3f} | {rtf_v:.3f} | {d:.0f} |")
md.append("")

cref = meta["clean_reference_dnsmos"]
md += ["## 5. Setup, versions, caveats\n",
       f"- Platform: {meta['platform']}. Versions: " + ", ".join(f"{k} {v}" for k, v in meta["versions"].items()) + ".",
       "- Repo clip sample rates: " + ", ".join(f"{k} {v}" for k, v in meta["input_sample_rates"].items()) + ".",
       f"- DNSMOS of clean-voice.wav itself: SIG {cref['SIG']:.2f} BAK {cref['BAK']:.2f} OVRL {cref['OVRL']:.2f} P808 {cref['P808']:.2f}.",
       "- Loudness-limited output files (peak-limited after RMS normalisation): "
       + (", ".join(meta["loudness_limited_files"]) or "none") + ".",
       CAVEATS]
(OUT / "results.md").write_text("\n".join(md))
print("\n".join(md))
