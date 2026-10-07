# Experiment: the noise suppression engines as they ship

Compares the noise suppression models of this package as an application gets them: **DTLN** (`/audio-worklet`) and
**DeepFilterNet3** (`/deepfilternet`), each through its shipped `AudioWorklet` with its default options (for
DeepFilterNet3: 25 dB limit while speaking, pause gate to 45 dB, 3 frames of gate lookahead), plus DeepFilterNet3 with
its gate turned off or shortened. DeepFilterNet3's **low-latency model** (DeepFilterNet3_ll, #22) was measured with the
same scripts on that pull request's branch (commit 930fc7a), then dropped: its rows are marked #22 and cannot be
reproduced from this branch. Earlier experiments measured the models alone:
[fullband-denoisers](../fullband-denoisers/README.md) (before integration) and
[deepfilternet3-quality-and-speed](../deepfilternet3-quality-and-speed/README.md) (libDF's Wasm, without the gate).

## Decision

**DeepFilterNet3 (standard model) is the engine to use by default**, and DTLN stays as the fallback for machines that
cannot keep up. The low-latency model is dropped.

- DeepFilterNet3 beats DTLN on every perceptual measure (PESQ +0.66 ± 0.09, better on 49 of 50 clips; DNSMOS
  OVRL +0.18), sends the band above 8 kHz that DTLN drops, and removes keystrokes at once (45 dB, against 9 dB for
  DTLN once it has adapted). It costs 2.7 % of a core on an M4, against 1.9 % for DTLN, and 11 MB to download
  against 6 MB.
- The low-latency model (#22) brought nothing the standard one cannot: same quality (PESQ +0.02 ± 0.05, not significant),
  and its 20 ms of delay saved are also saved, at no cost, by a 1-frame gate lookahead (50.7 ms both). It cost three
  times the CPU, 38 MB to download, and let keystrokes through for the first half second.
- Keep the pause gate: without it, the background is less removed (DNSMOS BAK 3.99 against 4.07) and keystrokes only
  get the 25 dB limit. Its lookahead can go from 3 frames to 1 (−20 ms, quality unchanged within ±0.02) if listeners
  do not mind the background coming back in one step instead of a 30 ms ramp when a word starts; this is a
  listening test, the metrics cannot settle it.
- Not measured yet: an x86 laptop. Scaling the M4 figures by the 4.5× an i7-10750H took on the same build (below),
  DeepFilterNet3 should stay around 1.2 ms per frame, inside the 2.67 ms quantum (the low-latency model would have
  taken around 3.7 ms, outside it). Run the benchmark page on Intel and AMD laptops to confirm.

## Results

### Quality

50 random VoiceBank+DEMAND test pairs (seed 0), through each worklet, `eval.py`. Delay is the lag of the best
alignment with the clean reference, so the whole chain: model, reframing and gate.

| | PESQ-WB | STOI | SI-SDR | DNSMOS SIG | BAK | OVRL | P.808 | LSD 8-24 kHz | delay |
|---|---|---|---|---|---|---|---|---|---|
| noisy input | 2.07 | 0.93 | 9.7 | 3.39 | 3.24 | 2.77 | 3.17 | 12.3 dB | |
| DTLN | 2.31 | 0.91 | 16.6 | 3.34 | 3.90 | 3.02 | 3.32 | 56.8 dB | 48 ms |
| **DeepFilterNet3** | **2.97** | **0.93** | **16.1** | **3.46** | **4.07** | **3.20** | **3.56** | **9.6 dB** | **70.7 ms** |
| low latency (#22, dropped) | 2.99 | 0.94 | 15.9 | 3.49 | 4.06 | 3.21 | 3.53 | 8.5 dB | 50.7 ms |
| DeepFilterNet3, no gate | 3.06 | 0.94 | 16.0 | 3.47 | 3.99 | 3.16 | 3.52 | 8.2 dB | 40.7 ms |
| DeepFilterNet3, gate lookahead 1 | 2.95 | 0.93 | 16.1 | 3.48 | 4.07 | 3.21 | 3.56 | 9.3 dB | 50.7 ms |

Paired differences per clip, mean ± 95 % confidence interval:

| | PESQ-WB | DNSMOS OVRL |
|---|---|---|
| DeepFilterNet3 − DTLN | +0.66 ± 0.09 (49/50 clips) | +0.18 ± 0.07 (43/50) |
| low latency (#22) − DeepFilterNet3 | +0.02 ± 0.05 (23/50) | +0.02 ± 0.02 (28/50) |
| no gate − DeepFilterNet3 | +0.10 ± 0.05 (29/50) | −0.04 ± 0.02 (16/50) |
| lookahead 1 − DeepFilterNet3 | −0.02 ± 0.02 (18/50) | +0.01 ± 0.01 (33/50) |

DTLN's STOI falls below the noisy input's (0.91 < 0.93), and its LSD above 8 kHz shows it sends nothing there.
DeepFilterNet3's delay is its model (30 ms), the 128 → 480 sample reframing (10.7 ms) and the gate lookahead
(3 × 10 ms); the low-latency model had no model lookahead (10 ms).

[deepfilternet3-quality-and-speed](../deepfilternet3-quality-and-speed/README.md) found PESQ 3.12 at the 25 dB limit,
calling the Wasm directly. Through the worklet without the gate it is 3.06 (the 0.06 is not explained yet), and the
gate takes 0.10 more in exchange for a quieter background (BAK, OVRL) and keystrokes at 45 dB.

### Keystrokes

Attenuation of a synthetic typing clip (`typing()` in `eval.py`: typing 1-11 s, a 2 s pause, typing 13-16 s):

| | first 0.5 s of typing | steady | first 0.5 s after the pause |
|---|---|---|---|
| DTLN | 2.7 dB | 9.0 dB | 6.7 dB |
| **DeepFilterNet3** | **7.7 dB** | **45.0 dB** | **45.0 dB** |
| low latency (#22, dropped) | 0.3 dB | 33.8 dB | 44.0 dB |
| DeepFilterNet3, no gate | 7.7 dB | 25.0 dB | 25.0 dB |
| DeepFilterNet3, gate lookahead 1 | 7.7 dB | 45.0 dB | 45.0 dB |

### Speed

Apple M4 (10 cores), macOS 27, Playwright Chromium 145 and WebKit 26, `node run.mjs speed 5`: median of 5 rounds,
engines alternated, a fresh browser context per run. "Work" is what the worklet computes in its busiest render quantum:
one 480-sample frame for DeepFilterNet3, four 128-sample DTLN shifts (ADR 0006). It must fit in that quantum.

| Chromium 145 | DTLN | DeepFilterNet3 | low latency (#22) |
|---|---|---|---|
| work, mean | 0.62 ms | 0.27 ms | 0.82 ms |
| work, p95 | 0.68 ms | 0.29 ms | 0.96 ms |
| work, max (worst run) | 0.97 ms | 1.23 ms | 2.00 ms |
| deadline (one render quantum) | 8 ms | 2.67 ms | 2.67 ms |
| p95 / deadline | 9 % | 11 % | 36 % |
| CPU, share of one core | 1.9 % | 2.7 % | 8.2 % |
| load, main thread, HTTP cache warm | 72 ms | 360 ms | 1020 ms |

| WebKit 26 | DTLN | DeepFilterNet3 | low latency (#22) |
|---|---|---|---|
| work, mean / p95 | 0.59 / 0.70 ms | 0.32 / 0.42 ms | 0.80 / 0.94 ms |
| work, max (worst run) | 3.72 ms | 9.96 ms | 1.64 ms |
| CPU, share of one core | 1.8 % | 3.2 % | 8.0 % |

The DTLN and DeepFilterNet3 columns are the runs in `results/`; the low-latency column comes from an earlier run of the
same script on #22's branch, the same day. Single slow steps vary from run to run (WebKit's 9.96 ms is one step out of the
10,000 of its five runs): read the mean and the p95, not the max.

Downloaded on first use (gzip as served): DTLN about 6 MB (LiteRT Wasm 2.6 MB, models 3.5 MB), DeepFilterNet3
about 11 MB (Wasm 3.8 MB, model 7.6 MB), low latency (#22) about 38 MB (same Wasm, model 34.7 MB). Firefox was not run
(Playwright's Firefox does not start on this Mac).

x86: on an Intel i7-10750H, moufmouf measured the same DeepFilterNet3 build at 0.72 ms mean and 1.5 ms p95 per frame
in Chrome ([#19](https://github.com/workadventure/noise-suppression/pull/19#issuecomment-5888669655)), 4.5× the M4
figure of the time on the same protocol (0.16 ms). That run predates #20 (both stages always run), so it is not
comparable with the table above; the benchmark page is what to run there now.

## Run it

From the repository root, after `npm ci` and `npx playwright install chromium` (the scripts use the repository's Vite
config and Playwright).

### Speed, on any machine

Open `engine-benchmark.html` on the test site, or locally with `npm run dev`, and press the button. It times the
work of each engine's busiest render quantum on 20 s of noisy speech, three rounds, on the main thread (worklets have
no `performance.now()`), single-threaded as in the worklet, and prints a table and a JSON to paste in an issue.

From a terminal, the same page in Playwright, five rounds, a fresh browser context per run:

```sh
node docs/experiments/engine-benchmark/run.mjs speed 5 chromium   # or webkit, firefox
```

### Quality, delay and keystrokes

Machine-independent. Needs Python 3.11 through [uv](https://docs.astral.sh/uv/), and about 400 MB of public data:

```sh
cd docs/experiments/engine-benchmark
./fetch-data.sh            # VoiceBank+DEMAND test set, DNSMOS, Python metrics → data/, .venv/
.venv/bin/python eval.py   # → results/quality.md and results/quality.json, ~20 min
```

`eval.py` picks 50 random VoiceBank+DEMAND test pairs (seed 0, the same as the earlier experiments), renders each one
and a synthetic typing clip through each engine's worklet (`node run.mjs render`: headless Chromium,
`OfflineAudioContext`, a fresh browser context per file), then scores them: PESQ-WB, STOI and SI-SDR against the clean
reference at 16 kHz after delay alignment, DNSMOS P.835 and P.808, log-spectral distance above 8 kHz, delay (lag of
the best alignment), and keystroke attenuation per 0.5 s.
