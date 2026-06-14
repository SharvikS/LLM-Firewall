# Detection-Efficacy Benchmark

A reproducible benchmark for the prompt-injection detector. It runs a **held-out,
labelled corpus** through the real `InjectionDetector` and reports
precision / recall / F1 / false-positive rate with per-category and per-layer
breakdowns.

## Run it

```bash
# from the repo root, using the ml_engine venv
ml_engine/venv/Scripts/python.exe ml_engine/eval/run_eval.py            # offline TF-IDF Layer 2
ml_engine/venv/Scripts/python.exe ml_engine/eval/run_eval.py --use-hf   # production transformer Layer 2 (needs torch)
```

Each config writes `results_<tfidf|hf>.json` and `REPORT_<tfidf|hf>.md`.
[`REPORT.md`](REPORT.md) is the hand-maintained side-by-side summary of both.

## Corpus

| File | Role |
|---|---|
| `../data/injection_train.jsonl` | Training data for Layer 2 (regenerate with `data/generate_injection_dataset.py`). |
| `../data/injection_eval.jsonl` | Held-out eval set. Each row: `text`, `label` (1=attack), `category`, `evades_regex`. |

The harness **asserts zero exact-text overlap** between train and eval before
scoring and aborts if any is found, so the eval set stays an unbiased judge.

## How to read the numbers honestly

- **The corpus is synthetic and authored in-house** — treat the results as an
  internal regression baseline, not an industry/third-party claim.
- **Two detection layers, measured together:**
  - *Layer 1 (regex)* catches known attack signatures at near-100% — see the
    high per-category scores for `goal_hijacking`, `privilege_escalation`, etc.
  - *Layer 2 (ML)* must generalize to novel phrasings. The
    **`regex-evading recall`** line isolates attacks that match no signature —
    this is the honest measure of Layer 2 generalization.
- The offline TF-IDF fallback (the default, dep-light, deterministic config)
  has limited paraphrase generalization by design. The **production Layer 2 is
  the `protectai/deberta-v3-base-prompt-injection-v2` transformer**; measure it
  with `--use-hf`. The layered design is what gives both high precision on known
  attacks and coverage of novel ones.
- `REPORT.md` lists every false negative and false positive by name, so each run
  surfaces concrete tuning targets (e.g. an `encoded_bypass` over-trigger on
  benign "decode base64" questions) rather than hiding them in an aggregate.

## Regenerating the training corpus

```bash
ml_engine/venv/Scripts/python.exe ml_engine/data/generate_injection_dataset.py
```

This re-emits a balanced `injection_train.jsonl`. Keep new training phrasings
**conceptually** similar to real attacks but textually distinct from the eval
set — the overlap assertion enforces the latter.
