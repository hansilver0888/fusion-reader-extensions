"""Connectivity sweep for shuyuan-bak candidates.

Runs the same four-step chain the plugin runs (search -> detail -> catalogue ->
first chapter) against every candidate source and records which step each
source reaches. Results are appended to build-cache/sweep-results.jsonl so a
run can resume.
"""
import json
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from engine import Engine  # noqa: E402

OUT = Path(__file__).parent
WORKERS = 12
TIMEOUT = 20
KEYWORDS = ["诡秘之主", "斗破苍穹", "三体", "庆余年", "凡人修仙传", "牧神记"]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
lock = threading.Lock()


def soup_factory(html):
    return BeautifulSoup(html, "html5lib")


def rule_obj(source, key):
    value = source.get(key)
    return value if isinstance(value, dict) else {}


def normalise(url):
    match = re.match(r"^(https?://[^/?#]+)(/[^?#]*)(.*)$", url)
    if not match:
        return url
    path = match.group(2)
    if "/./" in path or "/../" in path or path.endswith(("/..", "/.")):
        stack = []
        for segment in path.split("/"):
            if segment in ("", "."):
                continue
            if segment == "..":
                if stack:
                    stack.pop()
            else:
                stack.append(segment)
        path = "/" + "/".join(stack) + ("/" if path.endswith("/") and stack else "")
    return match.group(1) + path + match.group(3)


def absolute(base, ref):
    ref = str(ref or "").strip()
    if not ref or ref.startswith(("data:", "javascript:")):
        return ""
    if ref.startswith("//"):
        return "https:" + ref
    if re.match(r"^https?://", ref, re.I):
        return ref
    match = re.match(r"^(https?://[^/?#]+)", base or "")
    if not match:
        return ""
    origin = match.group(1)
    if ref.startswith("/"):
        return normalise(origin + ref)
    path = re.match(r"^https?://[^/?#]+(/[^?#]*)", base or "")
    directory = path.group(1).rsplit("/", 1)[0] + "/" if path else "/"
    return normalise(origin + directory + ref)


class Session:
    def __init__(self):
        self.client = requests.Session()
        self.client.trust_env = False
        self.client.headers.update({"User-Agent": UA})

    def get(self, url, headers=None):
        try:
            response = self.client.get(url, headers=headers or {}, timeout=TIMEOUT, allow_redirects=True)
            if response.status_code >= 400:
                return None
            return response.content
        except Exception:  # noqa: BLE001
            return None

    def post(self, url, data, headers=None):
        try:
            response = self.client.post(url, data=data, headers=headers or {}, timeout=TIMEOUT,
                                        allow_redirects=True)
            if response.status_code >= 400:
                return None
            return response.content
        except Exception:  # noqa: BLE001
            return None


