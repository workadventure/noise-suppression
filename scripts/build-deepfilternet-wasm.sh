#!/bin/sh
# Rebuilds forks/deepfilternet (libDF compiled to wasm) from the DeepFilterNet sources.
# Needs cargo, the wasm32-unknown-unknown target and wasm-pack.
#
# The upstream `wasm` feature also embeds the DFN3 model in the binary ("default-model"). We drop it: the model is
# passed to df_create() anyway (model/DeepFilterNet3_onnx.tar.gz), and it halves the wasm (16 MB -> 9 MB).
set -e
DEEPFILTERNET_COMMIT=d375b2d8309e0935d165700c91da9de862a99c31 # main, 2024-09-25 (wasm support landed after v0.5.6)
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

git clone --quiet https://github.com/Rikorose/DeepFilterNet.git "$WORK_DIR/DeepFilterNet"
cd "$WORK_DIR/DeepFilterNet"
git checkout --quiet "$DEEPFILTERNET_COMMIT"
python3 - <<'PY'
path = "libDF/Cargo.toml"
source = open(path).read()
start = source.index("wasm = [")
end = source.index("]", start)
open(path, "w").write(source[:start] + source[start:end].replace('  "default-model",\n', "") + source[end:])
PY
wasm-pack build libDF --target web --release --out-dir pkg --no-default-features --features wasm

for file in df.js df.d.ts df_bg.wasm df_bg.wasm.d.ts LICENSE-MIT LICENSE-APACHE; do
  cp "libDF/pkg/$file" "$REPO_DIR/forks/deepfilternet/"
done
cp models/DeepFilterNet3_onnx.tar.gz "$REPO_DIR/model/"
