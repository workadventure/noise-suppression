# dtln-rs

<div align="center">

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)

**High-performance real-time noise suppression for Node.js and browsers**

*Built with Rust 🦀 | Powered by DTLN Neural Network 🧠 | Production Ready 🚀*

[**Türkçe**](README.tr.md) | **English**

</div>

---

### 🎯 Overview

**dtln-rs** is a high-performance audio noise suppression library for Node.js and browsers, built on the [Dual-Signal Transformation LSTM Network (DTLN)](https://github.com/breizhn/DTLN) architecture. It uses a native Rust addon on Node.js and a LiteRT.js backend in browsers, providing near real-time noise reduction for:

- 🎙️ Voice calls and conferencing (WebRTC integration)
- 🎵 Audio streaming applications
- 🎧 Podcast and audio production tools
- 📞 VoIP applications
- 🤖 Voice AI assistants

### ✨ Key Features

- ⚡ **Ultra-fast**: Processes audio **55x faster than real-time** on modern hardware
- 🎯 **High Quality**: Based on state-of-the-art DTLN neural network architecture
- 🔌 **Plug & Play**: Prebuilt binaries included - no Rust installation required
- 🌐 **Browser-ready**: Bundlers can resolve to the LiteRT.js browser backend automatically
- 🌍 **Cross-platform**: macOS (Intel & Apple Silicon), Linux (x64 & ARM64)
- 🪶 **Lightweight**: Only ~4MB of ML models, optimized for edge deployment
- 🔒 **Thread-safe**: Designed for concurrent processing
- 🧠 **Portable runtime**: Native Node addon plus browser-side LiteRT.js execution

### 🚀 Quick Start

#### Installation

```bash
npm install dtln-rs
```

**That's it!** Prebuilt binaries are included for:
- ✅ macOS ARM64 (Apple Silicon)
- ✅ macOS x64 (Intel)
- ✅ Linux x64
- ✅ Linux ARM64

#### Basic Usage (JavaScript)

```javascript
const dtln = require('@hayatialikeles/dtln-rs');

// Initialize denoiser
const denoiser = dtln.dtln_create();

// Prepare audio buffers (16kHz, mono, Float32Array)
const inputAudio = new Float32Array(512);  // Your noisy audio
const outputAudio = new Float32Array(512); // Clean audio output

// Process audio frame
const isStarved = dtln.dtln_denoise(denoiser, inputAudio, outputAudio);

// Clean up
dtln.dtln_stop(denoiser);
```

#### TypeScript Usage

Full TypeScript support with type definitions included!

```typescript
import * as dtln from '@hayatialikeles/dtln-rs';

const denoiser: dtln.DenoiserHandle = dtln.dtln_create();

const inputAudio = new Float32Array(512);
const outputAudio = new Float32Array(512);

const isStarved: boolean = dtln.dtln_denoise(denoiser, inputAudio, outputAudio);

dtln.dtln_stop(denoiser);
```

See [example.ts](example.ts) for comprehensive TypeScript examples.

#### Browser Usage

```typescript
import createDtlnModule from '@hayatialikeles/dtln-rs/browser';

const dtln = await createDtlnModule();
await dtln.ready;

const denoiser = dtln.dtln_create();
const inputAudio = new Float32Array(512);
const outputAudio = new Float32Array(512);

dtln.dtln_denoise(denoiser, inputAudio, outputAudio);
dtln.dtln_stop(denoiser);
```

The browser backend enables LiteRT.js threads automatically when the page is cross-origin isolated (`COOP`/`COEP`).

### 📊 Performance Benchmarks

Real-world performance on MacBook Pro M1:

| Audio Duration | Processing Time | Real-time Factor |
|----------------|-----------------|------------------|
| 10.00s | 195ms | **0.019x** ⚡ |
| 7.06s | 132ms | **0.019x** ⚡ |
| 22.10s | 333ms | **0.015x** ⚡ |

*Real-time factor of 0.019x means it's **55x faster than real-time*** 🚀

### 📖 API Reference

#### `dtln_create()`

Creates a new DTLN denoiser instance.

**Returns:** Denoiser handle

**Example:**
```javascript
const denoiser = dtln.dtln_create();
```

---

#### `dtln_denoise(denoiser, inputSamples, outputSamples)`

Processes audio samples and removes noise.

**Parameters:**
- `denoiser`: Denoiser handle from `dtln_create()`
- `inputSamples`: Float32Array of input audio (16kHz, mono, -1.0 to 1.0)
- `outputSamples`: Float32Array to receive clean audio (same length as input)

**Returns:** Boolean - `true` if processor is starved (slower than real-time)

**Example:**
```javascript
const isStarved = dtln.dtln_denoise(denoiser, inputFrame, outputFrame);
if (isStarved) {
  console.warn('⚠️ Processing slower than real-time');
}
```

---

#### `dtln_stop(denoiser)`

Stops and cleans up the denoiser instance. Always call this when done!

**Parameters:**
- `denoiser`: Denoiser handle to stop

**Example:**
```javascript
dtln.dtln_stop(denoiser);
```

### 🎛️ Audio Requirements

| Parameter | Value |
|-----------|-------|
| Sample Rate | 16kHz (16000 Hz) |
| Channels | Mono (1 channel) |
| Format | Float32Array |
| Range | -1.0 to 1.0 |
| Frame Size | 512 samples (32ms recommended) |

### 🌐 WebRTC Integration Example

```javascript
const dtln = require('dtln-rs');

class RealtimeDenoiser {
  constructor() {
    this.denoiser = dtln.dtln_create();
    this.frameSize = 512; // 32ms at 16kHz
  }

  /**
   * Process audio data in real-time
   * @param {Float32Array} audioData - Input audio (16kHz mono)
   * @returns {Float32Array} Denoised audio
   */
  process(audioData) {
    const output = new Float32Array(audioData.length);

    // Process in 512-sample chunks
    for (let i = 0; i < audioData.length; i += this.frameSize) {
      const chunk = audioData.slice(i, Math.min(i + this.frameSize, audioData.length));
      const outChunk = new Float32Array(this.frameSize);

      // Pad if last chunk is smaller
      const padded = new Float32Array(this.frameSize);
      padded.set(chunk);

      dtln.dtln_denoise(this.denoiser, padded, outChunk);
      output.set(outChunk.slice(0, chunk.length), i);
    }

    return output;
  }

  destroy() {
    dtln.dtln_stop(this.denoiser);
  }
}

// Usage in WebRTC
const denoiser = new RealtimeDenoiser();

audioContext.createScriptProcessor(512, 1, 1).onaudioprocess = (e) => {
  const input = e.inputBuffer.getChannelData(0);
  const output = e.outputBuffer.getChannelData(0);

  const clean = denoiser.process(input);
  output.set(clean);
};

// Cleanup
window.addEventListener('beforeunload', () => denoiser.destroy());
```

### 🐳 Docker Usage

When using this package in Docker containers, you **must** install C++ runtime libraries:

```dockerfile
FROM node:18-slim

# Install required C++ libraries for dtln-rs
RUN apt-get update && apt-get install -y \
    libc++-dev \
    libc++abi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
CMD ["node", "index.js"]
```

**Without these libraries, you'll get:**
```
libc++.so.1: cannot open shared object file: No such file or directory
```

See [DOCKER.md](DOCKER.md) for complete Docker integration guide.

---

### 🛠️ Platform Support

| Platform | Status | Installation |
|----------|--------|--------------|
| macOS ARM64 (M1/M2/M3) | ✅ Prebuilt | `npm install` (No Rust required) |
| macOS x64 (Intel) | ✅ Prebuilt | `npm install` (No Rust required) |
| Linux x64 | ✅ Prebuilt | `npm install` + Docker libs |
| Linux ARM64 | 🔨 Build from source | Requires Rust toolchain |
| Windows x64 | 🔨 Build from source | Requires Rust + MSVC |

#### Building from Source

If prebuilt binaries aren't available for your platform:

```bash
# Install Rust from https://rustup.rs/
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build the module
npm install
```

### 📦 What's Included

- **Prebuilt Binaries**: Ready-to-use for macOS & Linux
- **DTLN Models**: Quantized TensorFlow Lite models (~4MB)
- **Source Code**: Full Rust implementation
- **Examples**: Real-world usage examples

### 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Your Application                │
│         (Node.js / JavaScript)          │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│          dtln-rs (Native Addon)         │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   DTLN Engine (Rust)              │ │
│  │  ┌──────────────┐ ┌─────────────┐│ │
│  │  │  Model 1     │ │  Model 2    ││ │
│  │  │  (Frequency) │ │  (Time)     ││ │
│  │  └──────────────┘ └─────────────┘│ │
│  └───────────────────────────────────┘ │
│               │                         │
│               ▼                         │
│  ┌───────────────────────────────────┐ │
│  │   TensorFlow Lite (Static)        │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 🧪 Running Tests

Test with real audio samples:

```bash
# Run example with simulated audio
node example.js

# Test with real WAV files (included in repo)
node test-real-audio.js
```

### 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🙏 Acknowledgments

This project builds upon excellent work by:

- **[DTLN (Dual-signal Transformation LSTM Network)](https://github.com/breizhn/DTLN)** by Nils Westhausen
  - Original DTLN paper: ["Dual-signal Transformation LSTM Network for Real-time Noise Suppression"](https://arxiv.org/abs/2005.07551)
  - State-of-the-art deep learning approach for noise suppression

- **[TensorFlow Lite](https://www.tensorflow.org/lite)** by Google
  - Lightweight ML inference engine
  - Makes real-time processing possible on edge devices

- **[Original dtln-rs implementation](https://github.com/discord/dtln-rs)** by Discord/Jason Thomas
  - Initial Rust port of DTLN
  - Foundation for this enhanced multi-platform version

Special thanks to the Rust and Node.js communities for excellent tooling and libraries!

### 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/hayatialikeles/dtln-rs/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/hayatialikeles/dtln-rs/discussions)
- 📧 **Email**: hayati.alikeles@gmail.com

### 🔗 Links

- [GitHub Repository](https://github.com/hayatialikeles/dtln-rs)
- [npm Package](https://www.npmjs.com/package/dtln-rs)
- [Original DTLN Paper](https://arxiv.org/abs/2005.07551)

---

<div align="center">

**Made with ❤️ using Rust 🦀**

*Star ⭐ this repository if you find it useful!*

</div>
