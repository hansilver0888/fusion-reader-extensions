# 包子漫畫 v1.0.2

2026-11-01 实测 `www.baozimh.com`，完成单文件插件（`@type manga`）。只读取公开页面与图片，不登录、不写入。

## 站点结构

| 能力 | 实现方式 |
| --- | --- |
| 列表卡片 | `div.comics-card` > `a.comics-card__poster[href][title]` > `amp-img[src]`（封面 `static-tw.baozimh.com/cover/<slug>.jpg`） |
| 最近更新 | `/list/new`（**单页**，忽略 `?page`） |
| 分类 | `/classify?type=…&region=…&state=…&filter=%2a`，支持 `&page=N` |
| 搜索 | `/search?q=<关键词>`（单页） |
| 详情 | `/comic/<slug>`；章节链接为 `/user/page_direct?comic_id=<slug>&section_slot=<s>&chapter_slot=<n>` |
| 阅读 | 该链接会重定向到阅读页，`<amp-img src>` 即页面图（`s1.bzcdn.net/scomic/<slug>/<s>/<n>-<hash>/<page>.jpg`） |

## 浏览器验证（gatekeeper）

站点有一层自建校验，未通过时所有请求返回：

```json
{"challenge_url":"/__gatekeeper_challenge/start?return=%2F","error":"challenge_required"}
```

流程（插件已实现，全部在 `passGate()` 内）：

1. 打开 `/__gatekeeper_challenge/start?return=<路径>`，拿到 `challengeId` / `ticket` / `verifyUrl` / `difficultyBits`，同时站点下发 `__Host-gk_browser_*` cookie；
2. 找满足 `leadingZeroBits(sha256("gatekeeper-pow-v1:" + challengeId + ":" + nonce)) >= difficultyBits` 的 `nonce`（实测 16 位）；
3. `POST verifyUrl`，body `{challenge_id, ticket, nonce}`，需带 `Content-Type: application/json`、`Origin` 与同源 `Referer`（缺了会返回 `binding_mismatch`）；
4. 站点下发 `__Host-gk_clearance_*`，之后整站（含图片 CDN）可读；过期后再次被挑战，插件会自动重解并重试一次。

**性能**：QuickJS 没有人 WebCrypto。插件自带 SHA-256，并把「固定前缀 + challengeId」的前一块压缩预计算，每轮只压最后一块，实测 16 位约 **5.6 秒**（朴素写法 15–19 秒）。已用 node `crypto` 对拍：8/12/16 位得到的 nonce 前导零位数分别为 9/12/19，全部满足。

## 已支持

- 6 个频道：最近更新、分類（全部）、國漫、日漫、韓漫、連載中（后 5 个支持分页）。
- 搜索（关键词）。
- 详情：标题、封面、简介、章节列表。
- 阅读：整章页面图片按顺序返回。

## 未支持

- 书架/账号、下载不涉及；`/list/new` 与 `/search` 站点本身只有一页，不做假分页。

## 验证

- 新增 11 项离线测试，仓库合计 130 项通过；覆盖 SHA-256/PoW 正确性（含 node 对拍）、挑战检测与重试、卡片解析与去重、频道分页（更新流不加 page、目录加 page）、搜索编码、详情章节、阅读取图顺序、无章节/无图片报错、地址校验。
- 线上实测（`node tools/check_baozimh.mjs`，9 次插件请求）：

```
频道 6 个；目录第 1/2 页各 37 条且不同；搜索「死靈法師」10 条
详情：死靈法師！我即是天災，288 章
阅读：第 285 話 50 页，首图 200 / 192042 字节
cookie：__Host-gk_browser_*、__Host-gk_clearance_*
```

- 仓库索引生成与脚本大小、SHA-256 检查通过。

复测：

```sh
node --test tests/baozimh_test.mjs
node tools/check_baozimh.mjs
python tools/build_repository.py
```

联网测试独立于 CI，不把页面、cookie 或图片地址保存到仓库；离线测试使用原创占位 HTML，只沿用站点 URL 形状与类名。站点结构、难度位与校验脚本都可能变化，实际结果以设备测试为准。
