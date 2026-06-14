"""Parse govulncheck / pip-audit / npm audit outputs into one report.

Each scanner has a different format; this isolates the fragile parsing in one
place. -1 findings means the scanner was not installed (skipped, not "clean").
"""

import argparse
import json
import re
import sys


def parse_go(path):
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return -1
    if "not-installed" in text:
        return -1
    m = re.search(r"affected by (\d+) vulnerabilit", text)
    if m:
        return int(m.group(1))
    if "No vulnerabilities found" in text:
        return 0
    return -1


def parse_py(path):
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return -1
    if "not-installed" in raw or not raw.strip():
        return -1
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return -1
    deps = data.get("dependencies", data) if isinstance(data, dict) else data
    return sum(len(d.get("vulns", [])) for d in deps if isinstance(d, dict))


def parse_js(path):
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return -1
    if "not-installed" in raw or not raw.strip():
        return -1
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return -1
    return int(data.get("metadata", {}).get("vulnerabilities", {}).get("total", 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", required=True)
    ap.add_argument("--py", required=True)
    ap.add_argument("--js", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--timestamp", default="")
    args = ap.parse_args()

    comps = [
        {"name": "gateway (Go)", "scanner": "govulncheck", "findings": parse_go(args.go)},
        {"name": "ml_engine (Python)", "scanner": "pip-audit", "findings": parse_py(args.py)},
        {"name": "dashboard (Node)", "scanner": "npm audit", "findings": parse_js(args.js)},
    ]
    has_findings = any(c["findings"] > 0 for c in comps)
    report = {
        "generated_at": args.timestamp or "unknown",
        "status": "findings" if has_findings else "ok",
        "components": comps,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    for c in comps:
        n = c["findings"]
        label = "skipped" if n < 0 else f"{n} finding(s)"
        print(f"  {c['name']:24} {c['scanner']:14} {label}")
    sys.exit(1 if has_findings else 0)


if __name__ == "__main__":
    main()
