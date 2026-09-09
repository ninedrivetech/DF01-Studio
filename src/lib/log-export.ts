import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./api";
import { COMMAND_NAMES } from "./types";
import type { Connection, LogEntry } from "./types";

export interface LogExport {
  name: string;
  count: number;
  scope: string;
  text: string;
}

const oneLine = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");

export function logFilename(value: string): string {
  const stem = value.trim().replace(/\.log$/i, "");
  if (
    !stem ||
    stem.length > 80 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(stem) ||
    /[. ]$/.test(stem) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
  ) {
    throw new Error(
      "请输入有效文件名（最多 80 个字符，不能包含路径或特殊符号）",
    );
  }
  return `${stem}.log`;
}

export function createLogExport(
  logs: LogEntry[],
  connection: Connection,
  scope: string,
  date = new Date(),
): LogExport {
  const lines = [
    "果蝇1号 · DF-01 通信日志",
    `导出时间：${date.toISOString()}`,
    "时间格式：UTC（ISO 8601） · 编码：UTF-8",
    `设备：${connection.simulation ? "模拟设备" : "串口设备"} · ${oneLine(connection.port || "未连接")} · ${connection.baudRate} baud · ID ${connection.address.toString(16).padStart(2, "0").toUpperCase()}`,
    `筛选范围：${oneLine(scope)}`,
    `记录数：${logs.length}`,
    "敏感数据已隐藏；内容为打开导出窗口时的记录快照。",
    "",
  ];
  for (const log of logs) {
    const command =
      log.command === null
        ? "会话事件"
        : `${log.command.toString(16).padStart(2, "0").toUpperCase()} ${COMMAND_NAMES[log.command & 0x7f] ?? "设备上报"}`;
    lines.push(
      `[${new Date(log.timestamp).toISOString()}] [${log.direction === "system" ? "SYS" : log.direction.toUpperCase()}] [${log.level.toUpperCase()}] [${command}] ${oneLine(log.message)}`,
    );
    if (log.hex) lines.push(`  HEX: ${oneLine(log.hex)}`);
  }
  return {
    name: `df01-logs-${date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`,
    count: logs.length,
    scope,
    text: `${lines.join("\r\n")}\r\n`,
  };
}

export async function logExportDirectory(): Promise<string> {
  return isDesktop
    ? invoke<string>("log_export_directory")
    : "浏览器设置的下载目录";
}

export async function saveLogExport(
  name: string,
  text: string,
): Promise<string | null> {
  const filename = logFilename(name);
  if (isDesktop)
    return invoke<string>("save_log_export", { filename, content: text });
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return null;
}
