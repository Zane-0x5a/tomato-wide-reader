# 番茄小说宽屏阅读

Edge / Chromium Manifest V3 扩展，将番茄小说网页阅读器转换为固定视口的单栏或双栏翻页阅读器。

> **非官方项目。** 与番茄小说及其运营方无任何隶属、赞助或背书关系。本扩展只改变已经交付到浏览器的网页内容的呈现方式，不提供内容、不绕过登录或付费、不下载或导出书籍。「番茄小说」为其权利人的商标，此处仅用于说明本扩展适配的站点。

## 安装

1. 在 Edge 打开 `edge://extensions`。
2. 启用“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择 `.output/chrome-mv3`。
4. 打开受支持的 `https://fanqienovel.com/reader/...` 页面。扩展会自动启动。

源码构建：

```powershell
npm install
node tools/make-icons.mjs
npm run check
```

构建还依赖 `generated/fanqie-glyph-map.json`（`src/content/normalize.ts` 静态导入，由 `tools/build_glyph_map.py` 生成）。该文件当前不在仓库中，克隆后需自行生成才能构建。

## 使用

- 点击页面左右外侧留白，或使用 `Left/Right`、`PageUp/PageDown` 翻页。
- 鼠标靠近顶部或底部显示控制层。
- 鼠标滚轮按一次明确手势翻一页，小幅噪声不会触发。
- 宽窗口显示双栏 spread，窄窗口自动回退单栏，不会缩小用户字号。
- 扩展无法验证正文完整性时会保留原网页并显示可关闭的诊断。

## 内容边界

扩展只改变网页中已经交付给浏览器的内容呈现，不绕过登录、付费、DRM 或 App 专属交付。出版读物 VIP（包括已验证的《倦怠社会》）目前不受支持，因为番茄网页服务没有返回正文。

## 开发验证

- `npm run typecheck`: 严格 TypeScript。
- `npm run test`: Unicode、锚点、设置与适配器契约测试。
- `npm run build`: Edge/Chrome MV3 解压缩构建。
- 浏览器证据与生成概念保存在本地 `output/`，未纳入仓库：其中的抓图包含商业小说正文原文。用于 README 或商店页的截图应改用公有领域文本。
