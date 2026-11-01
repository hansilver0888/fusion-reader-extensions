"""Port of the shuyuan plugin rule engine to Python for offline connectivity checks.

Mirrors sources/shuyuan.js: jsoup-style segments, plain CSS, an XPath subset,
a JSONPath subset, ##regex pipelines, {{}} templates with bounded arithmetic,
&&/|| combination, @put/@get variables, per-page <a,b> variants and the
,{method,body,headers} url options. Only used by build-cache tooling.
"""
import json
import re

ATTR_WORDS = {
    "href", "src", "content", "value", "alt", "title", "action", "id", "class", "style",
    "data-src", "data-original", "data-url", "data-echo", "poster", "url",
}
TEXT_WORDS = {"text", "textNodes", "html", "own", "all"}
MAX_TOKENS = object()


class EvalError(Exception):
    pass


def to_str(value):
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(v) for v in value if v is not None and not hasattr(v, "contents"))
    return str(value)


def calc(expr):
    """Bounded arithmetic: + - * / % and parentheses only."""
    text = re.sub(r"\s+", "", str(expr))
    if not text:
        return None
    tokens = re.findall(r"\d+(?:\.\d+)?|[+\-*/%()]", text)
    if not tokens or "".join(tokens) != text:
        return None
    values, ops = [], []

    def precedence(op):
        return 1 if op in "+-" else 2

    def apply():
        if len(values) < 2 or not ops:
            raise ValueError("bad expression")
        op = ops.pop()
        b = values.pop()
        a = values.pop()
        if op == "+":
            values.append(a + b)
        elif op == "-":
            values.append(a - b)
        elif op == "*":
            values.append(a * b)
        elif op == "/":
            values.append(a / b)
        else:
            values.append(a % b)

    try:
        for token in tokens:
            if re.match(r"[\d.]", token):
                values.append(float(token))
            elif token == "(":
                ops.append(token)
            elif token == ")":
                while ops and ops[-1] != "(":
                    apply()
                if not ops:
                    return None
                ops.pop()
            else:
                while ops and ops[-1] != "(" and precedence(ops[-1]) >= precedence(token):
                    apply()
                ops.append(token)
        while ops:
            apply()
    except (ValueError, ZeroDivisionError, IndexError):
        return None
    if len(values) != 1:
        return None
    value = values[0]
    return value if value == value and abs(value) != float("inf") else None


def split_regex(rule):
    text = str(rule or "")
    index = text.find("##")
    if index < 0:
        return {"body": text.strip()}
    rest = text[index + 2:].split("##")
    flags = re.sub(r"[^gimsuy]", "", rest[2] if len(rest) > 2 else "")
    return {
        "body": text[:index].strip(),
        "regex": rest[0] if rest else "",
        "repl": rest[1] if len(rest) > 1 else "",
        "flags": flags,
    }


def apply_regex(value, parts):
    pattern = parts.get("regex")
    if not pattern:
        return value
    try:
        regex = re.compile(pattern, re.S | re.I if "i" in (parts.get("flags") or "") else re.S)
    except re.error:
        return value
    repl = parts.get("repl") or ""

    def one(item):
        if isinstance(item, str):
            try:
                return regex.sub(repl.replace("$1", r"\1").replace("$2", r"\2").replace("$3", r"\3"), item)
            except re.error:
                return item
        return item

    return [one(v) for v in value] if isinstance(value, list) else one(value)


