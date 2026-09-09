# 果蝇1号 · DF-01 开发交接

更新时间：2026-09-10，Asia/Shanghai。工作目录：`D:\Desktop\df01-studio`。版本：1.0.0。

## 本次交付状态

Linux 脚本入口已适配：`package:portable` 使用 Node 分派，Linux 生成 deb 和含 AppImage 的便携 tar.gz，Windows 沿用原 PowerShell 打包。Tauri 自动加载 `tauri.linux.conf.json`；许可生成自动识别 Rust host 并允许指定目标。README 增补 Linux 系统依赖、串口权限、打包和浏览器测试步骤。3 项脚本测试、语法检查和 Windows host 许可生成验证通过；WSL 的旧 Node、缺失依赖及执行挂起导致 Linux 原生验证未完成。此次未重打包，现有发布包仍对应前一轮日志导出版本及文档。

日志导出已改为跟随四主题的应用内弹窗，可编辑文件名并预览当前筛选快照。桌面端直接保存 UTF-8 `.log` 到系统下载目录，同名自动编号；浏览器预览使用浏览器下载。前端 126 项、Rust 38 项测试与 14 项相关浏览器回归通过，Release 构建及原生复测通过；实际保存 79 条脱敏日志且未触发 WebView 下载界面。实现入口为 `src/components/LogExportDialog.tsx`、`src/lib/log-export.ts` 与 `src-tauri/src/log_export.rs`。

白眼果蝇彩蛋已适配四主题：卡片与 SVG 读取主题色，双眼保持白色，显示期间切换主题立即更新。四主题截图、375px 窄屏及对比度检查通过，文字对比度均大于 12；7 项现有彩蛋、音频及布局回归、Release 构建和原生 WebView2 复测通过。本次安装包和便携包已更新并逐项校验。

标题已取消分段字重，统一使用中文 UI 字体；修复实时通信搜索框高度冲突导致的表头遮挡。14 项相关浏览器回归、TypeScript / Vite、Release 构建及原生 WebView2 复测通过；原生确认四字符均由 `MicrosoftYaHeiUI-Bold` 渲染，搜索框与表头间隔 5px。

安装包和正式便携 ZIP 均已更新，便携包内 9 个文件逐项 SHA256 与当前程序和文档一致，安装包与 NSIS 产物一致。此前文件占用已解除，暂存 ZIP 已完成替换；校验文件 `release/SHA256SUMS.txt` 对应正式发布文件。原生测试实例已关闭。

前一轮命名及文档清理基线：123 项前端测试、36 项 Rust 测试、58 项浏览器回归与 1 项导入补查通过。完整记录见 `docs/VERIFICATION.md`。

## 当前状态

- 六页面、窗口标题、模拟器、内部库及发布名称统一为 DF-01。应用标识 `com.df01.studio`，Rust 库 `df01_studio_lib`，可执行文件 `df01-studio.exe`。
- 首屏包含卡片摘要、自动模式 / 增益 / 防重读的独立保存，以及通信与块解码。密钥、设备、日志使用统一卡片；外观页随桌面窗口铺满首屏。
- 成功自动上报播放短音，顶部全局静音即时生效并持久化；最高增益彩蛋包含原生窗口抖动、复位及音效，遵循减少动态效果。
- 本机设置键为 `df01.preferences`、`df01.sound-muted`；变更应用标识后不自动迁移其他标识下的设置。数据块导入导出统一使用 `df01-memory-v1`。
- 文档以当前状态组织，使用指南为 `docs/USER_GUIDE.md`。打包使用 Tauri 资源表，便携暂存目录每次重建，自动生成 `release/SHA256SUMS.txt`。

## 开发与交付

```powershell
npm run dev
# 或启动桌面开发；两者默认共用 1420 端口，选择其一
npm run desktop
```

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
npm run notices
npm run bundle
npm run package:portable
```

最终验证范围见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。发布文件为 `release/DF-01-1.0.0-x64-setup.exe` 和 `release/DF-01-1.0.0-portable.zip`，哈希仅以 `release/SHA256SUMS.txt` 为准，避免重复维护。

仅修改随附文档时可执行 `node node_modules/@tauri-apps/cli/tauri.js bundle --bundles nsis` 后重新生成便携包；程序源码或应用标识变化必须完整构建。原生验证脚本为 `scripts/native-smoke.ps1 -Configuration release`，使用隔离 WebView2 数据目录并在结束时关闭实例。

## 关键入口与约束

| 文件 | 职责 |
| --- | --- |
| `src/App.tsx` | 页面、连接、块读写与配置 |
| `src/components/Workbench.tsx`、`WorkbenchControls.tsx` | 首屏卡片、通信、解码与独立设置 |
| `src/components/unified-pages.css`、`compact-pages.css` | 卡片风格与首屏布局 |
| `src/lib/appearance.ts`、`audio.ts`、`report-sound.ts`、`gain-effects.ts` | 主题、全局音频、上报识别及彩蛋 |
| `src/lib/api.ts`、`types.ts` | IPC、浏览器模拟器与配置契约 |
| `src-tauri/src/device.rs`、`protocol.rs` | 串口工作线程、原生模拟器与帧处理 |
| `scripts/package-portable.ps1` | 发布包、文档及校验文件 |

串口请求必须串行；超时关闭连接，写入结果不确定时不重发。日志、导出及命令预览必须保留密钥与控制块脱敏。协议 UID 只有末四字节且没有请求序号，不能将自动报告归属到任意手动目标块。协议细节及权威向量见 `docs/PROTOCOL.md` 与 `docs/指令和参数表.md`。

图标源文件 `src/assets/df01-icon.svg`；平台图标生成命令见 README。当前目录已初始化为 Git 仓库，`main` 分支按功能分次提交。运行状态应现场核验，不保留临时进程号作为交接依据。
