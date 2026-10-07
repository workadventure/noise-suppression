# Experiment: DeepFilterNet3 quality and speed, as this repository runs it

Follow-up of [fullband-denoisers](../fullband-denoisers/README.md), which measured DeepFilterNet3 **in PyTorch**. This
one measures what ships: the libDF wasm in `forks/deepfilternet`, called frame by frame like the AudioWorklet does.

Two findings came out of it:

- **libDF's default stage skipping degraded DeepFilterNet3.** `RuntimeParams::default_with_ch` skips the deep filter
  above an estimated local SNR of 20 dB, everything above 30 dB, and the gains below -10 dB. The PyTorch reference
  always runs both stages. Fixed in #20 (the build patch passes infinite thresholds).
- **Speed must be measured on speech.** On white noise the defaults left most of the model unrun, which made the
  first speed-ups announced for tract 0.21.18 (#18, closed) and 0.23.8 (#19) look larger than they are.

## Quality

50 random VoiceBank+DEMAND test pairs (seed 0, the same as `fullband-denoisers`), `eval_quality.py`:

| | PESQ-WB | STOI | SI-SDR | DNSMOS OVRL | delay |
|---|---|---|---|---|---|
| noisy input | 2.07 | 0.93 | 9.7 | 2.77 | |
| DeepFilterNet3, wasm, libDF defaults (before #20) | 2.12 | 0.85 | 8.0 | 2.70 | 30 ms |
| DeepFilterNet3, PyTorch reference (`reference_pytorch.py`) | 3.22 | 0.95 | 19.2 | 3.23 | |
| **DeepFilterNet3, wasm, both stages (#20)** | **3.22** | **0.95** | **19.2** | **3.24** | 30 ms |
| **DeepFilterNet3_ll, wasm, both stages (#20)** | **3.18** | **0.95** | **19.0** | **3.24** | **10 ms** |

At the 25 dB attenuation limit WorkAdventure uses: 2.36 before #20, 3.12 after (DeepFilterNet3), 3.09
(DeepFilterNet3_ll). With the defaults the output was less intelligible than the input (STOI 0.85 < 0.93).

## Speed

Per 10 ms frame on 20 s of real noisy speech (the same VoiceBank+DEMAND clips, end to end), both stages always run,
Node (V8, same engine as Chrome), Apple Silicon, median of 5 runs, `bench_speed.mjs`:

| tract | DeepFilterNet3 mean | p95 | DeepFilterNet3_ll mean | p95 |
|---|---|---|---|---|
| 0.21.4 | 1.05 ms | 1.22 ms | 2.67 ms | 3.05 ms |
| 0.21.18 + wasm SIMD | 0.99 ms | 1.23 ms | 2.77 ms | 3.08 ms |
| 0.23.8 + wasm SIMD (#19) | **0.33 ms** | **0.45 ms** | **1.00 ms** | **1.48 ms** |

The budget is one 128-sample render quantum at 48 kHz: 2.67 ms, and a whole 480-sample frame is computed inside
one quantum. Not measured on x86 yet.

Delay (`delay.mjs`): 30 ms for DeepFilterNet3 (960-sample window, 2 frames of lookahead), 10 ms for DeepFilterNet3_ll
(no lookahead).

## Run it

```sh
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python numpy==1.26.4 pesq pystoi soxr soundfile librosa onnxruntime
# for reference_pytorch.py only: uv pip install --python .venv/bin/python deepfilternet==0.5.6 torch==2.2.2 torchaudio==2.2.2
```

- VoiceBank+DEMAND test set (Valentini 2017, CC-BY 4.0), <https://datashare.ed.ac.uk/handle/10283/2791>:
  `clean_testset_wav` and `noisy_testset_wav` into `vbd/`.
- DNSMOS `sig_bak_ovr.onnx` and `model_v8.onnx` into `dnsmos/`, from
  <https://github.com/microsoft/DNS-Challenge/tree/master/DNSMOS/DNSMOS>.
- Models: `DeepFilterNet3_onnx.tar.gz` and `DeepFilterNet3_ll_onnx.tar.gz` from the `models/` directory of
  <https://github.com/Rikorose/DeepFilterNet>.

```sh
.venv/bin/python eval_quality.py ../../../forks/deepfilternet <models dir>
python3 -c "import numpy as n,glob;x=n.concatenate([n.fromfile(f,'f4') for f in sorted(glob.glob('work/in/*.f32'))])[:960000];x.tofile('speech20s.f32')"
node bench_speed.mjs ../../../forks/deepfilternet <models dir>/DeepFilterNet3_onnx.tar.gz speech20s.f32
node delay.mjs ../../../forks/deepfilternet <models dir>/DeepFilterNet3_onnx.tar.gz
```

To reproduce the "libDF defaults" row, rebuild the wasm with the `with_thresholds(...)` line removed from
`scripts/deepfilternet-tract-0.23.patch`.
