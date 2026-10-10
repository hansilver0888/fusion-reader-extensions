# FusionReader 插件仓库

聚阅的独立来源插件。应用本体：[hanyin111/fusion-reader](https://github.com/hanyin111/fusion-reader)。插件使用跨平台 JavaScript，分发方式参考 Mihon 的独立扩展仓库和 Aidoku 的来源列表；格式为 FusionReader / Miru 脚本，不直接兼容其 APK 或 WASM 插件。

- 插件网页：<https://hanyin111.github.io/fusion-reader-extensions/>
- 仓库索引：<https://hanyin111.github.io/fusion-reader-extensions/index.json>

## 安装与更新

在聚阅 1.4.0 或更新版本打开「扩展 → 插件仓库」，选择插件安装。1.4.1 起需要先手动填写仓库索引地址。已安装插件会显示更新按钮，也可使用「更新已安装插件」。插件脚本下载并保存到本机，之后启动和离线阅读无需重新下载。升级旧版应用后，可使用「恢复旧版插件」安装原来的来源；原有书架、历史和插件设置保留。

网页可按类型和名称查找，复制仓库地址或单个脚本安装链接。应用也保留 URL 和粘贴脚本安装。

## Omofun 动漫

支持日漫、国漫、动态漫画、剧场、特摄、美漫分类，搜索与分页，以及按播放线路分组的完整分集目录。搜索和分类访问时会按网站的“继续访问”流程建立会话；不要求网站账号。

播放支持页面公开配置中的 HLS / MP4 地址，并保留请求头。HLS 当前支持在线播放，暂不支持视频缓存。部分第三方线路可能失效，失败时会提示返回目录切换其他线路。当前“精品”等使用中转标识的播放器不支持解析；可选择其他线路。插件更新无需重新安装应用。

## 发布插件

1. 修改 `sources/<package>.js`，保持 `@package` 不变，更新 `@version`。
2. 提交到 `main`。GitHub Actions 自动运行插件测试、生成索引并发布 GitHub Pages。
3. 用户在应用内刷新仓库并更新插件，无需重编译应用。

索引包含版本、类型、最低应用版本、脚本大小和 SHA-256；脚本发布为内容哈希命名的文件，避免索引和脚本缓存错位。客户端在加载前核对哈希和头部元数据。需要新的原生能力或改变运行时接口时，仍需要更新应用本体。

```sh
node --test tests/*.mjs
python -m unittest discover -s tools -p 'test_*.py'
python tools/build_repository.py
```

`public/` 是网页模板，`dist/` 是自动生成的发布目录，不提交生成产物。`fixtures/runtime.js` 是测试使用的应用桥接接口快照，不包含在插件分发中。

## 许可

插件沿用脚本头部声明的许可。第三方协议参考许可保留在 `licenses/`。仓库不存储作品内容，不与内容提供方存在隶属关系。
