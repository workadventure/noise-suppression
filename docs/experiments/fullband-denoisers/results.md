# Denoiser comparison (offline)

## 1. VoiceBank+DEMAND test subset — primary, 48 kHz (50 random pairs, seed 0)

Intrusive metrics on 16 kHz-resampled, delay-aligned signals. E>8k = % of output energy above 8 kHz at 48 kHz; clean reference = 0.19 %. LSD 8-24k = log-spectral distance to the clean reference in the 8-24 kHz band (lower = closer).

| model | PESQ-WB | STOI | SI-SDR dB | SIG | BAK | OVRL | P808 | E>8k % | LSD 8-24k dB |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 2.07 | 0.93 | 9.73 | 3.39 | 3.24 | 2.77 | 3.17 | 0.31 | 12.25 |
| dtln | 2.52 | 0.92 | 17.32 | 3.31 | 3.90 | 2.99 | 3.32 | 0.00 | 56.85 |
| dfn3 | 3.22 | 0.95 | 19.18 | 3.49 | 4.10 | 3.23 | 3.59 | 0.18 | 8.93 |
| dpdfnet2_48khz_hr | 3.13 | 0.94 | 18.79 | 3.40 | 4.08 | 3.15 | 3.59 | 0.17 | 16.16 |
| dpdfnet2_16k | 2.67 | 0.92 | 18.98 | 3.42 | 4.15 | 3.21 | 3.60 | 0.00 | 57.08 |
| dpdfnet8_48khz_hr | 3.02 | 0.93 | 18.83 | 3.38 | 4.10 | 3.15 | 3.60 | 0.18 | 17.69 |

## 2. Synthetic mixes of repo clips — secondary (16 kHz sources)

clean-voice.wav (16 kHz source) + noise at 0/5 dB SNR. Average over the 6 mixes:

| model | PESQ-WB | STOI | SI-SDR dB | SIG | BAK | OVRL | P808 |
|---|---|---|---|---|---|---|---|
| noisy | 1.05 | 0.77 | 3.96 | 3.44 | 1.73 | 1.96 | 2.55 |
| dtln | 1.58 | 0.83 | 11.24 | 3.15 | 3.58 | 2.68 | 2.97 |
| dfn3 | 1.81 | 0.86 | 12.02 | 3.29 | 3.77 | 2.88 | 3.30 |
| dpdfnet2_48khz_hr | 1.74 | 0.86 | 11.79 | 3.19 | 3.99 | 2.92 | 3.56 |
| dpdfnet2_16k | 1.87 | 0.89 | 13.45 | 3.17 | 3.92 | 2.86 | 3.51 |
| dpdfnet8_48khz_hr | 1.80 | 0.88 | 13.30 | 3.19 | 4.03 | 2.93 | 3.57 |

Per condition (PESQ-WB / STOI / SI-SDR / DNSMOS OVRL):

