# 包子漫畫 v1.1.0

## v1.1.0：改用镜像域名，彻底去掉卡死源

**卡死的原因**：`baozimh.com` 有一层自建的**工作量证明**校验（gatekeeper），插件必须算 `sha256("gatekeeper-pow-v1:<id>:<nonce>")` 找前导零。这个循环在 QuickJS 里是**同步执行**的，占满宿主线程；即使分批让出，页面慢时多次重试仍会累积成长时间阻塞——这就是「加载慢就卡死」的来源。

**参考来源**：<https://github.com/Aidoku-Community/sources/tree/main/sources/zh.baozimanhua> 的 `source.json` 列了 15 个域名，说明站点有大量镜像。实测确认了关键事实：

| 域名 | 结果 |
| --- | --- |
| `www.baozimh.com` / `cn.baozimh.com` | **需要 gatekeeper**（403 challenge） |
| `tw.baozimh.com` | Cloudflare 硬拦截 |
| **`www.twmanga.com`** | 200，整页 198KB，**无校验**，1.2s |
| **`cn.twmanga.com`** / **`www.webmota.com`** / **`cn.webmota.com`** | 200，无校验，0.7–1.2s |
| **`www.dinnerku.com`** / **`www.kukuc.co`** | 200，无校验，1.1–1.3s |

**结论**：同一套内容在镜像上是完全开放的，根本不需要算 PoW。

**改动**：

- 删除全部 SHA-256 / PoW / gatekeeper 代码（约 6.4KB）
- 入口改为**镜像自动选择**：依次探测 6 个镜像的 `/list/new`，第一个返回合法列表的作为本次会话入口；某个镜像之后开始失败时自动换下一个
- 章节链接即使带旧域名，也会被规整为路径、跟随当前镜像
- 页面缓存从 30 秒放宽到 60 秒（镜像响应稳定，无须频繁刷新）

**实测对比**（同一台机器）：

| 指标 | v1.0.4（PoW） | v1.1.0（镜像） |
| --- | --- | --- |
| 离线测试耗时 | 8–14 秒 | **26 毫秒** |
| 首屏请求数 | 9 次 | **7 次** |
| 需要的 cookie | `__Host-gk_clearance_*` | **无** |
| 频道内容 | 6 个 | 6 个（全部不同，已核验） |
| 详情 / 阅读 | 正常 | 正常（191 章、50 图、首图 200） |

## v1.0.4 修正（章节名不显示）


本体把章节读成 `MediaEpisode{name, url}`，详情页用 `ep.name` 渲染（`detail_page.dart:506`）。v1.0.3 返回的是 `{title, url}`，`name` 为空 → 界面上只剩序号、章节名空白。

修法：章节条目改为 `{name, url}`（分组仍是 `{title, urls}`）。仓库内其他漫画/小说插件本来就统一用 `name`，只有本插件写错。

实测（《死靈法師！我即是天災》287 章）：每章都有非空 `name`，无 `title` 键，顺序 001 → 285。

## v1.0.3 修正

| 问题 | 原因 | 修法 |
| --- | --- | --- |
| 章节顺序乱、章节名为空 | 作品页把章节**从新到旧**排列（`chapter_slot` 286 → 0），且同一章会因分卷（`comic_id` 带 `_xxxxxx`）出现两次；部分条目内文是纯文本而非嵌套 `<span>` | 按 `section_slot:chapter_slot` 去重后**升序**输出；标题取内文文本（含纯文本），取不到时回退为「第 N 話」 |
| 频道标签无法使用：选择日漫/韩漫后所有标签都显示选中且内容不变 | `channels()` 的 `key` 读的是 `section.key`，但分页改造后 `SECTIONS` 只剩 `path`/`paged` 字段，于是 6 个频道的 `key` 全是 `undefined`。本体用 `_channelKey == channel.key` 逐个比对 chip，`undefined == undefined` 让**每个标签都命中**；点击写入的也是 `undefined`，`latest()` 回落到第一个频道 | `channels()` 改用**下标字符串**作 key（`"0"`…`"5"`），与 `latest()` 的解析一致；并加回归测试断言 key 唯一且非空 |


2026-11-01 实测 `www.baozimh.com`，完成单文件插件（`@type manga`）。只读取公开页面与图片，不登录、不写入。

## 站点结构

| 能力 | 实现方式 |
| --- | --- |
| 列表卡片 | `div.comics-card` > `a.comics-card__poster[href][title]` > `amp-img[src]`（封面 `static-tw.baozimh.com/cover/<slug>.jpg`） |
| 最近更新 | `/list/new`（**单页**，忽略 `?page`） |
| 频道 key | `channels()` 的 key 用下标字符串，本体据此判断选中态 |
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
