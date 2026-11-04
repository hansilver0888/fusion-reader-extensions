# 拷貝漫畫 v1.0.1

拷贝漫画（copymanga / mangacopy）。参考了 [Aidoku 的 zh.copymanga](https://github.com/Aidoku-Community/sources/tree/main/sources/zh.copymanga)（v24）的接口划分与镜像域名列表。

## v1.0.1：入口探测修正

v1.0.0 在真机上四个域名全部报「不是预期的页面」。原因是探测请求用了 `?offset=0&limit=1` 的**精简页**（约 12KB），在 App 的请求头套件下会返回不带任何 `/comic/` 链接的外壳页，被判为失败。

修正：

- 探测改为请求完整列表页 `/newest`（71KB，稳定含 60 条链接）
- 判定放宽：含 `/comic/` **或** `exemptComic` 都算可用
- 失败原因具体化：`被 Cloudflare 攔截` / `站點要求更新 App` / `頁面過短（n 字元）` / `不是預期的頁面（标题）`
- 请求头补全为完整浏览器套件（`Accept` 全类型 + `Upgrade-Insecure-Requests`）；aidoku 的 net.rs 也注明缺头会让站点返回别的页面

## 站点结构

| 环节 | 做法 |
| --- | --- |
| 镜像 | `www.copy5000.com`、`copy4000.com`、`copy3000.com`、`2026copy.com`、`mangacopy.com`，第一个能出列表的作为本次会话入口，失败自动换 |
| 最近更新 | `/newest?offset=&limit=60`，按 offset 翻页 |
| 分类 | `/comics?ordering=-popular&offset=&limit=50&region=&status=`，列表是**页面内联数组**（见下） |
| 搜索 | `/api/kb/web/searchcl/comics?offset&platform=2&limit=12&q=&q_type=`，返回 JSON |
| 详情 | `/comic/<path_word>`：`<h6 title>` 标题、封面、`p.intro` 简介、`span.comicParticulars-tag` 标签、`<span id="dnt" value>` |
| 章节 | `/comicdetail/<path_word>/chapters`，带 `dnt` 头，返回 `results` **加密字符串** |
| 阅读 | `/comic/<path_word>/chapter/<uuid>`，页面里 `var contentKey = '…'` **加密字符串** |

## 分类页的列表在属性里

`/comics` 返回的 HTML 里**没有卡片**，它把数组放在 `div.exemptComic-box` 的 `list` 属性中，再由页面用 `eval()` 渲染：

```html
<div class="row exemptComic-box" total="46620" list="[{&#x27;path_word&#x27;: &#x27;modujingbingdenuli&#x27;, …}]">
```

它是 **JS 对象字面量**（单引号键）且被 HTML 转义。插件按「定位标签 → 还原实体 → 规范引号 → `JSON.parse`」读取，实测一次拿 50 条、`total=46620`。

## 加密是 AES-128-CBC

两处响应都是「前 16 个字符是 IV + 其余为 hex 密文」，AES-128-CBC + PKCS7：

| 来源 | 密文位置 | 密钥 |
| --- | --- | --- |
| 章节列表 | 接口 JSON 的 `results` | 详情页 `var ccz = '…'` |
| 阅读页 | 页面 `var contentKey = '…'` | 页面 `var cct = '…'` |

实测密钥为 `0p0zzpvv.nmn.oop`（16 字节，各镜像一致），插件里留作兜底。

**QuickJS 没有 crypto 模块**，所以 AES-128 解密由插件用纯 JS 实现（S-box 按 FIPS-197 §5.1.1 在加载时推导，不是贴 512 个常量）。正确性用两种方式验证：

- FIPS-197 附录向量：key `000102…0f` + 密文 `69c4e0d8…c55a` → `001122…eeff`
- 与 node 的 `aes-128-cbc` 对拍 12 组随机密钥/明文（含中文、空串、1000 字符）

## 站点的反爬限制（重要）

站点的 JSON API 对被判定为「破解客户端」的请求返回：

```json
{"code":210,"message":"請到官網更新最新APP…請下載安裝正版之後等待1小時，限制會自動解除。"}
```

网页端则是**软限制**：返回 HTTP 200 和合法的加密结构，但章节列表 `chapters: []`、阅读页 `contentKey` 为空。

v1.0.1 实测的现状（2026-11-04，同一 IP）：

| 能力 | 状态 |
| --- | --- |
| 列表 / 分类 / 搜索 / 详情 | 正常 |
| 章节列表 | 间歇：偶发放行（一次实测 402 章），多数返回空 → 降级到详情页的 1 条最新章节 |
| 阅读页 `contentKey` | 空 |
| `api.copy4000.com` 等 H5 域的 `/api/v3/...` | 一律 `code 210` |

即：**目录与搜索可用，章节与阅读当前被站点限制**。这不是解析问题 —— 加密链路在放行时实测可解（402 章、21 张图都解开过），限制解除后无需改代码。

插件对此的处理是**如实报错而不是静默失败**：

- 章节列表为空 → 先回退到详情页列出的章节链接；仍为空则提示「可能站点对匿名请求做了限制，请稍后再试」
- 阅读页 `contentKey` 为空 → 提示同样的原因

## 验证

离线 21 项测试（`tests/copymanga_test.mjs`）覆盖：AES 向量与 UTF-8 往返、错密钥/短载荷、镜像选择与切换、8 个频道与 offset 分页、两种卡片结构、内联数组解析、搜索分页、详情字段、章节降级、`dnt` 请求头、阅读页解密、地址校验、页面缓存。

联网实测（`node tools/check_copymanga.mjs`）：

```
频道 8 个；最近更新 60 条；热门 50 条；搜索「海賊王」12 条
详情：海贼王，封面/简介正常，章节降级为 1 条（站点限制）
阅读：contentKey 为空（站点对匿名请求的限制尚未解除）
```

即：**列表、分类、搜索、详情可用；章节与阅读受站点风控约束**，解除后无需改代码即可工作（解析逻辑已用离线样本验证）。

## 复测

```sh
node --test tests/copymanga_test.mjs
node tools/check_copymanga.mjs
python tools/build_repository.py
```

联网测试独立于 CI；离线测试用原创占位 HTML 与本地生成的加密载荷，仓库不保存真实页面、cookie 或图片地址。
