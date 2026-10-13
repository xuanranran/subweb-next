# Subweb Next

独立的纯前端订阅转换面板，参考原 subweb 的玻璃卡片、蓝紫配色与深浅主题，重新组织为“引擎 → 来源 → 输出 → 参数 → 结果”。生产部署只需要静态文件，没有服务端、数据库或 Node 运行时。

## 已配置的服务

| 服务                  | 地址                        |
| --------------------- | --------------------------- |
| SubConverter-Extended | https://api.miaoceo.com     |
| subconverter          | https://sub.miaoceo.com     |
| 短链 Worker           | https://i.miaoceo.com/short |

两种后端使用独立能力配置，Extended 提供 22 种输出，Standard 提供 16 种输出。页面通过 `/version` 读取在线身份与版本，不会根据域名或版本号自动更换引擎类型。

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

部署前或部署后修改 `public/conf/config.js` / `dist/conf/config.js`，即可调整站点名、两个后端、短链地址和模板。不要将真实订阅或密钥写入配置文件。自定义后端必须明确选择 Extended / Standard 类型；远程模板可用 `targets` 标记适用客户端。

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

2026-10-13 的 22 项测试与新前端构建通过；新增模板的筛选、去重、链接编码和规则展开选择均已覆盖。此前两套前端构建、静态页面及运行时配置 HTTP 检查通过。短链 POST 返回 200，GET 返回 302，Location 与生成链接完全一致。公网 Extended sing-box 曾返回一次 503，随后同请求成功；在线能力由实际后端版本和配置决定。Windows 浏览器集成连接失败，未完成真实浏览器截图验收。

## 项目来源

参考 [xuanranran/subweb](https://github.com/xuanranran/subweb) 的视觉和静态配置约定。保留原项目 GPL-3.0 许可证，新增代码采用相同许可证。后端代码不打包进本项目。
