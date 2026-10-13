# Subweb Next

独立的纯前端订阅转换面板，采用现代工作台布局与深浅主题，组织为“引擎 → 来源 → 输出 → 参数 → 结果”。生产部署只需要静态文件，没有服务端、数据库或 Node 运行时。

## 界面与字体

界面使用纯色背景、细边框卡片、统一控件和蓝色强调。桌面为编辑区与结果区两栏，结果随滚动保持可见；窄屏改为单栏。顶部只保留品牌、后端源码和主题切换，下方直接选择引擎。800px 及以下使用后端下拉框代替大卡片，只显示当前地址和可展开的版本状态；本地后端仍按指定 IP 范围显示。当前引擎与格式数量收纳到结果摘要，工作台说明放在页脚。

全局字体依次使用 `'Twemoji Mozilla', 'Consolas', 'Menlo', 'Monaco', 'Lucida Console', 'Liberation Mono', 'DejaVu Sans Mono', 'Google Sans'`，正文、表单控件、按钮和代码预览采用同一顺序。Twemoji Mozilla 和 Google Sans 随项目提供 WOFF2 字体，优先使用设备已安装的版本，其余字体使用设备上的版本。不请求外部字体 CDN；字体按实际使用加载，Google Sans 包含 400–700 可变字重和斜体。来源、许可和维护方式见 [字体说明](public/fonts/README.md)。

当前界面不加载液态玻璃渲染器或其样式，不依赖 WebGPU。主题与控件支持系统减少动画及高对比度设置。

## 已配置的服务

| 服务                  | 地址                                          |
| --------------------- | --------------------------------------------- |
| SubConverter-Extended | https://api.miaoceo.com                       |
| subconverter          | https://sub.miaoceo.com                       |
| 本地后端              | 直接访问指定 IP 范围时沿用当前协议、IP 与端口 |
| 短链 Worker           | https://i.miaoceo.com/short                   |

两种后端使用独立能力配置，Extended 提供 22 种输出，Standard 提供 16 种输出。页面通过 `/version` 读取在线身份与版本；本地与自定义后端自动识别类型，无须手动选择。

“本地后端”只在使用 IP 直接访问，且地址匹配指定 CIDR 列表时显示，使用当前页面的协议、IP 和端口，不固定 IP 或端口。通过域名（包括 `localhost` 和 `.local` 名称）访问时隐藏，也不会作为第三个后端读取版本。例如：

- 从 `http://192.168.2.190:25500/` 打开，生成 `http://192.168.2.190:25500/sub?...`。
- 从 `http://127.0.0.1:25500/` 打开，生成 `http://127.0.0.1:25500/sub?...`。
- HTTPS、其他端口和匹配范围的 IPv6 同样保留；页面路径、查询和片段不进入 API 根地址。

匹配列表按用户提供的 19 条 CIDR 保存于 [local-backend.js](src/lib/local-backend.js)，包括私网、回环、共享、测试、保留及组播范围；IPv6 按 `::/128`、`::1/128` 和 `2001::/32` 匹配。不查询域名解析结果，不额外扩大范围。

首次加载确认当前 IP 站点提供转换后端时，自动选中本地后端；若你已选择后端或编辑转换输入，则保留你的选择。自定义后端只需填写 API 地址，点击“使用并读取版本”。读到 `SubConverter-Extended` 时显示其客户端、模板和参数；未识别时暂按普通版参数。更改地址后会清除旧的识别结果，过期的版本响应不会切换新地址的类型。纯静态站点继续选择远端或自定义 API。`localBackend: false` 可隐藏本地选项。

## 本地使用

需要 Node 22.12+（Node 24 LTS 亦可）。

```powershell
cd 'D:\App Data\Github\subweb-next'
npm ci
npm run dev
```

打开终端显示的本地地址，通常是 `http://127.0.0.1:5173`。

```powershell
npm test
npm run build
npm run preview
```

构建产物在 `dist/`。可直接放到 Nginx、Cloudflare Pages 或其他静态托管服务；应用没有前端路由，也不需要 SPA 重写。`base: './'` 支持部署到子目录。GitHub Actions 构建工作流会测试并上传 `subweb-next-dist` artifact，不执行发布。

