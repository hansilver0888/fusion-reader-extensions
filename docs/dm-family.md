# MangaBZ 与动漫屋

两个独立插件均为 v1.0.0，使用各自的网站入口和请求参数。支持最近更新、热门、恋爱、校园、冒险频道；关键词分页搜索、作者搜索、详情、分组目录和完整章节图片。无需修改应用本体。

## 实现与边界

协议参考 Aidoku-Community/sources 的 zh.mangabz 与 zh.dm5，MIT 许可声明随独立脚本保留。共享适配代码在 tools/dm-family-runtime.js，由 tools/update_dm_family.mjs 生成两个可独立安装的脚本。

- 目录仅从完整目录容器读取，排除推荐作品；顺序为从前到后，分组保留。
- 图片脚本按字符串、数组和 base62 词典解包，不使用 eval 或执行服务器代码。
- 动漫屋使用公开阅读页提供的当前章节参数，MangaBZ 使用网站的图片入口；分批读取直至达到页面声明的完整数量。
- 拒绝不完整或重复的图片清单，避免将缺页章节报告为成功；需要登录或购买的章节显示网站提示，不解锁付费内容。
- 请求跟随应用的系统/手动代理。网页及图片保留各自所需的 UA 与 Referer。
- 网页/API 请求串行执行，相邻请求至少间隔 700ms，关闭宿主自动重试；403/429/503 或验证页面会暂停后续请求。

## 验证

node --test tests/dm_family_test.mjs
node tools/check_dm_family.mjs
node tools/update_dm_family.mjs
python tools/build_repository.py

离线测试仅使用原创占位 HTML 与本地构造的图片脚本。联网检查以《二人巴士》第 51 话为基准，要求全部 19 页及首尾图片可读取。真实页面、图片、账号、Cookie 和节点不保存进仓库。电脑联网检查不能替代鸿蒙真机验证。
