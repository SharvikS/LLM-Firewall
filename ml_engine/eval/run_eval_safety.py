"""
Efficacy benchmarks for the toxicity and PII/secret detectors.

Mirrors run_eval.py (injection) for the other two governance controls so all
three detectors have published precision/recall/F1/FPR numbers.

    ml_engine/venv/Scripts/python.exe ml_engine/eval/run_eval_safety.py            # both
    ml_engine/venv/Scripts/python.exe ml_engine/eval/run_eval_safety.py --task toxicity
    ml_engine/venv/Scripts/python.exe ml_engine/eval/run_eval_safety.py --task pii

Toxicity uses the unitary/toxic-bert classifier (needs torch). PII uses Microsoft
Presidio (needs presidio-analyzer + the spaCy en_core_web_sm model). Corpora are
synthetic / in-house — internal regression baselines, not third-party claims.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ML_ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.abspath(ML_ROOT))
DATA = os.path.join(ML_ROOT, "data")


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def pct(x):
    return f"{x * 100:.1f}%"


def binary_metrics(rows, predict):
    """predict(row) -> 0/1. Returns metrics dict + miss/alarm lists."""
    tp = fp = tn = fn = 0
    misses, alarms = [], []
    for row in rows:
        label = int(row["label"])
        pred = predict(row)
        if label == 1 and pred == 1:
            tp += 1
        elif label == 0 and pred == 1:
            fp += 1
            alarms.append(row["text"])
        elif label == 0 and pred == 0:
            tn += 1
        else:
            fn += 1
            misses.append(row["text"])
    n = tp + fp + tn + fn
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {
        "totals": {"n": n, "tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "metrics": {
            "precision": precision, "recall": recall, "f1": f1,
            "accuracy": (tp + tn) / n if n else 0.0,
            "false_positive_rate": fp / (fp + tn) if (fp + tn) else 0.0,
        },
        "false_negatives": misses,
        "false_positives": alarms,
    }


def write_report(title, subtitle, r, out_md, extra_lines=None):
    m, t = r["metrics"], r["totals"]
    lines = [f"# {title}\n", f"> {subtitle}\n", "## Headline metrics\n",
             "| Metric | Value |", "|---|---|",
             f"| Samples | {t['n']} |",
             f"| **Precision** | **{pct(m['precision'])}** |",
             f"| **Recall (detection rate)** | **{pct(m['recall'])}** |",
             f"| **F1** | **{pct(m['f1'])}** |",
             f"| Accuracy | {pct(m['accuracy'])} |",
             f"| False-positive rate | {pct(m['false_positive_rate'])} |", "",
             f"Confusion: TP={t['tp']} FP={t['fp']} TN={t['tn']} FN={t['fn']}\n"]
    if extra_lines:
        lines += extra_lines + [""]
    if r["false_negatives"]:
        lines.append("## Missed (false negatives)\n")
        lines += [f"- {x}" for x in r["false_negatives"]] + [""]
    if r["false_positives"]:
        lines.append("## False alarms (false positives)\n")
        lines += [f"- {x}" for x in r["false_positives"]] + [""]
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def eval_toxicity():
    from analyzer.toxicity_detector import ToxicityDetector
    rows = load_jsonl(os.path.join(DATA, "toxicity_eval.jsonl"))
    det = ToxicityDetector()
    r = binary_metrics(rows, lambda row: 1 if det.detect(row["text"]).should_block else 0)
    write_report(
        "Toxicity Detection — Efficacy Benchmark",
        "Held-out synthetic corpus run through the unitary/toxic-bert classifier "
        "(block gate). Internal regression baseline, not a third-party benchmark.",
        r, os.path.join(HERE, "REPORT_toxicity.md"))
    with open(os.path.join(HERE, "results_toxicity.json"), "w") as f:
        json.dump(r, f, indent=2)
    return "toxicity", r


def eval_pii():
    from analyzer.pii_scanner import PIIScanner
    rows = load_jsonl(os.path.join(DATA, "pii_eval.jsonl"))
    scanner = PIIScanner()

    # Entity-level recall: of all expected entities, how many were found.
    exp_total = found_total = 0
    per_entity = {}
    results = []
    for row in rows:
        res = scanner.scan(row["text"])
        results.append(res)
        for e in row.get("entities", []):
            exp_total += 1
            pe = per_entity.setdefault(e, {"expected": 0, "found": 0})
            pe["expected"] += 1
            if e in res.entities_found:
                found_total += 1
                pe["found"] += 1

    idx = {id(row): res for row, res in zip(rows, results)}
    r = binary_metrics(rows, lambda row: 1 if idx[id(row)].pii_detected else 0)
    entity_recall = found_total / exp_total if exp_total else 0.0
    extra = ["## Entity-level recall\n",
             f"Overall: **{pct(entity_recall)}** ({found_total}/{exp_total} expected entities found)\n",
             "| Entity | Found / Expected |", "|---|---|"]
    extra += [f"| {e} | {per_entity[e]['found']}/{per_entity[e]['expected']} |"
              for e in sorted(per_entity)]
    r["entity_recall"] = entity_recall
    r["per_entity"] = per_entity
    write_report(
        "PII Detection — Efficacy Benchmark",
        "Held-out synthetic corpus run through Microsoft Presidio. Document-level "
        "metrics below; entity-level recall measures per-recognizer coverage. "
        "Internal regression baseline, not a third-party benchmark.",
        r, os.path.join(HERE, "REPORT_pii.md"), extra_lines=extra)
    with open(os.path.join(HERE, "results_pii.json"), "w") as f:
        json.dump(r, f, indent=2)
    return "pii", r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=["toxicity", "pii", "both"], default="both")
    args = ap.parse_args()
    tasks = ["toxicity", "pii"] if args.task == "both" else [args.task]
    for task in tasks:
        name, r = eval_toxicity() if task == "toxicity" else eval_pii()
        m = r["metrics"]
        print(f"[{name}] precision={pct(m['precision'])} recall={pct(m['recall'])} "
              f"f1={pct(m['f1'])} fpr={pct(m['false_positive_rate'])}"
              + (f" entity_recall={pct(r['entity_recall'])}" if "entity_recall" in r else ""))


if __name__ == "__main__":
    main()
