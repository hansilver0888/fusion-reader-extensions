# MissAV v1.1.2

2026-10-31 用真实会话核对 `missav.ai`，完成单文件插件。只读取公开页面，不登录、不写入、不调用广告或统计接口。

## 前提：站点由 Cloudflare 挑战保护

| 请求 | 结果 |
| --- | --- |
| 不带会话访问 `/`、`/cn/new`、`/api/…` | 403 `Just a moment...` |
| `/sitemap.xml` | 200（只是 URL 清单，没有播放地址） |
| 带浏览器 Cookie（`cf_clearance=…`）+ 同浏览器 UA | **200**，页面完整 |

实测要点（同一台机器逐项对比）：

| 请求形态 | 结果 |
| --- | --- |
| `Cookie: cf_clearance=<token>` + 原 Android UA | 200，12 张卡 |
| 只贴令牌值（没有 `cf_clearance=` 名称） | 403 |
| 同一 Cookie + Windows Chrome UA | 403 |
| 同一 Cookie + 不带 UA | 403 |
| 同一 Cookie + jar 里的 `__cf_bm` | 200 |
| 同一 Cookie + 重复的 `cf_clearance` | 200 |
| 直连 / 走 Clash 代理 | 都是 200 |

所以两件事必须成立：**Cookie 要带名称**，**UA 要与通过验证的浏览器一致**；线路不是变量。`cf_clearance` 有效期数小时到数天。

### 一个框就能填（v1.1.2）

把浏览器里复制的 `cookie: … ua: …` 整段（或 DevTools「Copy as cURL」整行）粘进「瀏覽器 Cookie」，插件会同时取出 Cookie 与 UA；UA 字段留空也可以。若只有 Cookie、UA 未知，入口探测会用内置候选 UA 依次试（Android Chrome 156 / Android Chrome 131 / Windows Chrome 131），命中后写回设置，下次启动一次请求即可。

### 本体侧的 Cookie 头合并（v1.1.1）

本体的 `dio_cookie_manager 3.5.0` 在 `loadCookies()` 里只读**小写**的 `cookie` 头，再把请求头与它自带的 cookie jar 合并回写。插件原来只设大写 `Cookie`，于是当站点第一次响应写入 `__cf_bm` 后，jar 非空、请求头被替换成 jar 的内容，`cf_clearance` 不再发出，之后每次读取都被挑战。现在两种大小写同时发送，clearance 在合并后仍然保留。报错里也会附上「本次送出 Cookie 长度 / UA 是否自定义」，便于判断设置有没有生效。

## 站点结构（2026-10-31 实测）

| 能力 | 实现方式 |
| --- | --- |
| 语言入口 | `/<lang>`（cn / en / ja / ko …），站点会 302 到带 `dm<N>` 前缀的等价地址 |
| 列表 | `/<lang>/new`、`/release`、`/today-hot`、`/weekly-hot`、`/monthly-hot`、`/chinese-subtitle`、`/english-subtitle`、`/uncensored-leak`，分页 `?page=N` |
| 搜索 | `/<lang>/search/<关键词>`，分页 `?page=N` |
| 作品页 | `/<lang>/<番号>`（链接有时带轮换的 `/dm<N>` 前缀，两种等价） |
| 列表卡片 | `div.thumbnail.group`：`a[href]` 指向作品、`img.lozad` 的 `data-src` 是封面（`fourhoi.com/<番号>/cover-t.jpg`）、`alt` 是标题、右下角 `span` 是时长 |
| 详情 | `og:title` / `og:image`（`cover-n.jpg`）/ `og:description`，`<h1>` 兜底 |
| 播放 | 页面用打包字典拼装 surrit 地址；uuid 直接印在缩略图条（`surrit.com/<uuid>/seek/_0.jpg`），据此还原 `https://surrit.com/<uuid>/1080p|720p/video.m3u8` 与页面默认的 `source842.m3u8` |

## 已支持

- 8 个列表入口 + 关键词搜索，分页。
- 列表卡片：标题、封面、时长。
- 详情：标题、封面、简介；目录按画质列出 **1080p / 720p / 預設** 三档，某一档不可用时可换另一档播放。
- 播放：从作品页还原 surrit 播放列表地址，带 `Referer` 返回；若播放域名单独要求验证，可在设置里填该域名的 Cookie（`stream_cookie`）。
- 设置项：`cookie`（浏览器 Cookie）、`user_agent`（同浏览器 UA）、`stream_cookie`（播放域名 Cookie，可空）、`language`（默认 `cn`）、`host`（可选入口覆盖）。
- 入口自动解析：`missav.ai` → `missav.ws` → `missav.live`，以「`/<lang>` 不是挑战页且含卡片」为可用判据。
- 读取节流：请求串行且间隔不小于 300 毫秒，页面缓存 30 秒。

## 未完成 / 已知限制

- **播放域名 `surrit.com` 有自己的 Cloudflare 策略**：本机用同一会话请求 `source842.m3u8` 返回 403（带/不带 Referer、走代理都一样）。插件能正确还原地址，但该 CDN 是否放行取决于客户端与网络；必要时在设置里填 `stream_cookie`（在浏览器打开该视频后，复制 `surrit.com` 的 `cf_clearance`）。播放器侧（mpv）未在本机验证。
- 栏目页（演员、片商、类型）未接入；列表/搜索已覆盖日常使用。
- 站点账号功能（收藏、评论、下载券）不做。

## 验证

- 新增 12 项离线测试，与项目其余测试合计 123 项通过；覆盖 Cookie/UA 归一化（含 cURL 粘贴）、入口家族与挑战回退、语言根探测、列表/搜索路径与分页、卡片块解析（栏目链接不会被当作品）、`dm` 前缀与番号校验、详情元数据与三档画质、uuid 还原与画质选择、显式 m3u8 兜底、挑战页提示、设置注册。
- 线上实测（`node tools/check_missav.mjs`，带真实会话，6 次请求）：入口 `https://missav.ai`、语言 `cn`、8 个分类；最新第 1、2 页各 12 项；發售 12 项；搜索「成熟女性群交射精派对」命中 1 项；详情标题 `MINA-019 成熟女性群交射精派对 月野友音 - 月野ゆりね`、封面 `fourhoi.com/mina-019/cover-n.jpg`；播放地址还原为 `surrit.com/e0258f43-…/source842.m3u8`，该域名在本机返回 403（记录为“播放域名拒绝了此客户端”）。
- 仓库索引生成与脚本大小、SHA-256 检查通过。

复测：

```sh
node --test tests/missav_test.mjs
MISSAV_COOKIE='cf_clearance=…; 其他=…' MISSAV_USER_AGENT='与浏览器一致' node tools/check_missav.mjs
python tools/build_repository.py
```

联网测试独立于 CI，不把页面、Cookie 或播放地址保存到仓库；离线测试使用原创占位 HTML，只沿用站点 URL 形状、类名与元数据字段名。站点结构、挑战策略与 CDN 策略都可能变化，实际结果以设备测试为准。
