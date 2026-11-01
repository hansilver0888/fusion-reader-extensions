# 书源实测工具（维护者用）

这些脚本用于复核 `sources/shuyuan.js` 里的 `BUILTIN_SOURCES` 清单，**不参与构建**，
也不在 CI 中运行（需要访问外部书源站点）。离线测试见 `tests/shuyuan_test.mjs`。

## 流程

1. 下载上游书源合集（约 16 MB）到 `C:\Users\<you>\AppData\Local\Temp\shuyuan-good.json` 或任意位置，
   修改 `engine.py` / 脚本里的 `TMP` 常量指向它。
2. `python screen_shuyuan.py` 的等价步骤已合并进 `sweep.py` 前的过滤逻辑——若要重建候选集，
   用 `sweep.py` 读 `candidates-full.json`；该文件由首次筛选产生（见下）。
3. `python sweep.py [limit]` 对每个源执行「搜索 → 详情 → 目录 → 首章正文」，结果追加到
   `sweep-results.jsonl`，可中断续跑。
4. `python report.py` 汇总各阶段通过情况与全链路可用源。
5. `python baseline.py` 用指定书目（默认《山河稷》/姬叉）复核这些源是否真能搜到并阅读。

## 文件

| 文件 | 用途 |
|---|---|
| `engine.py` | `sources/shuyuan.js` 规则引擎的 Python 移植版（jsoup 语法 / CSS / XPath 子集 / JSONPath 子集 / `##正则` / `{{}}` 模板 / `<a,b>` 变体 / `@put`、`@get`） |
| `sweep.py` | 连通性实测：四步链路 + 规则解析，结果写 `sweep-results.jsonl` |
| `baseline.py` | 指定书目的可用性复核 |
| `report.py` | 结果汇总 |

## 注意

- 这里的判定标准就是插件的解析能力：Python 版与 JS 版**必须保持同一套语义**，
  改插件引擎时应同步改 `engine.py`，否则清单会失真。
- 清单是某一时刻的网络快照。站点失效、换域名、加验证后会失真，
  重新跑一遍 `sweep.py` 并更新 `BUILTIN_SOURCES` 与 `docs/shuyuan.md` 的表格即可。
- `*.jsonl` / `candidates*.json` / `debug-page.html` 属于中间产物，已在 `.gitignore` 中忽略。