class Engine:
    def __init__(self, soup_factory):
        self.soup_factory = soup_factory
        self.vars = {}

    # ---------- dom helpers ----------
    def soup(self, html):
        return self.soup_factory(html or "")

    def query(self, html, selector):
        if not html or not selector:
            return []
        try:
            return self.soup(html).select(selector)
        except Exception:
            return []

    def node_text(self, node):
        return node.get_text() if node is not None else ""

    def node_html(self, node):
        return str(node) if node is not None else ""

    # ---------- templates ----------
    def fill(self, template, ctx):
        s = str(template or "")

        def variant(match):
            variants = match.group(1).split(",")
            page = max(1, int(ctx.get("page") or 1))
            return (variants[page - 1] if page <= len(variants) else variants[-1]).strip()

        s = re.sub(r"<([^<>]*)>", variant, s)
        out, last = "", 0
        for m in re.finditer(r"\{\{([\s\S]*?)\}\}", s):
            out += s[last:m.start()]
            out += self.template_value(m.group(1), ctx)
            last = m.end()
        return out + s[last:]

    def template_value(self, inner, ctx):
        token = str(inner).strip()
        if token == "baseUrl":
            return ctx.get("baseUrl") or ""
        if token == "key":
            return ctx.get("encodedKey") if ctx.get("encodedKey") is not None else (ctx.get("key") or "")
        substituted = re.sub(r"\bpage\b", str(int(ctx.get("page") or 1)), token)
        value = calc(substituted)
        if value is not None:
            return str(int(value)) if float(value).is_integer() else str(value)
        return to_str(self.eval_rule(token, ctx))

    # ---------- rules ----------
    def eval_rule(self, rule, ctx):
        text = str(rule or "").strip()
        if not text or re.search(r"<js[\s>]|@js:", text, re.I):
            return ""
        parts = split_regex(text)
        value = ctx.get("html", "") if not parts["body"] else self.eval_body(parts["body"], ctx)
        if parts.get("regex"):
            value = apply_regex(value, parts)
        return to_str(value)

    def eval_list(self, rule, ctx):
        text = str(rule or "").strip()
        if not text or re.search(r"<js[\s>]|@js:", text, re.I):
            return []
        parts = split_regex(text)
        value = self.eval_body(parts["body"], ctx) if parts["body"] else []
        if not isinstance(value, list):
            value = [] if value in ("", None) else [value]
        return value

    def eval_body(self, body, ctx):
        text = str(body or "").strip()
        if not text:
            return ""
        if "{{" in text:
            return self.fill(text, ctx)
        if re.match(r"^@put:", text, re.I):
            return self.put_vars(text, ctx)
        if re.match(r"^@get:", text, re.I):
            return self.get_var(text, ctx)
        if "&&" in text:
            parts = [to_str(self.eval_body(p, ctx)) for p in text.split("&&")]
            return "\n".join([p for p in parts if p])
        if "||" in text:
            for part in text.split("||"):
                value = self.eval_body(part.strip(), ctx)
                if isinstance(value, list) and value:
                    return value
                if not isinstance(value, list) and to_str(value) != "":
                    return value
            return ""
        return self.eval_one(text, ctx)

    def put_vars(self, rule, ctx):
        match = re.match(r"@put:\s*\{([\s\S]*)\}", rule, re.I)
        if not match:
            return ""
        for pair in re.finditer(r'"?([\w$-]+)"?\s*:\s*"((?:[^"\\]|\\.)*)"', match.group(1)):
            value = self.eval_rule(json.loads('"' + pair.group(2) + '"') if "\\" in pair.group(2) else pair.group(2), ctx)
            self.vars[(ctx.get("sourceUrl", ""), ctx.get("bookUrl", ""), pair.group(1))] = value
        return ""

    def get_var(self, rule, ctx):
        match = re.match(r'@get:\s*\{\s*"?([\w$-]+)"?\s*\}', rule, re.I)
        if not match:
            return ""
        return self.vars.get((ctx.get("sourceUrl", ""), ctx.get("bookUrl", ""), match.group(1)), "")

    def eval_one(self, rule, ctx):
        text = rule.strip()
        if re.match(r"^@xpath:", text, re.I) or text.startswith("//"):
            return self.eval_xpath(re.sub(r"^@xpath:", "", text, flags=re.I), ctx)
        if re.match(r"^@json:", text, re.I):
            return self.eval_jsonpath(re.sub(r"^@json:", "", text, flags=re.I).strip(), ctx)
        if text.startswith("$.") or text.startswith("$["):
            return self.eval_jsonpath(text, ctx)
        return self.eval_jsoup(re.sub(r"^@css:", "", text, flags=re.I), ctx)

    # ---------- jsoup default syntax ----------
    def parse_segment(self, segment):
        s = str(segment).strip()
        if not s:
            return None
        contains = None
        match = re.search(r":contains\((['\"]?)([\s\S]*?)\1\)", s)
        if match:
            contains = match.group(2)
            s = s.replace(match.group(0), "")
        eq = None
        match = re.search(r":eq\((\d+)\)", s)
        if match:
            eq = int(match.group(1))
            s = s.replace(match.group(0), "")
        match = re.match(r"^(class|tag|id)\.([\s\S]+)$", s, re.I)
        if match:
            name, index = match.group(2), None
            found = re.search(r"\.(-?\d+(?::-?\d+)?)$", name)
            if found:
                index = found.group(1)
                name = name[:found.start()]
            names = [n for n in re.split(r"\s+", name.strip()) if n]
            if not names:
                return None
            kind = match.group(1).lower()
            if kind == "class":
                css = "".join("." + n for n in names)
            elif kind == "id":
                css = "#" + names[0]
            else:
                css = " ".join(names)
            return {"selector": css, "contains": contains, "index": self.parse_index(index), "eq": eq}
        match = re.match(r"^text(?:Nodes)?\.(.+)$", s)
        if match:
            return {"selector": "a, li, span, div, p, button, font", "contains": match.group(1).strip(),
                    "textMatch": True, "index": None, "eq": None}
        match = re.match(r"^([A-Za-z][\w-]*)((?:\.-?\d+(?::-?\d+)?)?)$", s)
        if match and match.group(1) not in ATTR_WORDS and match.group(1) not in TEXT_WORDS:
            index = match.group(2)[1:] if match.group(2) else None
            return {"selector": match.group(1), "contains": contains, "index": self.parse_index(index), "eq": eq}
        return {"selector": s, "contains": contains, "index": None, "eq": eq}

    @staticmethod
    def parse_index(spec):
        if spec in (None, ""):
            return None
        match = re.match(r"^(-?\d+)(?::(-?\d+))?$", str(spec))
        if not match:
            return None
        return (int(match.group(1)), int(match.group(2)) if match.group(2) is not None else None)

    @staticmethod
    def pick(nodes, index):
        if not index or not nodes:
            return nodes
        start, end = index
        total = len(nodes)
        norm = lambda i: total + i if i < 0 else i
        if end is not None:
            return nodes[max(0, norm(start)):min(total, norm(end) + 1)]
        i = norm(start)
        return [nodes[i]] if 0 <= i < total else []

    def extract(self, nodes, target):
        out = []
        for node in nodes:
            if isinstance(node, dict) and "__html" in node:
                node = self.soup(node["__html"])
            elif isinstance(node, (str, int, float)):
                out.append(str(node))
                continue
            elif isinstance(node, dict):
                if target is None:
                    out.append(node)
                elif target in TEXT_WORDS:
                    out.append(str(node.get("name") or node.get("text") or ""))
                else:
                    out.append(str(node.get(target) or ""))
                continue
            if target is None:
                out.append(node)
            elif target in TEXT_WORDS:
                out.append(self.node_html(node) if target == "html" else self.node_text(node).strip())
            else:
                out.append((node.get(target) or "").strip())
        return out

    def eval_jsoup(self, rule, ctx):
        segments = [s.strip() for s in str(rule).split("@") if s.strip()]
        if not segments:
            return ""
        target = None
        if segments[-1] in TEXT_WORDS or segments[-1] in ATTR_WORDS:
            target = segments.pop()
        nodes = self.start_nodes(ctx)
        for segment in segments:
            if not nodes:
                break
            step = self.parse_segment(segment)
            if not step:
                continue
            nxt = []
            for node in nodes:
                # {"__html": ...} wrappers are page roots, not JSON items.
                if isinstance(node, dict) and "__html" not in node:
                    if "name" in step and step.get("selector"):
                        value = node.get(step["selector"])
                        if value is not None:
                            nxt.append(str(value))
                    continue
                html = self.node_html(node)
                found = self.query(html, step["selector"])
                if step.get("textMatch") and not found:
                    found = self.query(html, "li, span, div, p, font, button")
                if step.get("contains") is not None:
                    found = [n for n in found if step["contains"] in n.get_text()]
                if step.get("eq") is not None:
                    found = self.pick(found, (step["eq"], None))
                if step.get("index"):
                    found = self.pick(found, step["index"])
                nxt.extend(found)
            nodes = nxt
        values = self.extract(nodes, target)
        if target is None:
            return values
        return values[0] if len(values) == 1 else "\n".join(v for v in values if v)

    def start_nodes(self, ctx):
        item = ctx.get("item")
        if item is not None:
            return [item]
        return [{"__html": ctx.get("html", "")}]

    # ---------- xpath subset ----------
    def eval_xpath(self, expr, ctx):
        steps = self.parse_xpath(expr)
        if not steps:
            return ""
        nodes = self.start_nodes(ctx)
        target = None
        for step in steps:
            if step["tag"] is None:
                target = step["extract"]
                continue
            selector = step["tag"]
            for name, value in step["attrs"]:
                selector += f'[{name}="{value.replace(chr(34), "")}"]'
            nxt = []
            for node in nodes:
                if isinstance(node, dict):
                    continue
                found = self.query(self.node_html(node), selector)
                if step["contains"] is not None:
                    found = [n for n in found if step["contains"] in n.get_text()]
                if step["position"] is not None:
                    found = self.pick(found, (step["position"] - 1, None))
                if step["last"] is not None:
                    found = self.pick(found, (-(step["last"] + 1), None))
                nxt.extend(found)
            nodes = nxt
            if not nodes:
                break
        values = self.extract(nodes, target)
        if target is None:
            return values
        return values[0] if len(values) == 1 else "\n".join(v for v in values if v)

    def parse_xpath(self, expr):
        text = str(expr).strip()
        descendant = text.startswith("//")
        text = re.sub(r"^/+", "", text)
        steps, current, depth, quote = [], "", 0, None
        for char in text:
            if quote:
                current += char
                if char == quote:
                    quote = None
                continue
            if char in "\"'":
                quote = char
                current += char
                continue
            if char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
            if char == "/" and depth == 0:
                steps.append(current)
                current = ""
                continue
            current += char
        if current:
            steps.append(current)
        parsed, next_descendant = [], descendant
        for step in steps:
            if step == "":
                next_descendant = True
                continue
            item = self.parse_xpath_step(step)
            if not item:
                continue
            item["descendant"] = next_descendant
            next_descendant = False
            parsed.append(item)
        return parsed

    def parse_xpath_step(self, step):
        s = step.strip()
        if s in ("text()", "normalize-space()"):
            return {"tag": None, "extract": "text"}
        match = re.match(r"^@([\w-]+)$", s)
        if match:
            return {"tag": None, "extract": match.group(1)}
        out = {"tag": "*", "attrs": [], "contains": None, "last": None, "position": None, "extract": None}
        rest = s
        match = re.match(r"^([\w-]+|\*)", rest)
        if match:
            out["tag"] = match.group(1)
            rest = rest[match.end():]
        for predicate in re.findall(r"\[[^\]]*\]", rest):
            inner = predicate[1:-1].strip()
            found = re.match(r"^@([\w-]+)\s*=\s*(['\"])([\s\S]*?)\2$", inner)
            if found:
                out["attrs"].append((found.group(1), found.group(3)))
                continue
            found = re.match(r"^contains\(\s*(?:normalize-space\(\s*)?(?:text\(\)|\.)\s*,\s*(['\"])([\s\S]*?)\1\s*\)?\s*\)$", inner)
            if found:
                out["contains"] = found.group(2)
                continue
            found = re.match(r"^last\(\)\s*-\s*(\d+)$", inner)
            if found:
                out["last"] = int(found.group(1))
                continue
            if inner == "last()":
                out["last"] = 0
                continue
            found = re.match(r"^(?:position\(\)\s*=\s*)?(\d+)$", inner)
            if found:
                out["position"] = int(found.group(1))
        return out

    # ---------- jsonpath subset ----------
    def eval_jsonpath(self, expr, ctx):
        data = self.json_of(ctx)
        if data is None:
            return ""
        text = str(expr).strip()
        if not text.startswith("$"):
            return ""
        body = text[1:]
        if not body:
            return data
        tokens = re.findall(r"\.[\w$-]+|\[\d+\]|\[\*\]|\[['\"][^'\"]+['\"]\]", body)
        if "".join(tokens) != body:
            return ""
        current, map_mode = data, False
        for token in tokens:
            if current is None:
                break
            if token == "[*]":
                current = current if isinstance(current, list) else list(current.values())
                map_mode = True
                continue

            def step(value):
                if value is None:
                    return None
                if token.startswith("."):
                    return value.get(token[1:]) if isinstance(value, dict) else None
                if token.startswith("['"):
                    return value.get(token[2:-1]) if isinstance(value, dict) else None
                index = int(token[1:-1])
                return value[index] if isinstance(value, list) and index < len(value) else None

            current = [step(v) for v in current] if map_mode and isinstance(current, list) else step(current)
        if current is None:
            return ""
        if isinstance(current, list):
            return current
        return current if isinstance(current, str) else json.dumps(current, ensure_ascii=False)

    def json_of(self, ctx):
        item = ctx.get("item")
        if item is not None and isinstance(item, dict) and "__html" not in item:
            return item
        html = ctx.get("html")
        if isinstance(html, (dict, list)):
            return html
        if isinstance(html, str):
            text = html.strip()
            if text.startswith(("{", "[")):
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return None
        return None
