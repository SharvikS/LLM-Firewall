# PII Detection — Efficacy Benchmark

> Held-out synthetic corpus run through Microsoft Presidio. Document-level metrics below; entity-level recall measures per-recognizer coverage. Internal regression baseline, not a third-party benchmark.

## Headline metrics

| Metric | Value |
|---|---|
| Samples | 30 |
| **Precision** | **100.0%** |
| **Recall (detection rate)** | **80.0%** |
| **F1** | **88.9%** |
| Accuracy | 90.0% |
| False-positive rate | 0.0% |

Confusion: TP=12 FP=0 TN=15 FN=3

## Entity-level recall

Overall: **73.7%** (14/19 expected entities found)

| Entity | Found / Expected |
|---|---|
| CREDIT_CARD | 2/2 |
| EMAIL_ADDRESS | 5/5 |
| IP_ADDRESS | 1/1 |
| PERSON | 3/3 |
| PHONE_NUMBER | 2/5 |
| US_SSN | 1/3 |

## Missed (false negatives)

- You can call me at (415) 555-0132 tomorrow morning.
- My social security number is 123-45-6789 for the application.
- Text me on 646-555-0123 if the package is delayed.
