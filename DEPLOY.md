# 后续公网部署

部署文件已准备，当前仍只在你的电脑运行，尚未发布到公网。

需要：一台支持 Docker Compose 的 Linux 服务器、一个指向该服务器的域名，以及可访问的 TCP 80/443 端口。

1. 将此目录传到服务器。原图和音频已在 `public/assets` 内，无需 D 盘素材。
2. 把 `.env.example` 复制为 `.env`，将 `GAME_DOMAIN` 改成自己的域名。
3. 运行 `docker compose up -d --build`。
4. 打开 `https://你的域名`。所有玩家进入同一个大厅，通过 WebSocket 共享房间与对局。

Caddy 负责 HTTPS 和 WebSocket 反向代理，应用端口 8787 只在容器网络内使用。[Caddy 反向代理说明](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[自动 HTTPS](https://caddyserver.com/docs/automatic-https)。

本机运行仍使用 `启动游戏.cmd`，不需要 Docker。公网配置中的 `PUBLIC_ORIGIN` 会校验浏览器来源；本地留空即可。

## 当前线上部署（2026-09-23 上线）

已部署到 `<SERVER_IP>`，公网地址 `https://play.example.com`。

代码走 GitHub 私有仓库 `Ker0el/qqt-bun6`，服务器用只读部署密钥拉取。更新流程：

```
本地 git push  →  服务器 cd /srv/play.example.com && git pull  →  面板重启 qqt-bun6
```

### 宝塔面板的两个坑（已规避，勿回退）

**1. 启动脚本必须填 `start`，不能填文件名。**
面板 `nodejsModel.py` 的模板分三支，判定条件是 `os.path.exists(project_script)` —— 而它用的是**面板进程自己的工作目录**，不是项目目录，所以填 `server.mjs` 永远判为不存在，落到不带解释器的分支：

```
nohup server.mjs &          # 解析到 /usr/bin/node = v12.22.9，顶层 await 直接语法错误
```

填 `start` 会命中 `elif project_script in scripts_keys`，生成：

```
nohup /www/server/nodejs/v24.20.0/bin/npm run start &
```

解释器和版本就都对了。**注意服务器系统自带的 node 是 v12.22.9，任何绕过面板直接裸跑 `node` 的路径都会崩。**

**2. 面板的 nodejs 类型不注入项目环境变量。**
`get_last_env()` 只生成 PATH，项目配置里填的 `PORT` / `PUBLIC_ORIGIN` 不会写进启动脚本。因此改用 `.runtime/config.json`（`server.mjs` 优先读它，其次读环境变量）。`.runtime/` 已在 `.gitignore` 内，不进版本库。

服务器上的实际配置：

```json
{ "port": 8787, "publicOrigin": "https://play.example.com" }
```

目录属主须为 `www:www`，否则面板以 www 身份运行时读不到。

### 反向代理

宝塔站点类型选**反向代理**，目标 `http://127.0.0.1:8787`，站点根目录 `/srv/play.example.com`。
面板自动生成的配置**已内置 WebSocket 支持**（`proxy_http_version 1.1` + `Upgrade`/`Connection` 映射，超时 600s），无需手工补。

证书用宝塔 Let's Encrypt 签发。注意面板申请后**不会自动部署**，需再调一次部署把证书从
`/www/server/panel/vhost/letsencrypt/<域名>/` 复制到 `/www/server/panel/vhost/cert/<域名>/` 并写进 nginx 配置。
ACME 挑战目录 `/.well-known/acme-challenge/` 必须相对**站点根目录**，即
`/srv/play.example.com/.well-known/acme-challenge/`，不是 `web/` 子目录。

### Cloudflare

`play.example.com` 目前是橙云（经 CF 代理）。实测从国内到两条路径的 TCP 往返：

| 路径 | 中位延迟 |
|---|---|
| 直连源站 | 82ms |
| 经 CF 边缘（LHR 伦敦） | 252ms |

WebSocket 建连后每个移动包都要付这约 160ms 的差值。**建议在 CF 控制台把该记录的云朵切成灰色（DNS only）直连源站** —— 与 `example.com`、`canvas.example.com`、`api.example.com` 的处理方式一致。源站证书已就绪，切换后浏览器与源站直接 TLS，无需 CF 的 SSL 模式配合。

## 当前运行约束

- 纯真人房间，2–8 人，人数相等且准备后开局；练习场不展示在公共大厅。
- 大厅和房间保存在单个服务进程内，重启会结束现有对局。暂不做多实例扩容和跨实例房间分配。
- 已有基础消息频率限制、包大小限制和连接心跳；公网高延迟下的移动预测、重连续局及长时间压力测试仍需完成。
- 当前是昵称访客模式，没有账号系统，也不会要求 QQ 密码。
- Docker 与公网 TLS 配置尚未在真实服务器上运行验证；上线前应先在目标服务器做两地真人对局测试。
