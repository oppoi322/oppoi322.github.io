# rose_fist demo（网页端）

这个 demo 允许你在网页里上传图片：

- 若识别为“握拳/rock/fist”，会把玫瑰叠加到手上。
- 若不是握拳，则不叠加。

实现方式：
- 纯前端（无后端）
- 使用 MediaPipe Tasks Vision 的 `HandLandmarker`
- 规则与 Python 版本一致：用四指 PIP 角度判断弯曲数量

打开方式：

- 部署到 GitHub Pages（在 `oppoi322.github.io` 上）后，访问：
  - `/rose_fist/demo/`

如果本地预览：

- 需要一个静态文件服务器（因为浏览器 module + 跨域限制）。例如：

```bash
cd oppoi322.github.io
npx http-server -p 8080
# 然后打开 http://localhost:8080/rose_fist/demo/
```
