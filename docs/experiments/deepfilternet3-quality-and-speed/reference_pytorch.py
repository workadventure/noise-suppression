"""Reference: DeepFilterNet3 in PyTorch (df.enhance) on the same 50 clips, with the metrics of eval_quality.py.

Run after eval_quality.py (it writes work/in): .venv/bin/python reference_pytorch.py <DeepFilterNet3 checkpoint dir>
(the checkpoint dir is DeepFilterNet3.zip from the DeepFilterNet repository's models/, unzipped; needs deepfilternet
and torch in the venv).
"""
import sys
from pathlib import Path
import numpy as np
import torch
from df.enhance import enhance, init_df

checkpoint = sys.argv[1]
sys.argv = [sys.argv[0], "unused", "unused"]
import eval_quality as E

HERE = Path(__file__).parent
model, state, _ = init_df(model_base_dir=checkpoint, log_level="ERROR")
mos = E.DNSMOS()
rows = []
for f32 in sorted((HERE / "work" / "in").glob("*.f32")):
    x = np.fromfile(f32, dtype=np.float32)
    y = enhance(model, state, torch.from_numpy(x)[None]).squeeze(0).numpy()
    c16 = E.rs(E.load(E.VBD / "clean_testset_wav" / (f32.stem + ".wav")), E.SR, 16000)
    c16a, y16a, lag = E.align(c16, E.rs(y, E.SR, 16000), max_lag=1600)
    row = dict(pesq_wb=float(E.pesq(16000, c16a, y16a, "wb")), stoi=float(E.stoi(c16a, y16a, 16000, extended=False)),
               si_sdr=E.si_sdr(c16a, y16a))
    row.update(mos(y16a))
    rows.append(row)
print({k: round(float(np.mean([r[k] for r in rows])), 2) for k in ["pesq_wb", "stoi", "si_sdr", "SIG", "BAK", "OVRL"]})
