# Javtiful v1.0.2

2026-10-31 实测 `javtiful.com`，验收基准仍是番号 **`SNOS-378`**：能搜到、能打开、能播完整片（不是 3 秒）。

## 封面修正（v1.0.1 → v1.0.2）

| 问题 | 原因 | 修法 |
| --- | --- | --- |
| 搜索/列表封面显示不出来 | 站点用懒加载：`<img src="/assets/front/media/video-thumb-placeholder.svg" data-front-lazy-src="真实图">`，插件原来取 `src`，拿到的是占位 SVG | 依次取 `data-front-lazy-src` / `data-src` / `data-lazy-src` / `data-original` / `srcset` 首个，并过滤 `video-thumb-placeholder` |
| v1.0.1 详情封面变成通用头像 | v1.0.1 为了填满 120×170 竖框，误用了作品页里 `/uploads/uploads/collections/actresses/…` 那张图；它其实是站点的**默认头像占位图**（280×280 剪影），不是人物照 | 已回退：详情与书架一律使用**真实剧照**（`videoPoster`，512×288）；头像逻辑与「封面樣式」设置全部删除 |

关于「详情封面没居中」：本体详情页的封面框固定是 **120×170 竖框 + `BoxFit.cover`**（`detail_page.dart`），而 javtiful 只提供 **512×288 横图**，既没有竖版也没有可用裁切参数（`?w=480&h=680` 等返回同一张 44892 字节原图），所以横图只能取中间一条。这是站点资源与本体现有版式的组合限制，插件无法把横图变成竖图。

## 搜索分页（实测）

站点每页 **23 条**，用 `&page=N` 翻页，插件照同样方式取：

```
q=SNOS       第 1–4 页各 23 条，页间不重复（共 92 条）
q=uncensored 第 1–2 页各 23 条、第 3 页 10 条、第 4 页空（共 56 条）
```

插件返回的条数与站点一致。如果界面只显示第一页的 23 条，那是列表滚动触底加载没有触发（本体侧行为），可以换更具体的关键词或直接用番号搜索。

## 为什么换掉 123AV

上一版 123AV 的播放只有 3 秒，原因用 ffprobe 复现并确认：

```
[hls] URL .../qc/MWEzLXYw.css is not in allowed_segment_extensions,
      consider updating hls.c and submitting a patch to ffmpeg-devel
Invalid data found when processing input
```

它的 CDN 把 HLS 分片名做了 base64 伪扩展名（`.css` / `.svg` / `.webp` / `.xml` / `.json`），而本体的播放器（mpv / libavformat）的 HLS 解复用器只接受媒体扩展名，所以播完第 1 段（3 秒）就停。清单本身是完整的（3043 段、总时长 9127.6 秒、`ENDLIST`），分片也不需要特殊头以外的处理（带 `Referer: https://sadie-shop.site/` 连续取 12 段全 200），问题纯粹在扩展名白名单。改扩展名（`.ts`）就能播，但本体在播放前会把清单改写后落地成本地文件，插件无法替它改分片名 —— 所以换一个**直接给签名 mp4** 的站点。

123AV 源码已移到 `archive/av123/`，不再出现在索引里。

## javtiful 结构（2026-10-31 实测）

| 能力 | 实现方式 |
| --- | --- |
| 搜索 | `/search?q=SNOS-378` → `/ja/video/114372/snos-378`，分页 `&page=N` |
| 分区 | `/ja/videos`、`?sort=popular_week`、`?sort=most_viewed`、`/ja/uncensored`、`/ja/reducing-mosaic`，分页 `?page=N` |
| 作品页 | `/ja/video/<id>/<slug>`；页面内联 `"videoTitle"`、`"videoPoster"`、`"playback":{"endpoint":"/ja/video/<id>/playback","ticket":"…"}` |
| 播放 | `POST <endpoint>`（form：`ticket=…`，`X-Requested-With`）→ `{"sources":[{"src":"/media/video/<id>/720p?expires=…&signature=…","type":"video/mp4","size":720}]}`，按 `size` 取最高档 |

签名 mp4 是这次的关键：mpv 直接当普通视频播放，不经过 HLS 解复用器，也就没有分片扩展名的问题。

## 已支持

- 5 个分区 + 番号/关键词搜索，均分页。
- 列表：标题（去掉 `Thumbnail for ` 前缀）、封面。
- 详情：标题、封面、简介。
- 播放：作品页取 ticket → POST 换取签名 mp4（取最高档），带 `Referer`。
- 读取节流：请求串行且间隔不小于 300 毫秒，页面缓存 30 秒。

## 未支持

- 评论、下载、收藏、账号功能不做。

## 验证

- 新增 8 项离线测试，仓库合计 119 项通过；覆盖分区/搜索路径与分页、卡片去重与前缀清理、详情字段、ticket POST 与最高档选择、无授权/坏 JSON/空源报错、作品地址校验。
- 线上实测（`node tools/check_javtiful.mjs`，6 次插件请求）：

```
分区 5 个；最新 23 条、第 2 页 23 条且不同；無碼 23 条
搜索 SNOS-378 → 2 条，命中「SNOS-378 中年男性が純白のIカップの胸に興奮し…」
详情         → 标题含 SNOS-378，封面 javtiful.com/uploads/…/233d4c67…jpg
播放         → POST playback 200，签名 mp4；Range 取头 206、content-type video/mp4、ftyp 校验通过
```

- 仓库索引生成与脚本大小、SHA-256 检查通过。

复测：

```sh
node --test tests/javtiful_test.mjs
node tools/check_javtiful.mjs
python tools/build_repository.py
```

联网测试独立于 CI，不把页面、ticket 或签名地址保存到仓库；离线测试使用原创占位 HTML，只沿用站点 URL 形状与字段名。签名有效期与站点结构都可能变化，实际结果以设备测试为准。
