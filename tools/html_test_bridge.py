# SPDX-License-Identifier: MIT
"""HTML5 parsing fixture for host-compatible offline plugin tests; no networking."""
import json
import sys
from bs4 import BeautifulSoup

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
for raw in sys.stdin:
    request = json.loads(raw)
    try:
        document = BeautifulSoup(request["html"], "html5lib")
        nodes = document.select(request["selector"])
        result = []
        for element in nodes:
            attrs = {key: " ".join(value) if isinstance(value, list) else str(value)
                     for key, value in element.attrs.items()}
            result.append({"text": element.get_text(), "content": str(element), "attributes": attrs})
        print(json.dumps({"id": request["id"], "result": result}), flush=True)
    except Exception:
        print(json.dumps({"id": request["id"], "error": "HTML selector failed"}), flush=True)