## 配置与使用

部署前或部署后修改 `public/conf/config.js` / `dist/conf/config.js`，即可调整站点名、后端、短链地址和模板。不要将真实订阅或密钥写入配置文件。自定义后端通过版本响应自动识别类型；远程模板可用 `targets` 标记适用客户端。

生成链接在浏览器本地完成；只有读取版本、预览、诊断、下载或生成短链时发起网络请求。页面不持久化订阅、请求头或密钥，仅保存主题偏好。短链 Worker 会保存完整生成链接，当前服务有效期为 30 天。

所有布尔参数默认“跟随后端”，不会发送空值。关闭会显式发送 `false`。选择另一种引擎或客户端时移除不兼容字段和模板，并清除旧短链与预览。Surge 版本与 `target` 分开编码；默认不指定 `ver`，由后端决定。

Extended 可使用“添加 Provider”组合名称、标签、独立间隔。原始输入也接受 `provider:HK,interval:21600,tag:机场,https://example.com/sub`。输入保持每行一条，或用 `|` 分隔；源 URL 中的字面竖线应先写成 `%7C`。`node:http://host:port` 仅支持 Extended 的 Clash / ClashR。

`provider_headers` 只在 Extended 的 Clash / Stash 显示。名称用逗号分隔，值用 JSON 填写。预览、下载和诊断请求携带实际请求头；复制订阅链接和生成短链不可携带这些值，因此有请求头时禁用这两项操作。此功能还需要后端允许对应 CORS 请求头。

`agekey` 和 Standard 的 `token` 会写入生成 URL，分享时应留意内容。面板不主动发送真实订阅用于版本读取。

参数的源代码依据、默认值、被忽略的兼容参数及目标差异见 [后端核对记录](docs/backend-compatibility.md)。

## Aethersailor 模板

Extended 的 Clash / Mihomo 与 ClashR 配置列表新增 Aethersailor 分组，包含标准、轻量、GFW 极简、重度分流各自的常规及故障转移版本，共 8 个模板。使用 [Aethersailor 原始 INI 地址](https://github.com/Aethersailor/Custom_OpenClash_Rules/tree/main/cfg)，不修改模板内容。现有自定义配置与 ACL4SSR 选项保留。

输出配置中的“规则输出”可选择跟随后端、展开远程规则集为内联规则，或保留远程 Rule Provider。它与高级参数的 `expand` 是同一个值；仅输出节点时没有规则或策略组。`GEOSITE` / `GEOIP` 条目仍由客户端处理，展开规则集不会把地理数据库转换为逐条域名。

配置 `aethersailorPresets: false` 可以关闭新增模板。`npm run update:presets` 可刷新 Aethersailor 模板目录，脚本只提取该作者的条目，不引入其他作者模板。

## 验证范围

`npm test` 包含编码与参数边界、网络错误处理，以及实际 Vue 组件的 DOM 交互测试（切换引擎、字段清理、请求头、诊断和过期异步结果）。DOM 测试不等同于真实浏览器视觉验收。

可选公网只读检查：`node scripts/smoke-backends.mjs`。它使用 TEST-NET 地址的合成 SS 节点，检查两端 `/version`、Clash / sing-box 转换、Extended 诊断及 CORS 响应；不会使用真实订阅，也不会在服务器上编译代码。

2026-10-13 本地的 36 项测试与现代界面构建通过；本地地址、CIDR 边界、域名隐藏、自定义类型识别、过期版本响应、模板筛选、去重、链接编码和规则展开选择均已覆盖。保留的玻璃渲染辅助模块测试仍可运行，当前界面不加载它。此前短链 POST 返回 200，GET 返回 302，Location 与生成链接一致。公网 Extended sing-box 曾返回一次 503，随后同请求成功；在线能力由实际后端版本和配置决定。浏览器集成初始化失败，Windows 窗口控制因无法可靠识别当前浏览器网址而停止；未完成新版界面的真实浏览器截图验收。

## 项目来源

参考 [xuanranran/subweb](https://github.com/xuanranran/subweb) 的视觉和静态配置约定。保留原项目 GPL-3.0 许可证，新增代码采用相同许可证。后端代码不打包进本项目。
