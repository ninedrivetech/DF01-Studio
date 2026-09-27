<p align="center">
  <a href="https://github.com/ninedrivetech/DF01-Studio">
    <img src="assets/df01-logo.svg" alt="DF-01 logo" width="152" height="152">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/ninedrive-logo.jpg" alt="玖驱科技 Logo" width="152" height="152">
</p>

<h1 align="center">果蝇1号 · DF-01</h1>

<p align="center">
  <a href="../README.md"><img src="https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-22314E?style=for-the-badge" alt="简体中文"></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/Language-English-3776AB?style=for-the-badge" alt="English documentation"></a>
  <a href="README.fr.md"><img src="https://img.shields.io/badge/Langue-Fran%C3%A7ais-0055A4?style=for-the-badge" alt="Documentation française"></a>
</p>

<p align="center">
  DF-01 (Fruitfly No. 1) is an open-source desktop workstation for serial card readers. Read card IDs, edit memory blocks, manage authentication keys and configure reader modules. Built with Rust, Tauri 2, React and TypeScript, it runs offline and provides Chinese and English application interfaces.
</p>

<p align="center">
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-stable-000000?style=flat-square&amp;logo=rust&amp;logoColor=white" alt="Rust stable"></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&amp;logo=tauri&amp;logoColor=white" alt="Tauri 2"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React 19"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5.8"></a>
  <a href="https://github.com/ninedrivetech/DF01-Studio/issues"><img src="https://img.shields.io/badge/Issues-238636?style=flat-square&amp;logo=github&amp;logoColor=white" alt="GitHub Issues"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-087F70?style=flat-square" alt="Apache License 2.0"></a>
</p>

![DF-01 workstation](screenshots/df01-workbench-day.png)

## Features

- **Card reading and automatic reports**: hexadecimal/decimal IDs, automatic UID or block reading, duplicate suppression and antenna gain.
- **Memory editing**: 64 S50 blocks, four-page Ultralight/NTAG reads, multiple text encodings and JSON import/export.
- **Keys and configuration**: separate Key A/Key B, module ID and configuration readback; keys and control blocks are masked in logs.
- **Speech and motor settings**: the Cockroach product opens an extension page for TTS, startup delay, ramp time, initial duty cycle and power-on direction.
- **Communication tools**: frame filtering, search, decoding, copying and log export.
- **Local interface**: simulated devices, four themes, two interface densities and sound controls.

## Theme overview

Amber Specimen, Tundra Glow, Night Watch and High Contrast, shown on the same workstation. Click the image to view it at full size.

[![DF-01 four-theme comparison](screenshots/df01-themes-overview.png)](screenshots/df01-themes-overview.png)

## Quick start

On Windows, extract the portable application and run `df01-studio.exe`. Microsoft Edge WebView2 Runtime is required. On Linux, install the `.deb` package or run the AppImage; see the [user guide](USER_GUIDE.md) for system requirements.

1. Connect the serial adapter and reader, select the port and enter the current module ID (default `00`).
2. Connect and wait for configuration readback. Communication uses **115200 bit/s, 8N1, no flow control**.
3. Present a card and read its ID or memory. Save automatic mode, duplicate suppression and gain separately.
4. To explore without hardware, select a simulated device and choose Fruitfly or Cockroach.

Before writing, check the target block and its 16 bytes. Block 0 is read-only; sector trailer writes require additional confirmation. JSON import only loads the editor. For long UIDs, the protocol returns only the last four bytes.

## Run from source

Install Node.js **20.19+ (20.x) or 22.12+**, npm and Rust stable. Windows also requires Visual Studio C++ Build Tools (MSVC), Windows SDK and WebView2. Linux dependencies are listed in the [user guide](USER_GUIDE.md).

```sh
git clone https://github.com/ninedrivetech/DF01-Studio.git
cd DF01-Studio
npm ci
npm run desktop
```

For the browser interface and simulator:

```sh
npm run dev
```

Open <http://127.0.0.1:1420/>. Physical serial ports require the desktop application. Both commands use the same port; run one at a time.

## Communication protocol

```text
7F | LEN | ADDR | CMD | PARAMS... | XOR
LEN = 3 + number of parameter bytes
XOR = LEN ^ ADDR ^ CMD ^ each parameter byte
```

Every `7F` after the frame header is escaped as `7F 7F`. Calculate the checksum before escaping. Send requests sequentially and wait for each response; automatic reports originate from the module.

| Operation | Request → response |
| --- | --- |
| Read UID / read block / write block | `10 → 90` / `11 → 91` / `12 → 92` |
| Load keys / set module ID | `2B → AB` / `2D → AD` |
| Automatic mode / duplicate suppression / gain | `2E → AE` / `2F → AF` / `30 → B0` |
| Read configuration | `31 → B1` |
| Startup timing / initial duty cycle / power-on direction | `32 → B2` / `33 → B3` / `34 → B4` |

See the [protocol guide](PROTOCOL.md) and [command reference](指令和参数表.md) for fields, status codes, compatibility and frame examples.

## Documentation

The detailed documentation is in Chinese.

- [User guide](USER_GUIDE.md): environment setup, connection, memory operations, extensions and troubleshooting.
- [Communication protocol](PROTOCOL.md): framing, commands and configuration readback.
- [Command reference](指令和参数表.md): individual commands, parameters and responses.
- [Open-source components](THIRD_PARTY.md): dependencies and licenses.

## License

Licensed under the [Apache License 2.0](../LICENSE) (SPDX: `Apache-2.0`). See [NOTICE](../NOTICE) for attribution. Third-party components retain their respective licenses; see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
