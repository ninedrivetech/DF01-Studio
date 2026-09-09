import { describe, expect, it } from "vitest";
import { createLogExport, logFilename } from "./log-export";
import type { Connection, LogEntry } from "./types";

const connection: Connection = {
  connected: true,
  simulation: true,
  port: "DF-01 Simulator",
  baudRate: 115200,
  address: 0,
  profile: "current",
};
const logs: LogEntry[] = [
  {
    id: 1,
    timestamp: 0,
    direction: "tx",
    command: 49,
    hex: "7F 03 00 31 32",
    message: "读取配置",
    level: "info",
  },
  {
    id: 2,
    timestamp: 1,
    direction: "rx",
    command: 177,
    hex: "[密钥配置或控制块内容已隐藏]",
    message: "成功",
    level: "success",
  },
];
describe("plain text log export", () => {
  it("preserves timestamps, directions, command labels and redacted payloads", () => {
    const snapshot = logs.map((log) => ({ ...log }));
    const result = createLogExport(snapshot, connection, "全部记录", new Date(0));
    expect(result.text).toContain("记录数：2\r\n");
    expect(result.text).toContain(
      "[1970-01-01T00:00:00.000Z] [TX] [INFO] [31 读取全部配置]",
    );
    expect(result.text).toContain("HEX: [密钥配置或控制块内容已隐藏]");
    expect(result.text).not.toMatch(/(?<!\r)\n/);
    snapshot[0].message = "changed";
    expect(result.text).not.toContain("changed");
  });
  it("escapes embedded line breaks so messages cannot forge a record", () => {
    const result = createLogExport(
      [{ ...logs[0], message: "first\r\n[forged]\ttext" }],
      connection,
      "搜索：a\nb",
    );
    expect(result.text).toContain("first\\r\\n[forged]\\ttext");
    expect(result.text.match(/^\[/gm)).toHaveLength(1);
  });
  it("accepts a readable basename and rejects paths, devices and invalid characters", () => {
    expect(logFilename("设备记录")).toBe("设备记录.log");
    expect(logFilename("test.LOG")).toBe("test.log");
    for (const name of [
      "",
      "../file",
      "folder/file",
      "C:\\file",
      "aux",
      "CON.txt",
      "COM1",
      "file.",
      "a\nb",
      "a".repeat(81),
    ])
      expect(() => logFilename(name)).toThrow();
  });
});