def decode(raw):
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw
    for encoding in ("utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def build_url(engine, template, ctx, source):
    """Return (url, method, body, headers) or None. Mirrors buildUrl() in the plugin."""
    text = str(template or "").strip()
    option = None
    match = re.search(r",\s*(\{[\s\S]*\})\s*$", text)
    if match:
        try:
            option = json.loads(match.group(1))
        except json.JSONDecodeError:
            option = None
        text = text[:match.start()].strip()
    url_ctx = dict(ctx)
    if ctx.get("key") is not None:
        url_ctx["encodedKey"] = quote(str(ctx["key"]), safe="")
    url = absolute(ctx.get("baseUrl") or source.get("bookSourceUrl"), engine.fill(text, url_ctx))
    if not url:
        return None
    headers = {}
    if isinstance(source.get("header"), str) and source["header"].strip().startswith("{"):
        try:
            headers.update(json.loads(source["header"]))
        except json.JSONDecodeError:
            pass
    if option and isinstance(option.get("headers"), dict):
        headers.update(option["headers"])
    method = str((option or {}).get("method") or "get").lower()
    if method != "post":
        return url, "get", None, headers
    content_type = headers.get("Content-Type") or headers.get("content-type") or ""
    if re.search(r"json", content_type, re.I):
        encoded = json.dumps(str(ctx.get("key") or ""))[1:-1]
    else:
        encoded = quote(str(ctx.get("key") or ""), safe="")
    body = engine.fill(str((option or {}).get("body") or ""), dict(ctx, encodedKey=encoded))
    if not content_type:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    return url, "post", body, headers


def fetch_built(session, built):
    url, method, body, headers = built
    return session.get(url, headers) if method == "get" else session.post(url, body, headers)


def pick_book(engine, source, rule, html, base_url, extra):
    ctx = dict(html=html, source=source, baseUrl=base_url, sourceUrl=source.get("bookSourceUrl"), **extra)
    items = engine.eval_list(str(rule.get("bookList") or ""), ctx)
    for item in items[:6]:
        sub = dict(ctx, item=item)
        title = str(engine.eval_rule(str(rule.get("name") or ""), sub) or "").strip()
        url = absolute(base_url, engine.eval_rule(str(rule.get("bookUrl") or ""), sub))
        if title and url:
            return title, url
    return "", ""


def check_source(source, engine_factory):
    engine = engine_factory()
    session = Session()
    record = {"name": source.get("bookSourceName") or "", "url": source.get("bookSourceUrl"),
              "group": source.get("bookSourceGroup"), "stage": "none", "detail": "",
              "chapters": 0, "chars": 0}
    try:
        search_rule = rule_obj(source, "ruleSearch")
        book_url = ""
        keyword = random.choice(KEYWORDS)
        search_url = str(source.get("searchUrl") or "").strip()
        if search_url and str(search_rule.get("bookList") or "").strip():
            ctx = {"source": source, "baseUrl": source.get("bookSourceUrl"), "key": keyword, "page": 1,
                   "sourceUrl": source.get("bookSourceUrl")}
            built = build_url(engine, search_url, ctx, source)
            if built:
                html = decode(fetch_built(session, built))
                if html and len(html) > 200:
                    record["stage"] = "search"
                    _, book_url = pick_book(engine, source, search_rule, html, built[0],
                                            {"key": keyword, "page": 1})
        if not book_url and str(source.get("exploreUrl") or "").strip():
            explore_rule = rule_obj(source, "ruleExplore")
            rule = explore_rule if str(explore_rule.get("bookList") or "").strip() else search_rule
            first = str(source["exploreUrl"]).strip().splitlines()[0]
            entry = re.match(r"^([^:]+)::(.+)$", first)
            if entry and str(rule.get("bookList") or "").strip():
                ctx = {"source": source, "baseUrl": source.get("bookSourceUrl"), "page": 1,
                       "sourceUrl": source.get("bookSourceUrl")}
                built = build_url(engine, entry.group(2).strip(), ctx, source)
                if built:
                    html = decode(fetch_built(session, built))
                    if html:
                        record["stage"] = "explore"
                        _, book_url = pick_book(engine, source, rule, html, built[0], {"page": 1})
        if not book_url:
            record["detail"] = "no book"
            return record

        detail_html = decode(session.get(book_url))
        if not detail_html:
            record["detail"] = "detail http"
            return record
        info = rule_obj(source, "ruleBookInfo")
        ctx = {"html": detail_html, "source": source, "baseUrl": book_url, "bookUrl": book_url,
               "sourceUrl": source.get("bookSourceUrl")}
        title = str(engine.eval_rule(str(info.get("name") or ""), ctx) or "").strip()
        if not title:
            record["detail"] = "detail title"
            return record
        record["stage"] = "detail"
        record["detail"] = title[:40]

        toc_rule = rule_obj(source, "ruleToc")
        chapters = engine.eval_list(str(toc_rule.get("chapterList") or ""), ctx)
        if not chapters:
            record["detail"] = "no toc"
            return record
        links = []
        for item in chapters[:5]:
            href = absolute(book_url,
                            engine.eval_rule(str(toc_rule.get("chapterUrl") or "href"), dict(ctx, item=item)))
            if href:
                links.append(href)
        if not links:
            record["detail"] = "no chapter link"
            return record
        record["stage"] = "toc"
        record["chapters"] = len(chapters)

        content_rule = rule_obj(source, "ruleContent")
        chapter_html = decode(session.get(links[0]))
        if not chapter_html:
            record["detail"] = "chapter http"
            return record
        body_text = engine.eval_rule(str(content_rule.get("content") or ""),
                                     {"html": chapter_html, "source": source, "baseUrl": links[0],
                                      "bookUrl": book_url, "sourceUrl": source.get("bookSourceUrl")})
        plain = re.sub(r"\s+", "", re.sub(r"<[^>]+>", "", str(body_text or "")))
        record["chars"] = len(plain)
        if len(plain) < 120:
            record["detail"] = "thin body"
            return record
        record["stage"] = "content"
        return record
    except Exception as exc:  # noqa: BLE001 - the sweep must never abort
        record["detail"] = f"error {type(exc).__name__}"
        return record
    finally:
        session.client.close()


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    candidates = json.loads((OUT / "candidates-full.json").read_text(encoding="utf-8"))
    if limit:
        candidates = candidates[:limit]
    results_path = OUT / "sweep-results.jsonl"
    done = set()
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["url"])
            except (json.JSONDecodeError, KeyError):
                continue
    todo = [c for c in candidates if c.get("bookSourceUrl") not in done]
    print(f"candidates={len(candidates)} done={len(done)} todo={len(todo)}", flush=True)
    engine_factory = lambda: Engine(soup_factory)  # noqa: E731
    started = time.time()
    with results_path.open("a", encoding="utf-8") as sink, ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(check_source, source, engine_factory): source for source in todo}
        for index, future in enumerate(as_completed(futures), 1):
            record = future.result()
            with lock:
                sink.write(json.dumps(record, ensure_ascii=False) + "\n")
                sink.flush()
            if index % 20 == 0:
                print(f"[{index}/{len(todo)}] {time.time() - started:.0f}s "
                      f"{record['name'][:14]} -> {record['stage']} {record['detail']}", flush=True)
    print("sweep finished", flush=True)


if __name__ == "__main__":
    main()
