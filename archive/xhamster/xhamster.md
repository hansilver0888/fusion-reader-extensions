# xHamster v1.0.0

2026-10-31 核对 `xhamster.com`，完成单文件插件。选它作为「被 Cloudflare 拦住的同类站点」的替代：整站对普通客户端可读，视频页直出可播的 HLS 主清单，且日系 / 無碼 / JAV 分区里有 uncensored 内容。

## 为什么不是 jable.tv

| 站点 | 本机实测 | 结论 |
| --- | --- | --- |
| `jable.tv` | `/`、`/latest-updates/`、`/categories/`、`/sitemap.xml`、`http://` 全部 **403 `Just a moment...`**；只有 `robots.txt` 200 | Cloudflare 挑战，非浏览器客户端读不到 |
| `javgg.net` | 403 `Checking Browser`（自定义挑战，448 KB 诱饵页） | 不可用 |
| `supjav.com` / `javhdporn.net` | 403 `Just a moment...` | 不可用 |
| `sextb.net` | 403 `Access Restricted`（地区限制） | 不可用 |
| `123av.com` | 200，可读；播放是第三方嵌入 `sadie-shop.site/e/…`（JS 模块包） | 播放解不出 |
| `javmix.tv` | 200，可读；播放走打包 JS 里的 `streamtape` / `iplayerhls` 镜像 | 播放脆弱 |
| `javmost.tv` | 200（WordPress + `wp-json`）；播放是 `javtiful.com/embed/…` | 播放解不出 |
| `eporner.com` | 200，列表/搜索/详情/评论都可用；`gvideo.eporner.com/….mp4` 直连 **403**，`/xhr/video/…` 需要播放器签名（`hash` + `watchId` 仍返回 `code 3`） | 播放需要签名，放弃 |
| **`xhamster.com`** | 200；`/categories/japanese`、`/categories/uncensored`、`/categories/jav` 均有内容；视频页 `<link rel="preload">` 直出 `…av1.mp4.m3u8`，主清单 200 且**分片可取** | 采用 |

## 站点结构（2026-10-31 实测）

| 能力 | 实现方式 |
| --- | --- |
| 分区 | `/categories/japanese`、`/categories/uncensored`、`/categories/jav`，分页 `/<page>` |
| 搜索 | `/search/<关键词>`，分页 `?page=N` |
| 列表卡片 | 作品链接固定为 `/videos/<slug>-xh<id>`；缩略图/标题常位于相邻节点，插件按链接定位后取最近 `<img>`，标题优先 `alt`、缺失时用 slug 还原 |
| 详情 | `og:title` / `og:image` / `meta description` |
| 播放 | 页面里第一个 `xhcdn.com` 的 `.m3u8`（`multi=` 主清单），带 `Referer` 返回 |

## 已支持

- 3 个分区 + 关键词搜索，均分页。
- 列表：标题、封面。
- 详情：标题、封面、简介；目录一个可播放条目。
- 播放：HLS 主清单（多码率自动），`@network auto`，代理/直连都不影响。
- 读取节流：请求串行且间隔不小于 300 毫秒，页面缓存 30 秒。

## 未支持

- 评论：本轮按「评论可以不要」处理，未接入；站点的评论是接口加载，需要时再补。
- 下载、收藏、账号功能不做。

## 验证

- 新增 6 项离线测试，仓库合计 138 项通过；覆盖分区/搜索路径与分页、卡片定位与番号兜底标题、详情元数据、主清单提取（含转义斜杠）、无播放地址报错、作品地址校验。
- 线上实测（`node tools/check_xhamster.mjs`，5 次插件请求）：3 个分区各 **46** 条；第 2 页 46 条且与第 1 页不同；搜索「uncensored japanese」46 条；详情标题/封面正常；播放地址 `video7.xhcdn.com` 主清单 **200、5 个码率变体**，首个分片 **200 / 30305 字节**。
- 仓库索引生成与脚本大小、SHA-256 检查通过。

复测：

```sh
node --test tests/xhamster_test.mjs
node tools/check_xhamster.mjs
python tools/build_repository.py
```

联网测试独立于 CI，不把页面或播放地址保存到仓库；离线测试使用原创占位 HTML，只沿用站点 URL 形状与元数据字段名。站点结构与 CDN 策略可能变化，实际结果以设备测试为准。
