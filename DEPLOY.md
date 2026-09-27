# 公网部署

需要：一台支持 Docker Compose 的 Linux 服务器、一个解析到该服务器的域名，以及可访问的 TCP 80/443 端口。

1. 把仓库传到服务器。原图和音频已在 `public/assets` 内，无需额外素材。
2. 把 `.env.example` 复制为 `.env`，将 `GAME_DOMAIN` 改成自己的域名。
3. 运行 `docker compose up -d --build`。
4. 打开 `https://你的域名`。所有玩家进入同一个大厅，通过 WebSocket 共享房间与对局。

Caddy 负责 HTTPS 和 WebSocket 反向代理，应用端口 8787 只在容器网络内使用。
参见 [Caddy 反向代理说明](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[自动 HTTPS](https://caddyserver.com/docs/automatic-https)。

本机运行仍使用 `启动游戏.cmd`，不需要 Docker。

## 应用配置

`server.mjs` 按 **`.runtime/config.json` > 环境变量 > 默认值** 的顺序读取配置：

```json
{ "port": 8787, "publicOrigin": "https://你的域名" }
```

- `port` —— 监听端口，默认 8787
- `publicOrigin` —— 用于校验浏览器来源（Origin）；本地留空即可

配置文件优先于环境变量，是为了兼容**无法注入环境变量**的托管面板。`.runtime/` 已在
`.gitignore` 内，不会进版本库。

## 手动部署（不用 Docker）

任意能跑 Node.js 22+ 的方式都可以，也可以挂在宝塔面板的 Node 项目、systemd 或 PM2 下。
两条实测经验：

1. **托管面板的「启动脚本」字段要填 npm script 名（如 `start`），不要填文件名。**
   部分面板面板判定的是 `package.json` 里的 `scripts` 键，填 `server.mjs` 会落到不带解释器的
   分支，改用系统自带的旧版 Node，顶层 `await` 直接语法错误。
2. **确认实际执行的是 Node 22+。** 多数发行版自带的 `node` 版本过旧；绕过包管理器直接裸跑
   `node` 时尤其容易踩到。用绝对路径指向正确的解释器最稳妥。

反向代理需支持 WebSocket：`proxy_http_version 1.1` 加上 `Upgrade` / `Connection` 头映射，
超时建议放宽到 600s。

## 当前运行约束

- 纯真人房间，2–8 人；双方人数相等且其余玩家准备后由房主开局；练习场不展示在公共大厅。
- 大厅和房间保存在**单个服务进程内**，重启会结束现有对局。暂不做多实例扩容和跨实例房间分配。
- 已有基础的消息频率限制、包大小限制和连接心跳；公网高延迟下的移动预测、重连续局及长时间
  压力测试仍需完成。
- 当前是昵称访客模式，**没有账号系统**，也不会要求任何第三方账号密码。
- Docker 与公网 TLS 配置建议先在目标服务器做两地真人对局测试再正式上线。
