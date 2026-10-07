#!/bin/sh
# Downloads the public data the benchmark needs into data/ (git-ignored), and the Python metrics into .venv/.
# VoiceBank+DEMAND test set (Valentini 2017, CC-BY 4.0) and DNSMOS (Microsoft DNS Challenge, MIT).
set -eu
cd "$(dirname "$0")"
mkdir -p data
VBD=https://datashare.ed.ac.uk/bitstream/handle/10283/2791
for set in clean_testset_wav noisy_testset_wav; do
  [ -d "data/$set" ] || { curl -fsSL --retry 3 -o "data/$set.zip" "$VBD/$set.zip"; unzip -q "data/$set.zip" -d data; rm "data/$set.zip"; }
done
DNSMOS=https://github.com/microsoft/DNS-Challenge/raw/master/DNSMOS/DNSMOS
for model in sig_bak_ovr.onnx model_v8.onnx; do
  [ -f "data/$model" ] || curl -fsSL --retry 3 -o "data/$model" "$DNSMOS/$model"
done
[ -d .venv ] || uv venv -q --python 3.11 .venv
uv pip install -q --python .venv/bin/python -r requirements.txt
