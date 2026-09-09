# 果蝇1号 · DF-01

果蝇1号是一款串口读卡模块工作台，代号 DF-01，取自果蝇属名 Drosophila。使用 Rust + Tauri 2 构建，前端采用 React、TypeScript、Tailwind CSS 4、daisyUI 5 和 Lucide 图标。界面与主要操作均为中文，应用运行不依赖外部字体、CDN 或在线服务。界面使用模块品牌和通用卡片分类，不展示芯片型号。

使用步骤见 [DF-01 使用指南](docs/USER_GUIDE.md)。协议以 `docs/指令和参数表.md` 为当前固件依据，实现细节见 [协议说明](docs/PROTOCOL.md)。身份证、制卡、清卡、充值、扣款相关命令与响应内容不在本项目范围内。

## 运行

各平台均需要 Node.js 20.19+（或 22.12+）和 Rust stable。Windows 额外需要 MSVC、Visual Studio C++ Build Tools、Windows SDK，以及 Microsoft Edge WebView2 Runtime。Linux 使用系统 WebKitGTK，依赖与打包说明见下文。

```powershell
npm install
npm run desktop
```

只预览前端与浏览器模拟器：

```powershell
npm run dev
```

浏览器地址为 http://127.0.0.1:1420/。浏览器不直接访问真实串口；连接实体设备请启动 Tauri 桌面程序。开发端口已被本项目预览占用时，先结束该预览，再运行 `npm run desktop`，避免两个 Vite 服务争用端口。

生成 Windows 安装包：

```powershell
npm run bundle
```

NSIS 安装包输出到 `src-tauri/target/release/bundle/nsis/`；独立程序位于 `src-tauri/target/release/df01-studio.exe`。目标电脑需要 WebView2 Runtime。首次打包可能需要下载 Tauri 的 NSIS 工具。

### Linux 开发与打包

Ubuntu 22.04 / 24.04 安装构建依赖（其他发行版安装对应包）：

```bash
sudo apt update
sudo apt install build-essential curl wget file pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libudev-dev patchelf
```

安装符合上述版本要求的 Node.js 和 Rust stable 后，在 Linux 文件系统中的项目副本执行以下命令。Windows 与 Linux 应分别安装依赖，不要共用 `node_modules` 或 Rust `target` 目录。

```bash
npm ci
npm run desktop
```

`npm run dev` 仍可单独预览前端。连接串口前确认当前用户具有设备权限；Ubuntu 通常需执行 `sudo usermod -aG dialout "$USER"` 后重新登录。桌面程序需要图形会话；WSL 需要 WSLg 及可访问的串口设备。

```bash
cargo fetch --manifest-path src-tauri/Cargo.toml
npm run notices
npm run bundle
npm run package:portable
```

Tauri 自动合并 `src-tauri/tauri.linux.conf.json`，生成 `deb` 与 `appimage`，不会调用 NSIS。便携打包脚本使用系统 `tar`，读取默认的 `src-tauri/target/release/bundle/`，支持本机 x64 / arm64 构建；不支持自定义 Cargo target 目录或交叉编译输出。发布文件以 x64 为例：

- `release/DF-01-1.0.0-linux-x64.deb`
- `release/DF-01-1.0.0-linux-x64-portable.tar.gz`（AppImage 与资源表中的文档，保留执行权限）
- `release/SHA256SUMS-linux-x64.txt`（独立校验文件，保留已有 Windows 校验文件）

解压便携包后运行 `./df01-studio.AppImage`。运行 AppImage 通常需要 FUSE 2：Ubuntu 22.04 安装 `libfuse2`，24.04 安装 `libfuse2t64`；没有 FUSE 时可尝试 `./df01-studio.AppImage --appimage-extract-and-run`。`.deb` 可使用 `sudo apt install ./release/DF-01-1.0.0-linux-x64.deb` 安装。

许可生成默认读取本机 `rustc -vV` 的目标，也支持 `CARGO_BUILD_TARGET` 或 `npm run notices -- --target aarch64-unknown-linux-gnu`；依赖源码须已通过 `cargo fetch` 下载。`--output /path/to/notices.txt` 可用于单独验证。正式发布前在对应平台重新生成许可文件，再构建打包。

## 设备能力

| 功能 | 命令 | 支持范围 |
| --- | --- | --- |
| 读卡号、HEX / 十进制 UID | `10/90` | 当前固件与模拟器 |
| 读取数据块 / 连续四页 | `11/91` | S50 块号 0–63；Ultralight / NTAG 起始页 0–255，一次 16 字节 |
| 写入 S50 数据块 | `12/92` | 普通块及单独确认的扇区尾块；块 0 只读 |
| 装载 Key A / Key B | `2B/AB` | 两组独立密钥，读取认证先尝试 A，再尝试 B |
| 设置模块 ID | `2D/AD` | 地址 00–FF；成功响应使用新 ID |
| 自动读卡号、关闭自动读取、自动读块 | `2E/AE` | 模块被动上报，主机不循环发读卡命令 |
| 防重读 RESET 时长 | `2F/AF` | 0 为无限期；100–3000 ms 为有限防重读 |
| 天线接收增益 | `30/B0` | 0–7 档；按响应中的实际档位更新 |
| 读取全部配置 | `31/B1` | 连接后同步一次，也可手动刷新 |