| model | airconditioning 0 dB | airconditioning 5 dB | pure-noise 0 dB | pure-noise 5 dB | white-noise-15s 0 dB | white-noise-15s 5 dB |
|---|---|---|---|---|---|---|
| noisy | 1.03 / 0.70 / -0.1 / 1.82 | 1.07 / 0.83 / 5.0 / 2.25 | 1.04 / 0.66 / -0.0 / 1.76 | 1.05 / 0.74 / 5.0 / 2.00 | 1.03 / 0.82 / 4.4 / 1.78 | 1.05 / 0.88 / 9.4 / 2.14 |
| dtln | 1.09 / 0.64 / 0.2 / 2.11 | 1.34 / 0.81 / 6.5 / 2.41 | 1.41 / 0.82 / 12.8 / 2.74 | 1.57 / 0.87 / 15.1 / 2.91 | 1.74 / 0.88 / 15.1 / 2.83 | 2.34 / 0.93 / 17.7 / 3.07 |
| dfn3 | 1.15 / 0.73 / 1.9 / 2.30 | 1.62 / 0.88 / 8.3 / 2.84 | 1.75 / 0.84 / 13.0 / 2.98 | 1.93 / 0.88 / 15.5 / 2.99 | 2.03 / 0.90 / 15.3 / 2.99 | 2.40 / 0.94 / 18.1 / 3.20 |
| dpdfnet2_48khz_hr | 1.09 / 0.65 / -2.0 / 2.48 | 1.42 / 0.83 / 6.1 / 2.94 | 1.85 / 0.88 / 14.4 / 2.78 | 1.88 / 0.92 / 17.1 / 3.09 | 1.96 / 0.91 / 16.2 / 3.05 | 2.24 / 0.95 / 18.9 / 3.18 |
| dpdfnet2_16k | 1.17 / 0.76 / 3.1 / 2.84 | 1.74 / 0.93 / 11.3 / 2.67 | 1.86 / 0.89 / 14.5 / 2.73 | 2.14 / 0.92 / 17.1 / 2.92 | 1.95 / 0.91 / 15.9 / 2.91 | 2.34 / 0.95 / 18.8 / 3.10 |
| dpdfnet8_48khz_hr | 1.13 / 0.72 / 2.7 / 2.68 | 1.63 / 0.85 / 8.7 / 2.99 | 1.86 / 0.89 / 15.0 / 2.84 | 1.98 / 0.93 / 17.6 / 2.98 | 1.95 / 0.92 / 16.6 / 2.95 | 2.24 / 0.95 / 19.2 / 3.17 |

## 3. Real noisy repo clips — non-intrusive only (16 kHz sources, no clean reference)

DNSMOS P.835 OVRL per clip, then the mean of SIG/BAK/OVRL/P808:

| model | dog_barking_noisy | restaurant_noisy | trump_vs_helicopter | SIG | BAK | OVRL | P808 |
|---|---|---|---|---|---|---|---|
| noisy | 2.66 | 1.43 | 2.18 | 3.26 | 2.06 | 2.09 | 2.88 |
| dtln | 3.06 | 2.10 | 3.12 | 3.36 | 3.37 | 2.76 | 3.08 |
| dfn3 | 3.20 | 2.70 | 3.17 | 3.41 | 3.83 | 3.02 | 3.71 |
| dpdfnet2_48khz_hr | 3.18 | 3.00 | 3.08 | 3.35 | 4.06 | 3.09 | 3.78 |
| dpdfnet2_16k | 3.26 | 2.85 | 3.13 | 3.38 | 3.98 | 3.08 | 3.72 |
| dpdfnet8_48khz_hr | 3.21 | 3.18 | 3.17 | 3.43 | 4.14 | 3.19 | 3.77 |

## 4. Real-time factor (processing time / audio duration, single thread, this CPU)

| model | RTF (all files) | RTF (VB+DEMAND) | measured delay (ms, median) |
|---|---|---|---|
| dtln | 0.011 | 0.011 | 24 |
| dfn3 | 0.040 | 0.039 | 0 |
| dpdfnet2_48khz_hr | 0.138 | 0.137 | 40 |
| dpdfnet2_16k | 0.099 | 0.099 | 40 |
| dpdfnet8_48khz_hr | 0.360 | 0.356 | 40 |

## 5. Setup, versions, caveats

- Platform: macOS-27.0-arm64-arm-64bit. Versions: torch 2.7.1, torchaudio 2.7.1, deepfilternet 0.5.6, deepfilterlib 0.5.6, dpdfnet 0.6.0, ai-edge-litert 2.2.0, onnxruntime 1.30.0, pesq 0.0.4, pystoi 0.4.1, numpy 1.26.4, soxr 1.1.0, librosa 0.11.0.
- Repo clip sample rates: airconditioning.wav 16000, clean-voice.wav 16000, dog_barking_noisy.wav 16000, pure-noise.wav 16000, restaurant_noisy.wav 16000, trump_vs_helicopter.wav 16000, white-noise-15s.wav 48000.
- DNSMOS of clean-voice.wav itself: SIG 3.74 BAK 4.19 OVRL 3.50 P808 3.96.
- Loudness-limited output files (peak-limited after RMS normalisation): none.
- DTLN = the exact production quantized models (model_quant_1/2.tflite from @workadventure/noise-suppression), run with
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
