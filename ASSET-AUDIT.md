# 2026-09-22 素材检查记录

已检查 `D:/333` 下的 QQtang 与 PVE整合包v20240309。

本轮实际接入：
- 原版蓝色箭头与点击手形，浏览器使用 PNG 指针帧。
- 音效目录中的自放泡、爆炸、困泡破裂、Ready/Go、按钮和退出音效；自放泡仅本客户端播放。
- match.ogg 背景音乐。
- flame_C/U/D/L/R 的透明 PNG 动画帧。
- zs.png 赞赏码，复制前后 SHA-256 一致。

已读取但未直接替代竞技参数：
- PVE 整合包 hero JSON、地图配置和说明文件。
- PVE 的散图目录和带原始偏移量的文件命名。
- _oracle 下的资源格式测试脚本；未把脚本中的操作当作用户请求。

现有导入器：tools/import-assets.py；发行包选择性解码：tools/import-package-assets.py。
素材源目录未被修改。所有项目运行资源都位于 public/assets。