串口固定使用 115200 / 8N1、无流控；模块 ID 默认 00，可选择设备当前 ID 连接。应用不提供波特率修改，前后端均拒绝 `2C`。连接后先发送一次 `31`，同步 ID、只读波特率、自动模式、块号、密钥、防重读时间和增益；设置项只有收到成功响应后才更新已保存值。

自动模式为 `00` 读卡号、`01` 关闭、`02` 读块。防重读时间为 0 时，同 UID 无限期去重；有限时间到期后，仍在场的卡可再次上报。不同 UID 可立即上报；成功执行 `2E/2F` 会清除去重记录。手动 `10/11` 成功读取同一 UID 时也会清除该记录。持续读卡由模块自动方式完成，不使用上位机循环发送读卡命令。

较长 UID 仅收到末四字节，应用展示的是协议提供的四字节卡号，不能用于唯一识别所有长 UID 卡片。ATQA 仅用于初步识别，页号范围不代表具体芯片的实际容量。模拟器使用两张 S50 卡，不能替代 Ultralight / NTAG 实卡验证。

## 工作台

- 读卡工作台：顶部集中卡号、卡片状态和读取操作；自动模式、射频增益、防重读三组设置直接位于首屏，各自显式保存，互不覆盖未保存的输入。
- 实时通信与块数据解码：收发记录缩为左侧诊断区，保留过滤、搜索、暂停、报文详情和复制；右侧常驻解码区显示最近收到块的来源、时间与多编码结果。同一卡片随后上报卡号时保留最近块数据，换卡或断开时清空；敏感控制块及来源不明的数据继续隐藏。
- 串口列表：完整下拉选择，按 COM 编号排序；每 3 秒及窗口恢复焦点时刷新，支持手动输入，端口暂时消失时保留当前选择并标注未检测到。
- 参数输入：地址、页号、时长和超时支持清空后重新输入，空值不转为 0、不提交旧值；失焦提示无效值。天线增益使用 0–7 档滑条，显示对应 dB，点击保存后应用。
- 数据块：S50 64 块选择、16 字节编辑；读取与写入均支持 HEX、UTF-8、GBK、GB18030、ASCII、UTF-16LE、UTF-16BE、Base64 转换。提供字节长度校验、读写确认、扇区与整卡读取、进度和停止、JSON 导入导出，以及 Ultralight / NTAG 连续页读取。
- 数据块布局：桌面首屏左侧展示全部 64 块地图和当前扇区，右侧展示 HEX / 编码输入、读写操作及解码；导入、导出和整卡读取集中在顶部。长解码结果与扇区数据在各自区域滚动。小屏可展开地图选择全部 64 块，选块后返回当前块；解码区不重复展示字节网格。
- 密钥管理：采用与工作台一致的输入卡片和状态卡片，分别输入 Key A / Key B，默认隐藏，可选择相同密钥；已同步密钥默认掩码显示，成功装载后清空输入，不保存到浏览器本地存储。
- 设备配置：通信参数、模块自动方式、射频与防重读、会话选项统一为四张卡片，900 × 640 首屏可操作；保留模块 ID、完整配置刷新和连接超时，波特率固定只读。
- 通信日志：工具栏、记录区和底部说明统一置于卡片内，桌面长记录在卡片内部滚动并保留表头，窄屏按记录分行排列；支持方向与异常过滤、关键字搜索、暂停显示、复制、`.log` 导出和清空。导出弹窗跟随四种主题，可修改文件名、预览内容；桌面端直接保存到系统下载目录，同名文件自动编号，浏览器预览使用浏览器下载。文件为 UTF-8 文本，包含打开弹窗时的全部筛选记录及脱敏报文。界面最多显示最近 200 条，后端保留有界日志。
- 外观：琥珀标本、苔原微光属于日间主题，夜航观测、高对比属于夜间主题；顶部按钮在两组最近使用的主题之间切换，重启后保留选择，并兼容旧偏好。六足果蝇图标以薄荷绿翅膀、橙色复眼、琥珀腹部和观测环呼应主题。另有紧凑密度、跟随系统或减少动画选项，偏好本地保存。
- 外观首屏：主题预览随可用宽高伸展，默认窗口采用双列预览，较矮桌面窗口改用单行四列；密度、动态效果和关于信息铺满首屏并保留底部留白。900 × 640、1280 × 820、1920 × 1080 及舒适 / 紧凑密度均已验证，窄屏保留自然滚动。
- 声音提示：收到新的成功自动读卡号 / 数据块上报时播放短提示音，同批上报合并提示，重复刷新不重播。顶部扬声器按钮控制全局静音，同时管理上报提示音和彩蛋音效；静音立即停止声音，状态保存在本机，取消静音不会补播历史上报。
- 最高增益彩蛋：在工作台或设备配置页手动将滑条调到 7 档（48 dB），出现白眼果蝇和“白眼果蝇抖擞精神！”，整个桌面窗口短暂抖动后回到原位，伴随轻量振翅声与上扬提示音。最大化、全屏或浏览器预览时抖动整个应用界面；“减少动态效果”下保留提示和音效，关闭抖动。提示 4 秒后自动消失，也可关闭，不抢焦点；彩蛋不会自动保存参数，设备读回最高档不会触发。
- 原生窗口：隐藏系统标题栏，顶部状态栏与日间 / 夜间主题按钮同栏提供拖动、最小化、最大化 / 还原和关闭按钮，不另设底部栏；普通浏览器不显示窗口控件，界面不显示“桌面版 / 手机版”字样。

