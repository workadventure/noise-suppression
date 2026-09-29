#!/bin/sh
# Rebuilds forks/deepfilternet (libDF compiled to wasm) from the DeepFilterNet sources.
# Needs cargo, the wasm32-unknown-unknown target and wasm-pack.
#
# The pinned DeepFilterNet commit is patched before building (scripts/deepfilternet-tract-0.23.patch):
# - the upstream `wasm` feature embeds the DFN3 model in the binary ("default-model"); we drop it, the model is
#   passed to df_create() anyway (model/DeepFilterNet3_onnx.tar.gz);
# - tract 0.21.4 -> 0.23.8 (pinned exactly): 0.21.4 has no wasm SIMD kernels, 0.21.5/0.21.6 fail to load DFN3,
#   0.23 is ~2.8x faster per frame than 0.21.4 with bit-for-bit-close output (see ADR 0014). The patch ports libDF
#   to the 0.23 API (plain array views, TValue as a tensor, outputs selected by outlet label) and enables the
#   browser backend of getrandom 0.4, which tract 0.23 pulls in.
set -e
DEEPFILTERNET_COMMIT=d375b2d8309e0935d165700c91da9de862a99c31 # main, 2024-09-25 (wasm support landed after v0.5.6)
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --quiet https://github.com/Rikorose/DeepFilterNet.git "$WORK_DIR/DeepFilterNet"
cd "$WORK_DIR/DeepFilterNet"
git checkout --quiet "$DEEPFILTERNET_COMMIT"
git apply "$REPO_DIR/scripts/deepfilternet-tract-0.23.patch"

cargo update -p tract-core -p tract-data -p tract-hir -p tract-linalg -p tract-nnef -p tract-onnx -p tract-onnx-opl -p tract-pulse -p tract-pulse-opl
# getrandom 0.4 needs js-sys >= 0.3.77; the lock file of the pinned commit has 0.3.69.
cargo update -p js-sys --precise 0.3.95
cargo update -p wasm-bindgen --precise 0.2.118
# Wasm SIMD (Chrome 91, Firefox 89, Safari 16.4); tract 0.23 has simd128 matmul kernels for wasm.
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build libDF --target web --release --out-dir pkg --no-default-features --features wasm

for file in df.js df.d.ts df_bg.wasm df_bg.wasm.d.ts LICENSE-MIT LICENSE-APACHE; do
  cp "libDF/pkg/$file" "$REPO_DIR/forks/deepfilternet/"
done
cp models/DeepFilterNet3_onnx.tar.gz "$REPO_DIR/model/"
