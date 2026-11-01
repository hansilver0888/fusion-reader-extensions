"""Summarise sweep results."""
import collections
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RESULTS = Path(__file__).parent / "sweep-results.jsonl"

STAGE_ORDER = ["content", "toc", "detail", "search", "explore", "none"]


def main():
    rows = [json.loads(line) for line in RESULTS.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(f"total rows: {len(rows)}")
    print("by stage  :", collections.Counter(r["stage"] for r in rows).most_common())
    print("by detail :", collections.Counter(r["detail"] for r in rows).most_common(12))
    ok = [r for r in rows if r["stage"] == "content"]
    print(f"\nfull chain OK: {len(ok)}")
    for r in sorted(ok, key=lambda x: -x["chars"])[:40]:
        print(f"  {r['chars']:>6} chars {r['chapters']:>4} ch  {r['name'][:20]:<22} {r['url'][:40]}")


if __name__ == "__main__":
    main()
