# Subweb Next

独立的纯前端订阅转换面板，采用液态玻璃卡片与深浅主题，重新组织为“引擎 → 来源 → 输出 → 参数 → 结果”。生产部署只需要静态文件，没有服务端、数据库或 Node 运行时。

## 液态玻璃界面

接入 [Glass-HQ/liquid-glass](https://github.com/Glass-HQ/liquid-glass) 的 `@glass-sdk/liquid-glass/dom` 接口，使用 WebGPU 材质映射与 SVG 滤镜折射背景。Vue 原生表单和转换逻辑保持独立，不引入 React 组件。背景使用本地 CSS 绘制，不下载图片，也不截取页面。

引擎卡片及来源、输出、高级参数、结果和预览各自拥有有限大小的场景。材质准备完成前显示 CSS 玻璃；场景滚出视口时释放渲染资源，切换主题时重建对应材质。表单内容不参与弹性缩放，文字保持清晰。

真实折射要求 HTTPS 或 localhost、浏览器支持 WebGPU 且显卡适配器可用。`http://192.168.2.190:25500/` 这类普通局域网 HTTP 地址，以及不支持 WebGPU 或初始化失败的设备，自动使用模糊、高光和半透明边缘的 CSS 玻璃效果，转换功能照常可用。系统“减少透明度”或强制高对比度模式会关闭玻璃渲染。上游提醒 Safari 的 SVG 滤镜性能和折射表现存在差异，需在目标设备上确认。

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

2026-10-13 的 35 项测试与新前端构建通过；本地地址、CIDR 边界、域名隐藏、自定义类型识别、过期版本响应、模板筛选、去重、链接编码和规则展开选择均已覆盖。新增玻璃渲染测试覆盖安全上下文、无 WebGPU、减少透明度、主题切换、加载中卸载、失败回退及视口外释放。此前两套前端构建、静态页面及运行时配置 HTTP 检查通过。短链 POST 返回 200，GET 返回 302，Location 与生成链接完全一致。公网 Extended sing-box 曾返回一次 503，随后同请求成功；在线能力由实际后端版本和配置决定。浏览器集成初始化失败，Windows 窗口控制因无法可靠识别当前浏览器网址而停止；未完成真实折射及深浅主题的浏览器截图验收。

## 项目来源

参考 [xuanranran/subweb](https://github.com/xuanranran/subweb) 的视觉和静态配置约定。保留原项目 GPL-3.0 许可证，新增代码采用相同许可证。后端代码不打包进本项目。
