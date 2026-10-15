# Mihomo 配置校验服务

独立于 subweb-next 静态前端与转换后端运行。浏览器先取得转换后的 YAML，再通过 `POST /validate` 提交原文；服务调用真实的 `mihomo -t -d <临时目录> -f <配置文件>`。不启动代理监听、不接管系统代理、不启用 TUN。

## 本机运行

需要 Node.js 22.12+ 和 Mihomo alpha 可执行文件。服务启动时会核对版本，稳定版不会被误用。下列命令在仓库根目录的 PowerShell 中运行：

```powershell
npm ci --prefix services/mihomo-validator
$env:MIHOMO_BIN = 'C:\tools\mihomo-alpha.exe'
$env:VALIDATOR_ORIGINS = 'http://127.0.0.1:5173'
npm run validator
```

默认只监听 `127.0.0.1:25501`。在面板“校验服务设置”填入 `http://127.0.0.1:25501`。如果预览使用 5174、局域网 IP 或生产域名，需把对应的**前端页面来源**（协议、域名、端口，不含路径）加入 `VALIDATOR_ORIGINS`，多个来源以英文逗号分隔。

配置包含 GEOSITE / GEOIP 时，还需要与客户端相符的地理数据库。将专用数据库目录设置为 `MIHOMO_GEODATA_DIR`，其中可含 `geosite.dat`、`geoip.dat`、`geoip.metadb`、`Country.mmdb` 和 `ASN.mmdb`。每次校验只复制这些已知文件到独立临时目录，不改动原始数据库。缺少数据时内核可能尝试下载；下载失败、数据集缺失和超时不等于配置语法错误，要结合返回日志判断。

## Docker 部署

Dockerfile 从官方 `metacubex/mihomo:Alpha`（大小写敏感）镜像复制 alpha 内核及地理数据库，Node.js 服务单独提供 HTTP API；不需要编译 C++ 或 Go。每次构建加 `--pull` 更新基础镜像，实际 alpha 提交版本会显示在校验结果中。

在 `services/mihomo-validator` 目录创建仅服务端使用的 `.env`：

```dotenv
VALIDATOR_TOKEN=替换成随机生成的独立访问令牌
VALIDATOR_ORIGINS=https://你的前端域名
```

然后运行：

```shell
docker compose build --pull
docker compose up -d
```

GitHub Actions 会在前端和真实 alpha 内核测试通过后，向 `lovinyarn/subweb-next-validator` 发布 `latest` 和 `sha-<提交>` 镜像（amd64 / arm64）。Docker Hub 凭据通过仓库的 `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN` Secrets 注入。已发布后可用 `docker compose pull`、`docker compose up -d --no-build` 部署，无需本机编译。

Compose 默认仅将端口暴露到宿主机回环地址，并设置只读文件系统、临时目录、512 MiB 内存、1 CPU 和进程数限制。供公网前端使用时，在反向代理后以 HTTPS 提供服务，并把该 HTTPS 根地址填入前端。部署者需限制服务的出站网络访问；该接口面向可信用户，不用于匿名接收公网不可信配置。保留令牌校验和来源白名单。

访问令牌在面板手动输入，只保留于页面内存；不要写进前端的 `public/conf/config.js`。HTTPS 页面连接 HTTP 服务可能被混合内容策略拦截；连接本机或局域网服务还可能需要浏览器授予本地网络权限。生产部署优先使用 HTTPS 同源反向代理，例如将 `/mihomo-check/validate` 转发到服务的 `/validate`，前端服务根地址填 `https://前端域名/mihomo-check`。

## API

- `GET /health`：返回内核版本与 `config-test` 模式。配置令牌后该接口也需要鉴权。
- `POST /validate`：`Content-Type: application/json`，正文只有 `{"config":"完整 YAML 原文"}`；可附 `Authorization: Bearer <令牌>`。
- 配置校验成功或内核明确拒绝配置均返回 HTTP 200，使用 `valid` 区分结果。响应包括 `engine: "mihomo"`、`mode: "config-test"`、`version`、`output`、`durationMs`。
- HTTP 400/413/415/422 为请求无效、超限或资源无法随 YAML 提交；401/403 为鉴权/来源错误；429 表示已有任务；503/504 表示内核不可用或校验未完成。前端不会把这些情况显示为通过。

服务一次执行一个任务，原文最多 4 MiB，内核执行上限 20 秒，输出上限 64 KiB。不接收待抓取的订阅 URL、可执行命令或文件名。不支持 `type: file` Provider、外部证书文件或上级/绝对资源路径。完整 YAML 可能包含密钥，请只发往可信服务。临时配置任务结束即删除，不打印请求体；返回日志隐藏常见密钥、链接和临时目录。部署侧也应关闭请求体日志。

## 校验范围

能发现内核解析阶段的 DNS 语法、无效节点参数、策略组/规则引用等错误。校验的是**转换后的原始配置**，不包含 Sparkle 等客户端后续的 DNS 接管、覆写、合并和脚本操作。通过 `-t` 不代表端口可绑定、TUN 权限可用、Provider 已全部下载、节点可连通或实际启动一定成功。

仅支持完整的 Clash / Mihomo 与 ClashR YAML；节点列表、Clash Script、Stash 和其他客户端格式不显示入口。不同内核版本和地理数据可能得到不同结果，应尽量与客户端保持一致。

## 许可

本服务沿用项目的 GPL-3.0 许可，见同目录 LICENSE。Docker 中的内核来自 [MetaCubeX/mihomo Alpha](https://github.com/MetaCubeX/mihomo/tree/Alpha)，按内核版本输出中的提交号可取得对应源代码和许可证；本项目未修改内核。YAML 解析库采用 ISC 许可，随 npm 包保留原许可。

## 测试

```powershell
$env:MIHOMO_TEST_BIN = 'C:\tools\mihomo-alpha.exe'
npm run test:validator
```

包含 HTTP/CORS/鉴权/并发边界测试，以及真实内核验证：正常配置成功、`rule` 模式混入 `"*"` 失败、规则引用不存在的策略失败。未设置 `MIHOMO_TEST_BIN` 时只跳过真实内核测试。GitHub Actions 从官方 `Prerelease-Alpha` Release 选择 amd64-v1 alpha 资产执行这些测试。
