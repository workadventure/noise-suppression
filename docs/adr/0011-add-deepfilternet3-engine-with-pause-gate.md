# ADR 0011: Add a DeepFilterNet3 Engine With a Pause Gate

- Status: Accepted
- Date: 2026-09-23

## Context

WorkAdventure users compare microphone quality unfavourably with Meet, Teams and Krisp. DTLN has two ceilings:
it runs at 16 kHz, so nothing above 8 kHz is sent (a muffled, telephone-like voice), and it is a 2020 model.

The comparison in [docs/experiments/fullband-denoisers](../experiments/fullband-denoisers/README.md) measured
DeepFilterNet3 (48 kHz) against DTLN and DPDFNet on VoiceBank+DEMAND and on this repository's clips:

- DeepFilterNet3 beats DTLN on every metric (PESQ 3.22 vs 2.52, DNSMOS OVRL 3.23 vs 2.99) and keeps the band above
  8 kHz.
- In an AudioWorklet it costs less than DTLN: real-time factor 0.013 vs 0.020 on an Apple M4.
- DPDFNet is slightly better on real 16 kHz clips but costs about 7x DeepFilterNet3, too much for a worklet on an
  ordinary laptop.

Listening tests then shaped the settings:

- With no attenuation limit, DeepFilterNet3 gates the background to digital silence between words: dropouts and a
  metallic, pumping background. A 25 dB limit removes the gaps.
- Listeners wanted quieter pauses than 25 dB allows. A higher fixed limit brings the gating back. Gliding the limit
  down in pauses clipped the first syllable after each pause (the limit came back up too late).

## Decision

Add DeepFilterNet3 as a second engine, `@workadventure/noise-suppression/deepfilternet`, next to DTLN:

- `libDF` from DeepFilterNet, compiled to Wasm by `scripts/build-deepfilternet-wasm.sh` from a pinned commit, without
  the embedded default model (9 MB instead of 16 MB); the official `DeepFilterNet3_onnx.tar.gz` is shipped separately.
- Its own AudioWorklet processor, sharing the ring buffer and the global-scope shims (a `crypto` shim was added:
  libDF panics without it) with the DTLN processor.
- DeepFilterNet3 runs at a 25 dB limit. A pause gate after it adds up to 20 dB in pauses (45 dB total by default).
  It detects speech on the denoised output, where speech stands far above the residual whatever the noise, and
  delays the output by 30 ms so it reopens before the first syllable. It ignores digital silence when tracking the
  noise floor, otherwise a start-up or a muted microphone would keep it open for seconds.
- A frame only counts as speech if DeepFilterNet3 also kept most of it (at most 15 dB of attenuation from its input).
  Keystrokes are loud, but the model removes them, so typing without talking no longer opens the gate: synthetic
  typing went from 25 dB to 43 dB of attenuation. Measured cost: a word that starts during a keystroke loses about
  30 ms of its attack (10 ms with a 50 ms lookahead, not worth 20 ms more latency); other noises are unchanged.

## Consequences

- Applications choose the engine. The DeepFilterNet3 context must run at 48 kHz.
- About 17 MB more to download (Wasm 2.3 MB gzipped + 8 MB model), and about 70 ms of processing latency (40 ms for the
  model, 30 ms for the gate) against about 24 ms for DTLN.
- Clean speech comes out at the same level (tested). In white noise about 16 dB below the voice, the model gives up
  4-5 dB of speech energy; the gate plays no part in that.
- The Vite plugin also serves DeepFilterNet3's processor, Wasm and model in dev.
- Babble (a crowded room) stays the hardest case: the noise is voices.
