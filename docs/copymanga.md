# 拷貝漫畫 v1.2.0

拷贝漫画（copymanga / mangacopy）。参考了 [Aidoku 的 zh.copymanga](https://github.com/Aidoku-Community/sources/tree/main/sources/zh.copymanga)（v24）的接口划分与镜像域名列表。

## 结论先说（2026-11-04 实测）

| 能力 | 状态 |
| --- | --- |
| 列表 / 分类 / 搜索 / 详情 | **正常** |
| 章节列表 | **偶发可用**：同一 IP 第一次请求能拿到全部（实测 402 章），紧接着就退回空列表 |
| 阅读页图片 | **拿不到**：`contentKey` 恒为空，页面里有「登錄」按钮 |

站点对客户端做了分级：

- **不登录** → 章节列表第一次放行，随后降级为空
- **带账号 token** → 章节列表**直接变空**（三种注入方式都试过：`Cookie: token=`、`Authorization: Token`、两者同时）
- **登录接口本身** → 现在返回 `code 210`「您或您身邊的人曾經下載過破解版本的拷貝漫畫，請下載安裝正版之後等待1小時」

所以 v1.1.0 里那套「登录后解锁」的假设是**错的**：注入 token 反而让原本能用的章节列表变成空的。v1.2.0 已把 token 注入整个关掉，`authHeaders()` 固定返回 `{}`，页面请求保持匿名。

## 关键实测数据

同一 IP、同一时刻，`/comicdetail/haizeiwang/chapters`：

| 请求方式 | 响应长度 | 解密后章节数 |
| --- | --- | --- |
| 匿名 | 67610 | **402** |
| `Cookie: token=<真实 token>` | 570 | **0** |
| `Authorization: Token <真实 token>` | 570 | **0** |
| 两者同时 | 570 | **0** |

token 是用提供的账号真实登录拿到的（`code:200`、用户名 `hanyin111`、40 字符 token），不是假数据。

## 为什么阅读页读不到

章节页 HTML 结构是完整的（`comicContent-list`、`comicCount`、`imageData` 容器都在），但 `var contentKey = ''` 为空。图片列表要由这个加密串解出，串为空就拿不到图。页面底部还有「登錄」入口，说明内容确实对未登录客户端隐藏。

**插件侧无法绕开**：加密链路已经验证是正确的（放行时解开过 402 章、21 张图），缺的是站点不给数据。

## 保留的能力

- 8 个频道（最近更新 / 热门 / 最新上架 / 日漫 / 韓漫 / 歐美 / 連載中 / 已完結）
- 关键词搜索（JSON 接口，分页正常）
- 详情：标题、封面、简介、标签
- 章节列表（放行时完整，返回空时降级到详情页的最新话链接）

## 站点结构

| 环节 | 做法 |
| --- | --- |
| 镜像 | `www.copy5000.com`、`copy4000.com`、`copy3000.com`、`2026copy.com`、`mangacopy.com`，第一个能出列表的作为本次会话入口，失败自动换 |
| 最近更新 | `/newest?offset=&limit=60` |
| 分类 | `/comics?ordering=-popular&offset=&limit=50&region=&status=` |
| 搜索 | `/api/kb/web/searchcl/comics?offset&platform=2&limit=12&q=&q_type=` |
| 详情 | `/comic/<path_word>`：`<h6 title>`、封面、`p.intro`、`span.comicParticulars-tag`、`<span id="dnt" value>` |
| 章节 | `/comicdetail/<path_word>/chapters`，带 `dnt` 头，`results` 是加密串 |
| 阅读 | `/comic/<path_word>/chapter/<uuid>`，页面里 `var contentKey = '…'` 是加密串 |

## 分类页的列表在属性里

`/comics` 的 HTML 里没有卡片，数组放在 `div.exemptComic-box` 的 `list` 属性中，由页面 `eval()` 渲染：

```html
<div class="row exemptComic-box" total="46620" list="[{&#x27;path_word&#x27;: &#x27;…&#x27;}]">
```

它是 JS 对象字面量（单引号键）且被 HTML 转义。插件按「定位标签 → 还原实体 → 规范引号 → `JSON.parse`」读取，实测一次 50 条、`total=46620`。

## 加密是 AES-128-CBC

两处都是「前 16 个字符是 IV + 其余为 hex 密文」，AES-128-CBC + PKCS7：

| 来源 | 密文位置 | 密钥 |
| --- | --- | --- |
| 章节列表 | 接口 JSON 的 `results` | 详情页 `var ccz = '…'` |
| 阅读页 | 页面 `var contentKey = '…'` | 页面 `var cct = '…'` |

实测密钥 `0p0zzpvv.nmn.oop`（16 字节，各镜像一致），插件里留作兜底。

QuickJS 没有 crypto 模块，所以解密用纯 JS 实现（S-box 按 FIPS-197 §5.1.1 在加载时推导）。正确性用两种方式验证：

- FIPS-197 附录向量：key `000102…0f` + 密文 `69c4e0d8…c55a` → `001122…eeff`
- 与 node 的 `aes-128-cbc` 对拍 12 组随机密钥/明文（含中文、空串、1000 字符）

## 入口探测

探测请求完整列表页 `/newest`（71KB，稳定 60 条链接）。判定看**内容标记**而不是长度：含 `/comic/` 或 `exemptComic` 即算可用。失败时给出具体原因与收到的内容片段：

- `被 Cloudflare 攔截`
- `站點要求更新 App`
- `不是預期的頁面（标题），n 字元：…`

所有请求带显式 `timeoutMs: 25000`（运行时默认超时对 70KB 页面偏短，截断会表现成空响应）。

## 验证

离线 24 项测试（`tests/copymanga_test.mjs`）覆盖：AES 向量与 UTF-8 往返、错密钥/短载荷、镜像选择与切换、8 个频道与 offset 分页、两种卡片结构、内联数组解析、搜索分页、详情字段、章节降级与 `dnt` 头、阅读页解密、地址校验、**匿名请求不携带 token**、页面缓存。

联网实测（`node tools/check_copymanga.mjs`）：频道 8 个、最近更新 60 条、热门 50 条、搜索 12 条、详情字段齐全。

## 复测

```sh
node --test tests/copymanga_test.mjs
node tools/check_copymanga.mjs
python tools/build_repository.py
```

联网测试独立于 CI；离线测试用原创占位 HTML 与本地生成的加密载荷，仓库不保存真实页面、cookie、账号或图片地址。
