# 历史粘贴板

Windows 桌面剪贴板历史工具。应用会自动记录复制过的文字和图片，以卡片形式按时间倒序展示，支持搜索、置顶、删除、图片预览、自动过期清理、系统托盘常驻和 `Ctrl+Shift+Z` 全局快捷键唤起。

## 功能

- 自动采集剪贴板文字和图片
- 文字/图片卡片列表，按时间倒序展示
- 关键词实时搜索
- 置顶重要内容，避免自动清理
- 保留天数设置和过期清理
- 浅色、深色、跟随系统主题
- 系统托盘常驻、开机自启、全局快捷键唤起
- 从输入框附近唤起时，点击卡片可自动粘贴回原输入框

## 技术栈

- Electron
- sql.js
- Electron nativeImage
- electron-builder
- JavaScript

## 开发

```powershell
npm install
npm start
```

开发模式：

```powershell
npm run start:dev
```

运行测试：

```powershell
npm test
```

生成图标：

```powershell
npm run gen-icon
```

打包 Windows 安装程序：

```powershell
npm run build
```

## 项目结构

- `src/main/`：Electron 主进程、剪贴板监听、数据库、托盘、快捷键、开机自启
- `src/renderer/`：渲染进程页面、样式和交互逻辑
- `test/`：Node.js 测试
- `docs/`：需求、技术、设计、目录、执行计划和用户手册
- `devlog/`：开发日志
- `assets/`：应用图标和生成脚本
- `scripts/`：打包产物优化脚本

## 运行时数据

运行时数据库和图片文件存放在 Electron 的 `userData` 路径下，不提交到 Git。仓库也会忽略 `node_modules/`、`dist/`、`data/` 和本地工具配置。

## 许可证

MIT
