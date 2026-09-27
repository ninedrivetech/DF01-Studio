# 果蝇1号 · DF-01 开发交接

更新时间：2026-09-27，Asia/Shanghai。版本：1.1.1。

## 当前交付

- Windows x64 仅交付便携版：`release/DF-01-1.1.1-portable.zip`。校验值以同目录 `SHA256SUMS.txt` 为准。解压运行 `df01-studio.exe`，需要 WebView2 Runtime。
- 作者 Mzee，邮箱 xiemaths@outlook.com，公司上海玖驱科技有限公司。关于区域左侧显示软件与版本，右侧显示作者与联系方式，窄屏自动上下排列。
- 权威协议为 `docs/指令和参数表.md`（Flash v15）。支持旧版配置回包及语音、启动时序、初始占空比、上电方向；果蝇不显示或进入偷油婆扩展页。
- 2026-09-27 重打包保留 1.1.1 版本，已接入 `34/B4` 电机上电方向及 `B1` 偏移33的 `motorDirection`，前端独立保存，成功回包后同步配置，下次上电或复位生效。界面不显示 GPIO 名称；旧固件缺少方向字段时禁用，Rust 和浏览器模拟器均支持 v15。
- 中英文切换保留连接和草稿；四主题、双密度及 900×640 最小窗口已验证。两处通信列表共用日志筛选，支持搜索中英文命令名并保留原始报文。

## 验证证据

2026-09-27 v15：前端单元测试 144 项、Rust 测试 48 项、相关浏览器回归 16 项、原生 Debug 和 Release WebView2 各 29 项通过；严格 Clippy、格式检查、TypeScript / Vite、Windows Debug 和 Release 构建通过。重新打包前 7 项打包脚本测试通过，依赖许可重新生成。详见 `docs/VERIFICATION.md`，最终原生记录为 `docs/screenshots/native-release-smoke.json`。

以下为此前 1.1.1 发布验证：前端单元测试 134 项、Rust 测试 45 项、打包脚本测试 7 项通过；严格 Clippy、TypeScript / Vite 和 Windows Release 构建通过。

浏览器覆盖 78 个场景，完整运行中 1 项受到开发服务器重载影响，相关 9 项随后全部复测通过。关于布局调整后另有 14 项界面回归通过。最新原生 WebView2 29 项检查通过，报告见 `docs/screenshots/native-release-smoke.json`，截图为 `native-release-*.png`。

详细范围和历史结果见 `docs/VERIFICATION.md`、`docs/AUDIT-2026-09.md`。模拟器不能证明真实射频、硬件语音、电机动作和 Flash 掉电保存；本轮未向实体模块发送指令。Linux 原生构建与运行仍待对应平台验证。

## 开发和发布

```powershell
npm run dev
# 或 npm run desktop；两者共用 1420 端口
npm test
npm run test:e2e
npm run test:scripts
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run notices
npm run build:portable
npm run package:portable
```

便携脚本直接从 Tauri 资源清单生成 ZIP，逐项校验内容后替换旧包，无需安装包或 `portable-docs` 暂存目录。程序源码变化需要重新构建；仅随包文档变化可重新执行便携打包。原生验证入口是 `scripts/native-smoke.ps1 -Configuration release`，使用隔离 WebView2 数据目录并关闭测试实例。浏览器回归期间避免修改文件或执行可能触发开发服务器重载的任务。

## 关键约束

- 串口请求串行；超时断开连接以隔离迟到响应，写入或设置结果不确定时不自动重发。初始配置查询失败后清理连接。
- 日志、导出与预览必须保留密钥和扇区控制块脱敏。协议 UID 仅含末四字节，主动上报没有请求序号，不能随意归属到手动读取的块。
- 块导入仅载入编辑器，写入仍需确认；块 0 只读，扇区控制块额外确认。无效数字草稿不变成 0、不提交旧值。
- 本地偏好键为 `df01.preferences`、`df01.sound-muted`、`df01.language`；数据块文件格式为 `df01-memory-v1`。应用标识 `com.df01.studio`。
- 产品作者与 Git 提交身份分开维护；仓库提交身份为 `Cans518 <798061533@qq.com>`。

界面入口在 `src/App.tsx` 与 `src/components/`；协议和模拟器在 `src-tauri/src/device.rs`、`protocol.rs`、`src/lib/api.ts`；发布清单位于 `src-tauri/tauri.conf.json`，打包脚本位于 `scripts/`。
