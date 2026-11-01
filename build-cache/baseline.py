"""Baseline test: can a source find 《山河稷》 by 姬叉, and read its body?

Picks the matching book from search results by title keywords, then walks
detail -> catalogue -> first chapter. Only sources that pass all four steps
against this specific book count towards the curated list.
"""
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from engine import Engine  # noqa: E402
from sweep import Session, absolute, build_url, decode, rule_obj  # noqa: E402

BASE = Path(__file__).parent
WORKERS = 12
TITLE_KEYS = ["山河稷", "山河"]
AUTHOR_KEYS = ["姬叉"]
lock = threading.Lock()


def soup_factory(html):
    return BeautifulSoup(html, "html5lib")


def matches(title, author):
    title = title or ""
    hit_title = any(key in title for key in TITLE_KEYS)
    hit_author = (not author) or any(key in (author or "") for key in AUTHOR_KEYS)
    return hit_title and hit_author


def find_book(engine, source, rule, html, base_url, extra):
    """Return (title, author, url) of the matching book, else None."""
    ctx = dict(html=html, source=source, baseUrl=base_url, sourceUrl=source.get("bookSourceUrl"), **extra)
    items = engine.eval_list(str(rule.get("bookList") or ""), ctx)
    for item in items[:40]:
        sub = dict(ctx, item=item)
        title = str(engine.eval_rule(str(rule.get("name") or ""), sub) or "").strip()
        author = str(engine.eval_rule(str(rule.get("author") or ""), sub) or "").strip()
        url = absolute(base_url, engine.eval_rule(str(rule.get("bookUrl") or ""), sub))
        if url and matches(title, author):
            return title, author, url
    return None


def check(source, engine_factory):
    engine = engine_factory()
    session = Session()
    record = {"name": source.get("bookSourceName") or "", "url": source.get("bookSourceUrl"),
              "group": source.get("bookSourceGroup"), "stage": "none", "detail": "",
              "book": "", "author": "", "chapters": 0, "chars": 0}
    try:
        search_rule = rule_obj(source, "ruleSearch")
        found = None
        search_url = str(source.get("searchUrl") or "").strip()
        if search_url and str(search_rule.get("bookList") or "").strip():
            ctx = {"source": source, "baseUrl": source.get("bookSourceUrl"), "key": "山河稷", "page": 1,
                   "sourceUrl": source.get("bookSourceUrl")}
            built = build_url(engine, search_url, ctx, source)
            if built:
                url, method, body, headers = built
                raw = session.get(url, headers) if method == "get" else session.post(url, body, headers)
                html = decode(raw)
                if html and len(html) > 200:
                    record["stage"] = "search"
                    found = find_book(engine, source, search_rule, html, url, {"key": "山河稷", "page": 1})
        if not found:
            record["detail"] = "书未搜到"
            return record
        record["book"], record["author"], book_url = found

        detail_html = decode(session.get(book_url))
        if not detail_html:
            record["detail"] = "详情页打不开"
            return record
        info = rule_obj(source, "ruleBookInfo")
        ctx = {"html": detail_html, "source": source, "baseUrl": book_url, "bookUrl": book_url,
               "sourceUrl": source.get("bookSourceUrl")}
        title = str(engine.eval_rule(str(info.get("name") or ""), ctx) or "").strip()
        if not title:
            record["detail"] = "详情无书名"
            return record
        record["stage"] = "detail"

        toc_rule = rule_obj(source, "ruleToc")
        chapters = engine.eval_list(str(toc_rule.get("chapterList") or ""), ctx)
        if not chapters:
            record["detail"] = "无目录"
            return record
        links = []
        for item in chapters[:5]:
            href = absolute(book_url,
                            engine.eval_rule(str(toc_rule.get("chapterUrl") or "href"), dict(ctx, item=item)))
            if href:
                links.append(href)
        if not links:
            record["detail"] = "目录无链接"
            return record
        record["stage"] = "toc"
        record["chapters"] = len(chapters)

        content_rule = rule_obj(source, "ruleContent")
        chapter_html = decode(session.get(links[0]))
        if not chapter_html:
            record["detail"] = "正文页打不开"
            return record
        body_text = engine.eval_rule(str(content_rule.get("content") or ""),
                                     {"html": chapter_html, "source": source, "baseUrl": links[0],
                                      "bookUrl": book_url, "sourceUrl": source.get("bookSourceUrl")})
        plain = re.sub(r"\s+", "", re.sub(r"<[^>]+>", "", str(body_text or "")))
        record["chars"] = len(plain)
        if len(plain) < 120:
            record["detail"] = "正文过短"
            return record
        record["stage"] = "content"
        record["detail"] = "可用"
        return record
    except Exception as exc:  # noqa: BLE001
        record["detail"] = f"error {type(exc).__name__}"
        return record
    finally:
        session.client.close()


def main():
    # Default to the sources that already passed the full link chain, so the
    # baseline only re-tests the promising ones.
    source_file = BASE / "candidates-hit42.json"
    if not source_file.exists():
        source_file = BASE / "candidates-full.json"
    candidates = json.loads(source_file.read_text(encoding="utf-8"))
    print(f"using {source_file.name}: {len(candidates)} sources", flush=True)
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limit:
        candidates = candidates[:limit]
    out_path = BASE / "baseline-results.jsonl"
    done = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["url"])
            except (json.JSONDecodeError, KeyError):
                continue
    todo = [c for c in candidates if c.get("bookSourceUrl") not in done]
    print(f"candidates={len(candidates)} done={len(done)} todo={len(todo)}", flush=True)
    engine_factory = lambda: Engine(soup_factory)  # noqa: E731
    started = time.time()
    hits = 0
    with out_path.open("a", encoding="utf-8") as sink, ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(check, source, engine_factory): source for source in todo}
        for index, future in enumerate(as_completed(futures), 1):
            record = future.result()
            if record["stage"] == "content":
                hits += 1
            with lock:
                sink.write(json.dumps(record, ensure_ascii=False) + "\n")
                sink.flush()
            if record["stage"] == "content":
                print(f"  HIT [{hits}] {record['book'][:18]} / {record['author'][:8]} "
                      f"{record['chapters']}ch {record['chars']}chars {record['name'][:16]}", flush=True)
            if index % 40 == 0:
                print(f"[{index}/{len(todo)}] {time.time() - started:.0f}s hits={hits}", flush=True)
    print(f"baseline finished: {hits} usable for 山河稷", flush=True)


if __name__ == "__main__":
    main()
