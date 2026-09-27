<p align="center">
  <a href="https://github.com/Cans518/df01-studio">
    <img src="docs/assets/df01-logo.svg" alt="DF-01 logo" width="152" height="152">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/assets/ninedrive-logo.jpg" alt="玖驱科技 Logo" width="152" height="152">
</p>

<h1 align="center">果蝇1号 · DF-01</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-22314E?style=for-the-badge" alt="简体中文"></a>
  <a href="docs/README.en.md"><img src="https://img.shields.io/badge/Language-English-3776AB?style=for-the-badge" alt="English documentation"></a>
  <a href="docs/README.fr.md"><img src="https://img.shields.io/badge/Langue-Fran%C3%A7ais-0055A4?style=for-the-badge" alt="Documentation française"></a>
</p>

<p align="center">
  DF-01 是一款开源串口读卡工作台，用于读取卡号、编辑数据块、管理认证密钥和配置读卡模块。基于 Rust、Tauri 2、React 和 TypeScript 构建，应用可离线运行，支持中文与英文界面。
</p>

<p align="center">
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-stable-000000?style=flat-square&amp;logo=rust&amp;logoColor=white" alt="Rust stable"></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&amp;logo=tauri&amp;logoColor=white" alt="Tauri 2"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React 19"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5.8"></a>
</p>

<p align="center">
  <a href="https://github.com/Cans518/df01-studio/issues"><img src="https://img.shields.io/badge/Feedback-GitHub%20Issues-238636?style=flat-square&amp;logo=github&amp;logoColor=white" alt="GitHub Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-087F70?style=flat-square" alt="Apache License 2.0"></a>
</p>

![DF-01 工作台](docs/screenshots/df01-workbench-day.png)

## 功能

- **读卡与自动上报**：HEX／十进制卡号、自动读卡号与读块、防重读时间、天线增益。
- **数据块编辑**：S50 的 64 个块、Ultralight／NTAG 连续四页读取、多编码转换、JSON 导入导出。
- **密钥与配置**：独立 Key A／Key B、模块 ID、配置回读；日志中的密钥与控制块内容脱敏。
- **语音与电机参数**：连接偷油婆产品后显示扩展页，配置 TTS、启动延时、缓升、初始占空比和上电方向。
- **通信观察**：报文过滤、搜索、解码、复制和日志导出。
- **本地体验**：内置模拟设备、四种主题、两种界面密度与声音开关。

## 多主题预览

琥珀标本、苔原微光、夜航观测与高对比，使用同一工作台展示。点击图片查看原图。

[![DF-01 四种主题对比](docs/screenshots/df01-themes-overview.png)](docs/screenshots/df01-themes-overview.png)

## 快速开始

Windows 便携程序解压后运行 `df01-studio.exe`，系统需要 Microsoft Edge WebView2 Runtime。Linux 可安装 `.deb` 或运行 AppImage，环境说明见[使用指南](docs/USER_GUIDE.md)。

1. 连接串口适配器与读卡模块，选择串口，填写模块当前 ID（默认 `00`）。
2. 点击连接；通信固定为 **115200 bit/s、8N1、无流控**，程序自动回读配置。
3. 放入卡片，读取卡号或数据块；自动方式、防重读和增益分别点击保存。
4. 没有硬件时选择“模拟设备”，再选择果蝇或偷油婆，即可体验操作。

写入前核对目标块和 16 字节内容。块 0 只读，扇区尾块写入需额外确认；导入 JSON 只载入编辑器，不直接写卡。长 UID 仅提供末四字节。

## 从源码运行

需要 Node.js **20.19+（20.x）或 22.12+**、npm 和 Rust stable。Windows 还需 Visual Studio C++ Build Tools（MSVC）、Windows SDK 与 WebView2。Linux 的系统依赖见[使用指南](docs/USER_GUIDE.md)。

```sh
git clone https://github.com/Cans518/df01-studio.git
cd df01-studio
npm ci
npm run desktop
```

仅在浏览器体验界面和模拟器：

```sh
npm run dev
```

打开 <http://127.0.0.1:1420/>。真实串口需要桌面程序；以上两种启动方式共用端口，请选择一种运行。

## 通信协议

```text
7F | LEN | ADDR | CMD | PARAMS... | XOR
LEN = 3 + 参数字节数
XOR = LEN ^ ADDR ^ CMD ^ 每个参数字节
```

帧头后的每个 `7F` 字节均双写为 `7F 7F`，校验在转义前计算。请求逐条发送并等待应答；自动上报由模块主动发送。

| 操作 | 请求 → 响应 |
| --- | --- |
| 读取卡号／数据块／写块 | `10 → 90` / `11 → 91` / `12 → 92` |
| 装载密钥／设置模块 ID | `2B → AB` / `2D → AD` |
| 自动方式／防重读／增益 | `2E → AE` / `2F → AF` / `30 → B0` |
| 配置回读 | `31 → B1` |
| 启动时序／初始占空比／上电方向 | `32 → B2` / `33 → B3` / `34 → B4` |

字段、应答状态、兼容规则和报文示例见[通信协议](docs/PROTOCOL.md)与[指令和参数表](docs/指令和参数表.md)。

## 文档

- [使用指南](docs/USER_GUIDE.md)：安装环境、连接、读写、扩展功能与常见问题。
- [通信协议](docs/PROTOCOL.md)：帧格式、命令与配置回读。
- [指令和参数表](docs/指令和参数表.md)：逐条命令、参数与响应。
- [开源组件](docs/THIRD_PARTY.md)：依赖来源与许可。

## 开源协议

本项目采用 [Apache License 2.0](LICENSE)（SPDX：`Apache-2.0`）。版权归属见 [NOTICE](NOTICE)，第三方组件保留各自许可，详见 [THIRD-PARTY-NOTICES.txt](docs/THIRD-PARTY-NOTICES.txt)。