导入块文件只把选定块载入编辑器，必须另外确认写入。块 0 始终只读；每个扇区末块包含密钥与访问条件，写入会额外提示风险。整卡读取只读取，不执行批量写入。数据导出排除扇区控制块，通信日志与命令预览隐藏密钥及控制块内容。

## 稳定性

Rust 工作线程独占串口，前端请求串行执行。解析器处理分包、粘包、噪声、全帧体 `7F` 转义、长度和 XOR 校验。超时后关闭连接，避免迟到响应被下一请求误接收。设置或写入超时会标记结果不确定，不自动重发。连接错误、串口拔出、响应状态错误及前端异常均进入可见错误反馈。

协议没有请求序号，主动 `90/91` 上报与同命令请求响应无法完全区分。单块和连续页读取会先关闭自动读块，批量读取会先关闭自动方式；底层同时拦截自动目标与手动目标冲突的读取。快速切换模式使用已保存的块号，配置刷新完成后才开放下一次操作。断开连接不会重置模块实际配置。

模拟器提供两张 S50 卡、独立块内存、无卡状态、换卡、配置同步、三种自动模式、有限与无限 UID 防重读。浏览器模拟器用于界面预览，原生模拟器会走 Rust 编解码与设备服务；两者均不能替代实际串口电气、时序与卡片认证验证。

## 验证

```powershell
npm test
npm run test:e2e
npm run test:scripts
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

E2E 默认使用已安装的 Microsoft Edge；没有 Edge 时安装 Playwright Chromium 后运行。测试生成的页面截图与跟踪保存在 `test-results/`。协议向量、实现范围与实机验收清单分别见 [docs/PROTOCOL.md](docs/PROTOCOL.md) 和 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。真实设备联调的完成情况以验收记录为准。

Linux 首次运行浏览器测试前执行 `npx playwright install --with-deps chromium`。`npm run test:scripts` 验证归档内容、重复打包、路径边界和许可目标选择。`scripts/native-smoke.ps1` / `native-smoke.mjs` 使用 WebView2/CDP，仅用于 Windows；浏览器测试不代表 Linux 原生 WebKitGTK 验证。

## 目录

```text
src/                    React 界面、组件、类型和浏览器模拟器
src-tauri/src/           Rust 串口服务、帧协议与 Tauri 命令
src-tauri/icons/         桌面应用图标
tests/                  Playwright 工作流与响应式截图测试
docs/                   使用指南、指令表、协议说明、验收清单和验证证据
scripts/                打包、许可声明生成和原生窗口验证脚本
release/                当前安装包和便携 ZIP
```

开源依赖与主题来源见 [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md)。

安装包为 `release/DF-01-1.0.0-x64-setup.exe`，便携包为 `release/DF-01-1.0.0-portable.zip`。版本号 `1.0.0`，更新日期 2026-09-10；文件哈希见 `release/SHA256SUMS.txt`，验证结果见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。便携版解压后运行 `df01-studio.exe`，需要 WebView2 Runtime。重新发布时依次执行 `npm run notices`、`npm run bundle`、`npm run package:portable`。

默认窗口为 1280 × 820，最小为 900 × 640。工作台在这两种窗口下无需滚动主页面即可看到全部操作区，包括自动读块的编码选择；通信记录、报文详情和解码结果在各自区域内滚动。小屏及其他页面保留正常滚动。界面默认紧凑密度，顶部栏与侧边导航固定。

安装包与便携版附带使用指南 `docs/USER_GUIDE.md`、指令表 `docs/command-table.md`、协议说明及软件验证记录。

图标源文件为 `src/assets/df01-icon.svg`，运行 `node node_modules/@tauri-apps/cli/tauri.js icon src/assets/df01-icon.svg --output src-tauri/icons` 可重新生成平台图标。

应用标识统一为 `com.df01.studio`，本机偏好使用 `df01.preferences` 与 `df01.sound-muted`。从其他应用标识的版本更新后需重新选择主题、密度及静音状态；不会自动迁移设置或卸载此前安装。数据块导入与导出统一使用 `df01-memory-v1`。
