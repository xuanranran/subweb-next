# 后端参数与兼容性核对

核对日期：2026-10-13。以 `/sub` 请求入口、目标注册表、有效策略处理和输出生成代码为依据。可解析的节点协议不等于可选的输出 `target`；保留兼容参数名也不等于实际生效。

## 源码与在线版本

| 后端 | 核对源码 | 在线版本 |
| --- | --- | --- |
| Standard | xuanranran/subconverter `58b9298bf8d8283d2d618690b9a4f360fe9dcaae` | `subconverter v0.9.0-26.1013.1444-de06431` |
| Extended | Aethersailor/SubConverter-Extended `5931771b0402118ee1a806e263747df945780ca0` | `SubConverter-Extended v1.9.14`，构建 `545afd8` |

Extended 在线构建与核对源码之间的 GitHub compare 没有修改 `src/handler/interfaces.cpp`，所核对请求入口和目标注册表一致。页面仍独立读取在线 `/version`，不将源码快照 SHA 当成已部署版本。

依据：

- [Standard 请求入口](https://github.com/xuanranran/subconverter/blob/58b9298bf8d8283d2d618690b9a4f360fe9dcaae/src/handler/interfaces.cpp#L319)
- [Standard 输出生成](https://github.com/xuanranran/subconverter/blob/58b9298bf8d8283d2d618690b9a4f360fe9dcaae/src/generator/config/subexport.cpp)
- [Standard tag 处理](https://github.com/xuanranran/subconverter/blob/58b9298bf8d8283d2d618690b9a4f360fe9dcaae/src/generator/config/nodemanip.cpp#L110)
- [Extended 目标注册表](https://github.com/Aethersailor/SubConverter-Extended/blob/5931771b0402118ee1a806e263747df945780ca0/src/handler/interfaces.cpp#L110)
- [Extended 参数解析与策略](https://github.com/Aethersailor/SubConverter-Extended/blob/5931771b0402118ee1a806e263747df945780ca0/src/handler/interfaces.cpp#L3746)
- [Extended 诊断和兼容参数解释](https://github.com/Aethersailor/SubConverter-Extended/blob/5931771b0402118ee1a806e263747df945780ca0/src/handler/interfaces.cpp#L6990)
- [Extended API 说明](https://github.com/Aethersailor/SubConverter-Extended/wiki/API-Reference)、[远程订阅说明](https://github.com/Aethersailor/SubConverter-Extended/wiki/Remote-Subscriptions)

## 输出目标

共有 16 项：`clash`、`clashr`、`singbox`、`surge`、`quan`、`quanx`、`loon`、`surfboard`、`mellow`、`ss`、`ssd`、`ssr`、`sssub`、`v2ray`、`trojan`、`mixed`。

Extended 额外 6 项：`stash`、`v2rayn`、`v2rayng`、`shadowrocket`、`vless`、`hysteria2`。

Standard 的 WireGuard 输出分支存在，但入口白名单没有接受 `wireguard`，因此面板不提供此目标。`auto` 依赖客户端 User-Agent；面板明确选择客户端，避免浏览器 UA 导致错误自动识别。

Extended 的远程订阅模式：Clash / ClashR 的 proxy-provider、Stash 的 provider、Quantumult X 的 server_remote、Surge / Surfboard 的 policy-path、Loon 的 remote proxy。其他目标由后端下载转换。实际使用原生远程模式还取决于服务端配置及请求参数，不能仅从所选 target 判断。

## 请求参数

表中“共用”表示两端读取该参数；具体是否影响结果还依赖目标、服务端配置和生成路径。界面按目标隐藏明显不适用的选项。

| 参数 | 适用后端 | 类型 / 面板处理 |
| --- | --- | --- |
| `target`, `url` | 共用 | 目标；多个来源用 `|` 连接，统一 URL 编码一次 |
| `ver` | 共用 | Surge 版本；独立于 target；界面允许 2～5 |
| `config` | 共用 | 外部配置；面板支持 HTTP(S) URL，不暴露服务器本地文件路径 |
| `filename`, `group`, `dev_id` | 共用 | 文本；设备 ID 仅显示在 Quantumult X |
| `include`, `exclude`, `rename` | 共用 | 后端正则与重命名语法；rename 的多条分隔符是反引号，单条内部用 `@` |
| `interval`, `strict` | 共用 | 托管配置更新间隔（秒）和严格更新；与源前缀 interval 不同 |
| `profile_data` | 共用 | 原始托管 URL → UTF-8 标准 Base64 |
| `list`, `append_info` | 共用 | 仅节点输出、订阅信息响应头 |
| `emoji`, `add_emoji`, `remove_emoji` | 共用 | 国旗兼容及细分开关；emoji 的显式值会覆盖部分细分行为 |
| `sort`, `sort_script`, `append_type`, `fdn` | 共用 | 节点排序、服务端排序脚本、类型后缀、过滤弃用节点 |
| `insert`, `prepend` | 共用 | 使用服务端配置的插入节点及顺序 |
| `udp`, `tfo`, `scv`, `tls13` | 共用 | 节点连接属性覆盖；是否输出取决于协议和客户端 |
| `expand`, `script`, `classic` | 共用但语义不同 | 规则 / 脚本 / classical 模式，见下表 |
| `new_name` | Standard 可控制 | Extended 读取后仍强制新字段，故 Extended 界面不提供此开关 |
| `ua` | Standard | 服务端下载源订阅时使用的 UA |
| `agekey` | Standard | Age 解密密钥；进入链接，不做持久化 |
| `groups`, `ruleset` | Standard | 原始后端定义 → UTF-8 URL-safe Base64；多项用 `@`；config 可能覆盖 |
| `filter_script` | Standard | 受服务端脚本设置及授权约束 |
| `token` | Standard | API 模式鉴权；Extended 明确忽略此兼容参数 |
| `provider_proxy_direct` | Extended | Clash / ClashR 远程 Provider 的 `proxy: DIRECT`；不改变服务端下载代理 |
| `provider_headers` | Extended | 仅 Clash / Stash；名称列表，实际值必须在请求头中同时存在 |
| `explain` | Extended | 单独的“转换诊断”操作，返回 JSON；正常转换链接不包含它 |
| `upload`, `upload_path` | 共用 | 服务端上传功能，依赖上传凭据 / 配置；本面板不提供，保持纯转换流程 |
| `xudp` | 两端均不作为 `/sub` 全局参数读取 | 只在部分节点解析中存在；已移除旧前端的虚假全局开关 |

Extended 虽在诊断兼容参数集合中列出 `groups`、`ruleset`、`filter_script`、`token`，生成路径明确忽略这些值。没有 `/sub` 的 `ua` 和 `agekey` 读取点。不能照搬 Standard 选项。`ruleprepend` 和 `ruleappend` 属于外部配置，并非可直接添加的 `/sub` 查询开关。

## 默认行为差异

| 行为 | Standard | Extended |
| --- | --- | --- |
| Surge 未传 ver | 5 | 3 |
| Clash 未传 expand / script | 通常展开规则 | 默认不展开，使用远程规则集 |
| Clash 新字段 | 按配置 / 请求，部分路径强制新字段 | 始终强制新字段 |
| Clash classic | 单一 classical 与拆分 domain/ipcidr 处理 | Clash classical Provider 开关 |
| Surge classic | false 允许 DOMAIN-SET 拆分；true 使用传统规则集 | 不用于 Surge，界面隐藏 |
| 远程源 + list=true | 后端转换节点列表 | 展开远程源，放弃原生远程订阅 |
| 远程源 + 显式筛选 / 改名 / 节点属性覆盖 | 服务端应用 | 可能切换为服务端解析路径，诊断可确认 |

布尔参数全部是三态：省略、true、false。旧前端打开高级设置就发送一组 false，会覆盖配置和以上默认行为；两套前端现在均只发送用户显式选择的值。

## 来源前缀

| 前缀 | 支持范围 / 约束 |
| --- | --- |
| `tag:标签,` | 两边均支持普通形式，Extended 还支持组合与尖括号兼容形式 |
| `provider:名字,` | Extended 原生远程目标：Clash、ClashR、Stash、Quantumult X、Surge、Surfboard、Loon；界面要求 HTTP(S) 源 |
| `interval:秒,` | Extended 远程 Clash、ClashR、Quantumult X、Surge、Stash；0～2147483647；Surge / Stash 大于 0；仅节点模式不适用 |
| `proxy_direct:true,` | Extended 远程 Clash / ClashR，不能与 list=true 配合；亦接受 false / 1 / 0 |
| `node:http://host:port` | Extended Clash / ClashR 的明确 HTTP(S) 节点；显式端口；无认证、额外路径和查询；不可组合 provider / interval / proxy_direct |

面板原始输入使用未编码前缀并统一进行查询编码，也接受 Extended 的编码前缀与尖括号形式。组合示例：`provider:HK,interval:21600,tag:机场A,https://example.com/sub`。

## 请求头、响应与验证

`provider_headers` 最多 16 个名称、1024 字节；值不超过 8192 字节，不允许换行、NUL 或 DEL。Host、Cookie、User-Agent、条件缓存 / Range、代理与转发身份头及 CF-/Sec- 等保留前缀不能使用。前端另外排除浏览器禁止手工设定的 Accept-Encoding。

名称进入查询，值以请求头发送。只有下载、预览、诊断才能携带值；裸订阅链接和短链不能携带，因此面板禁用这两个动作。跨域使用还需服务端支持相应 OPTIONS/CORS。

版本页允许是 HTML，但只提取为文本显示；预览 / 下载拒绝验证页 HTML。HTTP 错误、短链业务 Code=0、非 JSON 短链响应、超时会明确展示，不伪装成成功。

公网合成 SS 节点验证覆盖两端 `/version`、Clash、sing-box 和 Extended explain，观察到 `Access-Control-Allow-Origin: *`。Extended sing-box 首次请求有一次 503，随后重试成功；不据此保证任意真实订阅、模板或节点协议都成功。浏览器视觉验收因 Windows 集成无法初始化尚未完成。

短链协议：`POST /short`，FormData 的 `longUrl` 字段为完整转换链接的标准 Base64；不手工设置 multipart 边界。成功响应要求 `Code: 1` 及合法的 `ShortUrl`。2026-10-13 使用同一合成节点实测 POST 200、跨域允许头 `*`、GET 302，Location 与原始转换链接完全一致。测试仅新增一个 30 天有效的合成链接记录。

## 旧 subweb 修正范围

默认选中明确的 Extended 地址；接口、客户端和模板按类型联动；来源初始值从数组修正为字符串；Surge target/ver 拆分；移除 XUDP；空参数不发送；编码使用 URLSearchParams；错误提示和短链 Code=0 检查；去掉错误的 multipart header；输入修改清除旧结果。原页面外层主题和卡片风格保留，新项目独立重构布局。
