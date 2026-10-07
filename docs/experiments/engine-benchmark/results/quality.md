| engine | pesq_wb | stoi | si_sdr | SIG | BAK | OVRL | P808 | hf_lsd_db | delay ms (median) |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 2.07 | 0.93 | 9.73 | 3.39 | 3.24 | 2.77 | 3.17 | 12.25 | 0.0 |
| dtln | 2.31 | 0.91 | 16.55 | 3.34 | 3.90 | 3.02 | 3.32 | 56.76 | 48.0 |
| deepfilternet | 2.97 | 0.93 | 16.05 | 3.46 | 4.07 | 3.20 | 3.56 | 9.56 | 70.7 |
| deepfilternet-gate-off | 3.06 | 0.94 | 16.04 | 3.47 | 3.99 | 3.16 | 3.52 | 8.21 | 40.7 |
| deepfilternet-lookahead-1 | 2.95 | 0.93 | 16.05 | 3.48 | 4.07 | 3.21 | 3.56 | 9.30 | 50.7 |

| engine | typing, first 0.5 s | typing, steady | first 0.5 s after a 2 s pause |
|---|---|---|---|
| dtln | 2.7 dB | 9.0 dB | 6.7 dB |
| deepfilternet | 7.7 dB | 45.0 dB | 45.0 dB |
| deepfilternet-gate-off | 7.7 dB | 25.0 dB | 25.0 dB |
| deepfilternet-lookahead-1 | 7.7 dB | 45.0 dB | 45.0 dB |

- deepfilternet − dtln, pesq_wb: +0.662 ± 0.086 (95 % CI), deepfilternet better on 49/50 clips
- deepfilternet − dtln, OVRL: +0.177 ± 0.065 (95 % CI), deepfilternet better on 43/50 clips
- deepfilternet-gate-off − deepfilternet, pesq_wb: +0.096 ± 0.052 (95 % CI), deepfilternet-gate-off better on 29/50 clips
- deepfilternet-gate-off − deepfilternet, OVRL: -0.037 ± 0.023 (95 % CI), deepfilternet-gate-off better on 16/50 clips
- deepfilternet-lookahead-1 − deepfilternet, pesq_wb: -0.020 ± 0.020 (95 % CI), deepfilternet-lookahead-1 better on 18/50 clips
- deepfilternet-lookahead-1 − deepfilternet, OVRL: +0.014 ± 0.010 (95 % CI), deepfilternet-lookahead-1 better on 33/50 clips
