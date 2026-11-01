# Hanime1 動畫（中轉） v1.0.0

2026-11-01 实测，`hanime1` 的**并行版本**：页面走公共读服务中转，视频直链保持直连，因此不配置代理也能在 Windows / iOS / Android 上使用。原 `hanime1` 插件保持不变。

## 为什么需要它

`hanime1.me` 对非浏览器客户端返回的是 Cloudflare **硬拦截**（`403 Attention Required!`），不是可计算的 5 秒盾——页面里没有挑战脚本，纯 JS 无法解。原插件的做法是走代理（`@network proxy`，由进程环境变量提供），因此在没有配置代理的 Android 上不可用。

## 与 heisenyu/hanime-server 的区别

那个项目**没有破解** Cloudflare，它的 `docker-compose.yml` 依赖一个独立容器：

```yaml
cf-bypass:
  image: ghcr.io/sarperavci/cloudflarebypassforscraping:latest
```

而 `backend/app/utils/cloudflare_bypass.py` 只是把请求转发给这个服务（带 `x-hostname` 头）。该镜像内部是 **FlareSolverr**（真实浏览器 + undetected-chromedriver），即**用一台自己部署的浏览器去访问**。它要求用户准备 Docker / NAS，每台设备都要指向那台服务器。

本插件改为使用公共读服务 `r.jina.ai`（免费额度，无需自建），代价是依赖第三方、有速率限制。

## 实现

| 环节 | 做法 |
| --- | --- |
| 页面 | `https://r.jina.ai/<目标地址>`，必须带 `x-return-format: html`；不加这个头会返回 Markdown，播放器标签被剥掉 |
| 列表卡片 | 两种结构：首页/搜索是 `div.video-item-container[title] > a.video-link[href] > img.main-thumb`；分类页是 `a[href] > div.home-rows-videos-div > img + div.home-rows-videos-title` |
| 详情 | `og:title` / `og:image`（封面在 `vdownload.hembed.com/image/thumbnail/…`），标题去掉站点后缀 |
| 播放 | 视频页 `<video id="player">` 内的 `<source src=… size=720|480|1080>`，取最高档；**直连** `vdownload.hembed.com`（实测 206 + `ftyp`） |

`@network direct`：视频域名本身不在 Cloudflare 后面，不需要代理；页面请求只发往 `r.jina.ai`。

页面缓存 120 秒、请求间隔 400ms，因为每次中转都消耗公共服务的额度。

## 已支持

- 5 个频道：首頁、裏番、泡麵番、Motion Anime、3DCG（支持分页）
- 关键词搜索（支持分页）
- 详情：标题、封面、简介
- 播放：从视频页取最高清晰度直链

## 未支持

- 评论：原插件有，本版未做（中转页的评论需要额外一次请求，按需再加）
- 番剧列表的"最新上市"之外的其他排序不做

## 验证

- 新增 9 项离线测试，仓库合计 157 项通过；覆盖中转请求头、频道与分页、搜索编码、双卡片结构解析、标题清理、最高画质选择、无源报错、地址校验、非网页响应。
- 线上实测（`node tools/check_hanime1jina.mjs`，4 次插件请求）：

```
频道 5 个；首页 126 条；裏番频道 41 条；搜索「鬼」59 条
详情：[セネト] 【無料アニメあり】メス力”キ風呂　(ボイスありのフルアニメ)
播放：vdownload.hembed.com/408893-1080p.mp4 → 206，ftyp 校验通过
```

- 仓库索引生成与脚本大小、SHA-256 检查通过。

复测：

```sh
node --test tests/hanime1jina_test.mjs
node tools/check_hanime1jina.mjs
python tools/build_repository.py
```

联网测试独立于 CI，不把页面或播放地址保存到仓库；离线测试使用原创占位 HTML，只沿用站点 URL 形状与类名。`r.jina.ai` 是第三方公共服务，免费额度和可用性不受本仓库控制，实际结果以设备测试为准。
