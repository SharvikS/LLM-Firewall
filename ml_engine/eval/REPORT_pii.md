# PII Detection — Efficacy Benchmark

> Held-out synthetic corpus run through Microsoft Presidio. Document-level metrics below; entity-level recall measures per-recognizer coverage. Internal regression baseline, not a third-party benchmark.

## Headline metrics

| Metric | Value |
|---|---|
| Samples | 30 |
| **Precision** | **100.0%** |
| **Recall (detection rate)** | **100.0%** |
| **F1** | **100.0%** |
| Accuracy | 100.0% |
| False-positive rate | 0.0% |

Confusion: TP=15 FP=0 TN=15 FN=0

## Entity-level recall

Overall: **100.0%** (19/19 expected entities found)

| Entity | Found / Expected |
|---|---|
| CREDIT_CARD | 2/2 |
| EMAIL_ADDRESS | 5/5 |
| IP_ADDRESS | 1/1 |
| PERSON | 3/3 |
| PHONE_NUMBER | 5/5 |
| US_SSN | 3/3 |
