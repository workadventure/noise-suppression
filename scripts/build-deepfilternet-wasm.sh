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
source = source[:start] + source[start:end].replace('  "default-model",\n', "") + source[end:]
# tract 0.21.4 has no wasm SIMD kernels; 0.21.18 (same 0.21 line) has a simd128 f32 matmul kernel, and its optimizer
# no longer trips on DeepFilterNet3's convolutions like 0.21.5/0.21.6 do ("Patch created duplicate name").
source = source.replace('version = "^0.21.4"', 'version = "^0.21.18"')
open(path, "w").write(source)

# tract 0.21.18 moved to ndarray 0.16 and renamed Graph::symbol_table: use tract's own ndarray re-export.
for path, old, new in [
    ("libDF/src/tract.rs", "use ndarray::{prelude::*, Axis};", "use tract_core::ndarray::{prelude::*, Axis};"),
    ("libDF/src/wasm.rs", "use ndarray::prelude::*;", "use tract_core::ndarray::prelude::*;"),
]:
    source = open(path).read()
    assert old in source, (path, old)
    open(path, "w").write(source.replace(old, new))
source = open("libDF/src/tract.rs").read()
assert "m.symbol_table.sym" in source
open("libDF/src/tract.rs", "w").write(source.replace("m.symbol_table.sym", "m.symbols.sym"))
PY
cargo update -p tract-core -p tract-data -p tract-hir -p tract-linalg -p tract-nnef -p tract-onnx -p tract-onnx-opl -p tract-pulse -p tract-pulse-opl
# Wasm SIMD (Chrome 91, Firefox 89, Safari 16.4): -25 % per frame with the tract upgrade, bit-identical output.
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build libDF --target web --release --out-dir pkg --no-default-features --features wasm

for file in df.js df.d.ts df_bg.wasm df_bg.wasm.d.ts LICENSE-MIT LICENSE-APACHE; do
  cp "libDF/pkg/$file" "$REPO_DIR/forks/deepfilternet/"
done
cp models/DeepFilterNet3_onnx.tar.gz "$REPO_DIR/model/"
