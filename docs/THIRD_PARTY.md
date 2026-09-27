# 开源组件

本项目采用 [Apache License 2.0](../LICENSE)。以下列出主要开源组件，各组件保留其自身许可；完整声明见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。具体锁定版本分别保存在 `package-lock.json` 和 `src-tauri/Cargo.lock`，完整许可文本保留在依赖安装目录。

| 组件              | 用途                          | 许可 / 来源                                            |
| ----------------- | ----------------------------- | ------------------------------------------------------ |
| React / React DOM | 界面与状态                    | MIT · https://github.com/facebook/react                |
| Tailwind CSS      | CSS 构建及实用类              | MIT · https://github.com/tailwindlabs/tailwindcss      |
| daisyUI           | 按钮组件、语义色板和四套主题  | MIT · https://github.com/saadeghi/daisyui              |
| Lucide            | 导航、工具与状态图标          | ISC · https://github.com/lucide-icons/lucide           |
| @kayahr/text-encoding | GBK、GB18030、Unicode 编码转换 | MIT · https://github.com/kayahr/text-encoding |
| Tauri             | 桌面窗口、WebView 与 Rust IPC | MIT / Apache-2.0 · https://github.com/tauri-apps/tauri |
| serialport-rs     | 本机串口枚举与读写            | MPL-2.0 · https://github.com/serialport/serialport-rs  |
| Serde             | Rust 数据序列化               | MIT / Apache-2.0 · https://github.com/serde-rs/serde   |
| Vite              | 前端开发与构建                | MIT · https://github.com/vitejs/vite                   |
| TypeScript        | 类型检查                      | Apache-2.0 · https://github.com/microsoft/TypeScript   |
| Prettier          | 源代码格式化                  | MIT · https://github.com/prettier/prettier             |

四套主题基于 daisyUI，应用通过 `data-theme` 切换 `corporate`、`business`、`emerald` 和 `black`，并使用自定义色彩及语义变量统一页面。界面图标使用 Lucide React 组件；程序图标源文件为本项目的 `src/assets/df01-icon.svg`，平台 PNG / ICO 由该文件生成。
