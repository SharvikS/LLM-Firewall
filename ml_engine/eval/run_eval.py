"""
Detection-efficacy benchmark for the prompt-injection detector.

Runs a held-out, labelled eval corpus through the *real* InjectionDetector
(regex Layer 1 + TF-IDF/LogReg Layer 2) and reports precision, recall, F1,
false-positive rate and a per-category / per-layer breakdown. Writes both a
machine-readable results.json and a human-readable REPORT.md next to this file.

Run (from repo root, using the ml_engine venv):
    ml_engine/venv/Scripts/python.exe ml_engine/eval/run_eval.py

By default Layer 2 uses the offline TF-IDF classifier (INJECTION_HF_DISABLED=
true) so the benchmark is deterministic and needs no torch / network. Pass
--use-hf to measure the HuggingFace transformer instead (requires torch +
transformers and a model download).

Honesty notes:
- The eval corpus is held out: the harness asserts zero exact-text overlap with
  the training set before scoring, and aborts if any is found.
- The corpus is synthetic (authored in-house), not a third-party benchmark.
  Treat the numbers as an internal regression baseline, not an industry claim.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ML_ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.abspath(ML_ROOT))

DATA = os.path.join(ML_ROOT, "data")
TRAIN = os.path.join(DATA, "injection_train.jsonl")
EVAL = os.path.join(DATA, "injection_eval.jsonl")

# Heuristic (Layer 1) threat types — anything else positive came from Layer 2.
_REGEX_TYPES = {
    "goal_hijacking", "jailbreak_dan", "jailbreak_roleplay",
    "privilege_escalation", "filter_bypass", "prompt_exfiltration",
    "system_prompt_exfiltration", "encoded_bypass", "ethical_bypass",
    "dangerous_content", "markup_injection",
}


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def assert_no_overlap(train, eval_rows):
    train_texts = {r["text"].strip() for r in train}
    leaked = [r["text"] for r in eval_rows if r["text"].strip() in train_texts]
    if leaked:
        print("FATAL: eval set leaks into training set — benchmark invalid:")
        for t in leaked[:10]:
            print("  -", t)
        sys.exit(1)


def pct(x):
    return f"{x * 100:.1f}%"


def evaluate(detector, eval_rows):
    tp = fp = tn = fn = 0
    layer_hits = {"regex": 0, "ml": 0}
    per_cat = {}        # category -> {correct, total}
    evade = {"caught": 0, "total": 0}  # recall on regex-evading injections
    misses = []         # false negatives (missed attacks)
    false_alarms = []   # false positives (flagged benign)

    for row in eval_rows:
        text, label = row["text"], int(row["label"])
        cat = row.get("category", "?")
        res = detector.detect(text)
        pred = 1 if res.is_injection else 0

        if label == 1 and pred == 1:
            tp += 1
            if res.threat_type in _REGEX_TYPES:
                layer_hits["regex"] += 1
            else:
                layer_hits["ml"] += 1
        elif label == 0 and pred == 1:
            fp += 1
            false_alarms.append((text, res.threat_type))
        elif label == 0 and pred == 0:
            tn += 1
        else:
            fn += 1
            misses.append((text, cat))

        c = per_cat.setdefault(cat, {"correct": 0, "total": 0})
        c["total"] += 1
        c["correct"] += 1 if pred == label else 0

        if label == 1 and row.get("evades_regex"):
            evade["total"] += 1
            evade["caught"] += 1 if pred == 1 else 0

    total = tp + fp + tn + fn
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    accuracy = (tp + tn) / total if total else 0.0
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    fnr = fn / (fn + tp) if (fn + tp) else 0.0

    return {
        "totals": {"n": total, "tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "metrics": {
            "precision": precision, "recall": recall, "f1": f1,
            "accuracy": accuracy, "false_positive_rate": fpr,
            "false_negative_rate": fnr,
        },
        "layer_attribution": layer_hits,
        "regex_evading_recall": (
            evade["caught"] / evade["total"] if evade["total"] else None
        ),
        "regex_evading_counts": evade,
        "per_category": per_cat,
        "false_negatives": misses,
        "false_positives": false_alarms,
    }


def write_report(r, layer2_kind, out_md):
    m = r["metrics"]
    t = r["totals"]
    lines = []
    lines.append("# Prompt-Injection Detection — Efficacy Benchmark\n")
    lines.append(
        "> Held-out synthetic eval corpus run through the real InjectionDetector "
        f"(regex Layer 1 + {layer2_kind} Layer 2). Internal regression baseline, "
        "not a third-party benchmark.\n"
    )
    lines.append("## Headline metrics\n")
    lines.append("| Metric | Value |")
    lines.append("|---|---|")
    lines.append(f"| Samples | {t['n']} |")
    lines.append(f"| **Precision** | **{pct(m['precision'])}** |")
    lines.append(f"| **Recall (detection rate)** | **{pct(m['recall'])}** |")
    lines.append(f"| **F1** | **{pct(m['f1'])}** |")
    lines.append(f"| Accuracy | {pct(m['accuracy'])} |")
    lines.append(f"| False-positive rate | {pct(m['false_positive_rate'])} |")
    lines.append(f"| False-negative rate | {pct(m['false_negative_rate'])} |")
    lines.append("")
    lines.append(
        f"Confusion: TP={t['tp']} FP={t['fp']} TN={t['tn']} FN={t['fn']}\n"
    )

    la = r["layer_attribution"]
    lines.append("## Layer attribution (of caught attacks)\n")
    lines.append(f"- Regex Layer 1: {la['regex']}")
    lines.append(f"- ML Layer 2 ({layer2_kind}): {la['ml']}")
    ev = r["regex_evading_counts"]
    if ev["total"]:
        lines.append("")
        lines.append(
            f"**Recall on regex-evading attacks: {pct(r['regex_evading_recall'])}** "
            f"({ev['caught']}/{ev['total']}) — these paraphrased attacks match no "
            "static signature, so they exercise Layer 2 generalization specifically."
        )
    lines.append("")

    lines.append("## Per-category accuracy\n")
    lines.append("| Category | Correct / Total |")
    lines.append("|---|---|")
    for cat in sorted(r["per_category"]):
        c = r["per_category"][cat]
        lines.append(f"| {cat} | {c['correct']}/{c['total']} |")
    lines.append("")

    if r["false_negatives"]:
        lines.append("## Missed attacks (false negatives)\n")
        for text, cat in r["false_negatives"]:
            lines.append(f"- _{cat}_ — {text}")
        lines.append("")
    if r["false_positives"]:
        lines.append("## False alarms (false positives)\n")
        for text, tt in r["false_positives"]:
            lines.append(f"- ({tt}) {text}")
        lines.append("")

    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--use-hf", action="store_true",
                    help="measure the HuggingFace transformer Layer 2 (needs torch)")
    args = ap.parse_args()

    if not args.use_hf:
        os.environ["INJECTION_HF_DISABLED"] = "true"
    layer2_kind = "transformer" if args.use_hf else "TF-IDF"

    train = load_jsonl(TRAIN)
    eval_rows = load_jsonl(EVAL)
    assert_no_overlap(train, eval_rows)
    print(f"loaded {len(train)} train / {len(eval_rows)} eval rows; no overlap.")

    from analyzer.injection_detector import InjectionDetector
    detector = InjectionDetector()

    r = evaluate(detector, eval_rows)
    r["config"] = {"layer2": layer2_kind, "train_n": len(train), "eval_n": len(eval_rows)}

    out_json = os.path.join(HERE, "results.json")
    out_md = os.path.join(HERE, "REPORT.md")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(r, f, indent=2)
    write_report(r, layer2_kind, out_md)

    m = r["metrics"]
    print("\n=== RESULTS ===")
    print(f"precision={pct(m['precision'])} recall={pct(m['recall'])} "
          f"f1={pct(m['f1'])} fpr={pct(m['false_positive_rate'])}")
    print(f"layer attribution: {r['layer_attribution']}")
    if r["regex_evading_recall"] is not None:
        print(f"regex-evading recall: {pct(r['regex_evading_recall'])}")
    print(f"wrote {out_json} and {out_md}")


if __name__ == "__main__":
    main()
