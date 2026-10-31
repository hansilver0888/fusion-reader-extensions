# MissAV v1.0.0

2026-10-31 核对 `missav.ai` 及其镜像，完成单文件插件。只读取公开页面，不登录、不写入、不调用广告或统计接口。

## 前提：站点由 Cloudflare 挑战保护

实测结论（同一台机器、直连与走代理各测一次）：

| 请求 | 结果 |
| --- | --- |
| `/`、`/en`、`/dm38/en`、`/dm38/zh`、`/api/…`、`/search/…` | 403 `Just a moment...`（Cloudflare 托管挑战） |
| `/sitemap.xml` | 200，可读（只是 URL 清单，519 个 `sitemap_items_N.xml` 分片，没有视频元数据与播放地址） |
| 通过 Jina Reader 抓同一页面 | 同样拿到挑战页 |
| 浏览器（已通过验证） | 正常 |

也就是说：页面、接口和播放地址（`surrit.com/<uuid>/…/video.m3u8`，uuid 只存在于视频页）都拿不到，除非请求本身带着**已经通过挑战的会话**。非 JS 客户端（node、python、本体的 dart 客户端）都无法自行完成挑战。

### 插件怎么处理

1. **设置里填浏览器的 Cookie 与 UA**（`cookie`、`user_agent`）。插件把这两项加到每个请求上；`cf_clearance` 与 UA、客户端 IP 绑定，所以 UA 必须与复制 Cookie 的浏览器一致。
2. **入口自动解析**：依次尝试 `missav.ai`、`missav.ws`、`missav.live`，用首页是否返回挑战页来判断可用性；命中后连「线路前缀」一起记录（站点 URL 形如 `/dm38/zh/…`，不同域名会变成 `/dm19/ja` 这类，不能写死）。
3. 读取时若再次遇到挑战页，报错会直接说明 Cookie 已过期（`cf_clearance` 通常只有效数小时到数天）以及重新复制的方法。

获取 Cookie 的步骤：浏览器打开 missav 并通过验证 → F12 → Application → Cookies → 复制整段（至少包含 `cf_clearance`）；Network 里随便点一个请求，从 Request Headers 复制 `User-Agent`。两者一起填进插件设置。

## 已支持

- 2 个列表入口：最新（`/<line>/new`）、發售（`/<line>/release`），分页 `?page=N`。
- 关键词搜索：`/<line>/search/<关键词>`，分页 `?page=N`。
- 详情：标题、封面、简介（优先 `og:` 元数据，缺省回退 `<h1>`）。
- 播放：从视频页里取第一个 HLS 地址（优先 `video.m3u8` / `playlist.m3u8` 主清单），带 `Referer` 返回；同一页面里出现的多个分档按主清单优先排序。
- 解析容错：列表卡片按「工作页 URL 形状 + 缩略图」识别，不依赖具体类名；`genres`、`actresses`、`search` 这类站点栏目会被排除，不会当成作品。
- 读取节流：请求串行且间隔不小于 300 毫秒，页面结果缓存 30 秒。

## 尚未支持

- 分类（类型/演员/片商）：需要栏目页的实际结构，当前只在拿到真实页面后再补；列表与搜索已可用。
- 站点账号功能（收藏、评论、下载券）不做。

## 验证

- 新增 12 项离线测试，与项目其余测试合计 123 项通过；覆盖入口家族校验、挑战页识别与提示、入口自动选择、线路前缀解析、Cookie/UA 注入、列表与搜索分页、卡片解析与栏目排除、详情元数据、播放地址选取与 Referer、作品地址校验。
- 线上部分**未完成**：受 Cloudflare 挑战限制，插件在本机只能复现「挑战页 → 明确提示」的路径，无法验证真实列表/播放。`tools/check_missav.mjs` 已写好，带上浏览器 Cookie 与 UA 即可实测：

```sh
MISSAV_COOKIE='cf_clearance=…; 其他=…' MISSAV_USER_AGENT='Mozilla/5.0 …' node tools/check_missav.mjs
```

- 仓库索引生成与脚本大小、SHA-256 检查通过。

复测：

```sh
node --test tests/missav_test.mjs
MISSAV_COOKIE=… MISSAV_USER_AGENT=… node tools/check_missav.mjs
python tools/build_repository.py
```

联网测试独立于 CI，不把页面或播放地址保存到仓库；离线测试使用原创占位 HTML，只沿用站点 URL 形状与元数据字段名。站点结构、挑战策略与播放地址都可能变化，实际结果以设备测试为准。
