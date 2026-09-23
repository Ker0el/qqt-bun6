# 后续公网部署

部署文件已准备，当前仍只在你的电脑运行，尚未发布到公网。

需要：一台支持 Docker Compose 的 Linux 服务器、一个指向该服务器的域名，以及可访问的 TCP 80/443 端口。

1. 将此目录传到服务器。原图和音频已在 `public/assets` 内，无需 D 盘素材。
2. 把 `.env.example` 复制为 `.env`，将 `GAME_DOMAIN` 改成自己的域名。
3. 运行 `docker compose up -d --build`。
4. 打开 `https://你的域名`。所有玩家进入同一个大厅，通过 WebSocket 共享房间与对局。

Caddy 负责 HTTPS 和 WebSocket 反向代理，应用端口 8787 只在容器网络内使用。[Caddy 反向代理说明](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[自动 HTTPS](https://caddyserver.com/docs/automatic-https)。

本机运行仍使用 `启动游戏.cmd`，不需要 Docker。公网配置中的 `PUBLIC_ORIGIN` 会校验浏览器来源；本地留空即可。

## 当前运行约束

- 纯真人房间，2–8 人，人数相等且准备后开局；练习场不展示在公共大厅。
- 大厅和房间保存在单个服务进程内，重启会结束现有对局。暂不做多实例扩容和跨实例房间分配。
- 已有基础消息频率限制、包大小限制和连接心跳；公网高延迟下的移动预测、重连续局及长时间压力测试仍需完成。
- 当前是昵称访客模式，没有账号系统，也不会要求 QQ 密码。
- Docker 与公网 TLS 配置尚未在真实服务器上运行验证；上线前应先在目标服务器做两地真人对局测试。
