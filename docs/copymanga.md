# 拷貝漫畫 v1.2.2

## 请求策略与 Aidoku 对照（v1.2.2）

已逐项核对 [Aidoku 的请求构造](https://github.com/Aidoku-Community/sources/blob/main/sources/zh.copymanga/src/net.rs)、[目录和阅读入口](https://github.com/Aidoku-Community/sources/blob/main/sources/zh.copymanga/src/lib.rs) 以及 [宿主的验证处理](https://github.com/Aidoku/Aidoku/blob/main/Aidoku/Core/Sources/Cloudflare/CloudflareHandler.swift)。

共同部分是网站 HTML/JSON 接口、Safari UA、章节 `dnts` 头和 AES 数据格式。此前本插件额外探测多个镜像、启用宿主重试，并且只错开请求开始时间；这些差异会增加请求量。新版：

- 固定使用设置中指定的官方镜像，默认 copy5000.com；直接请求目标页，不额外探测或自动轮询镜像。
- 请求头对齐参考实现的显式设置；HTML 只设置 UA，JSON 额外设置 Accept。阅读图片也带相同 UA。
- 将完整请求串行化，上一请求结束后至少等待 1 秒；明确 `retry: false` 关闭宿主自动重试。
- 页面缓存保留 5 分钟，最多 128 页；相同页面的并发调用合并。
- 遇到纯文本 error、验证页或 HTTP 403/429/503 时暂停后续网页请求，至少 30 秒，429 尊重 Retry-After；提示状态码，不循环尝试。

1 秒间隔与本地暂停是本插件的保守策略，不代表 Aidoku 有相同限速。Aidoku 本体还具有 WebView 验证和 Cookie 共享机制；其判定要求特定状态码、Cloudflare 响应头和验证页标记，不能据此认定纯文本 error 一定是 Cloudflare 验证。鸿蒙 Dart 请求栈与 Aidoku 的宿主环境不同，仅对齐插件无法保证出口不被网站限制。当前暂停只控制插件的网页/API 请求，不控制本体独立发出的封面和图片请求。

## UA 对照测试

插件设置中“请求 UA”可填 `safari`、`chrome` 或 `mobile`，默认 `safari` 与 Aidoku 插件一致。保存设置后插件会重新加载、清除本次会话缓存。选定的 UA 对网页、JSON 和阅读图片保持固定；收到 error 后不会自动轮换身份或继续请求。测试时保持节点及镜像不变，分别验证两个配置；不能仅凭更换 UA 后一次成功断言已解决风控。

## v1.2.1 修复

2026-11-04 对比实测：原出口可以加载列表和搜索，但普通浏览器与插件的阅读页都返回空内容。使用香港出口后，匿名请求即可读取目录与图片，无需账号。不能据此认定所有日本出口均不可用；可用性以实际节点为准。

- 章节接口使用网站前端的 `dnts` 请求头，修正原来的 `dnt` 拼写。
- 保留接口提供的阅读顺序，不再把整个目录反转。
- 不再将空目录降级成一个“最新话”链接，也不把空阅读页错误归因为必须登录或更新客户端。
- 空目录、空图片列表和无效阅读数据不留在页面缓存中，切换网络后可以立即重试。
- 删除未使用的账号密码登录代码；公开阅读请求不主动发送账号凭据。
- 搜索及章节接口的站点错误会显示具体错误，不再冒充零搜索结果。

网络路线跟随应用的代理设置。插件不内置代理、节点或用户凭据，也不会替用户切换节点。站点仍可因出口地区、网络故障或访问限制返回空内容。

## 实现

列表来自 `/newest` 与 `/comics`，分类页读取 HTML 属性中的列表；搜索使用网站自己的 JSON 接口。详情从 `/comic/<作品标识>` 读取，章节目录来自 `/comicdetail/<作品标识>/chapters`，阅读页提取 `contentKey`。图片列表与目录使用页面提供的 AES-128-CBC 数据，纯 JavaScript 解密以兼容 QuickJS。

参考 [Aidoku 的公开实现](https://github.com/Aidoku-Community/sources/tree/main/sources/zh.copymanga)。

## 验证

```sh
node --test tests/copymanga_test.mjs
node tools/check_copymanga.mjs
python tools/build_repository.py
```

联网检查可通过环境变量 `COPYMANGA_TEST_PROXY` 指定本机 HTTP 代理。该变量只作用于测试工具。测试必须成功读取首尾章节图片才算通过，不会将“能搜索、不能阅读”报告为成功。真实网页、图片、账号和节点配置均不保存进仓库。
