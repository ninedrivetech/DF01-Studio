import { describe, expect, it } from "vitest";
import { filterLogs } from "./log-filter";
import type { LogEntry } from "./types";

const logs: LogEntry[] = [
  {
    id: 1,
    timestamp: 0,
    direction: "rx",
    command: 0xb1,
    hex: "7F 24 00 B1",
    message: "读取全部配置成功",
    level: "success",
  },
  {
    id: 2,
    timestamp: 0,
    direction: "system",
    command: null,
    hex: "",
    message: "串口连接失败",
    level: "warning",
  },
];
describe("log search", () => {
  it("matches translated response labels and preserves the source entries", () => {
    const before = structuredClone(logs);
    expect(filterLogs(logs, "all", "  read all settings  ", "en")).toEqual([
      logs[0],
    ]);
    expect(logs).toEqual(before);
  });
  it("keeps raw protocol and Chinese messages searchable in English", () => {
    expect(filterLogs(logs, "rx", "7f 24", "en")).toEqual([logs[0]]);
    expect(filterLogs(logs, "all", "读取全部配置", "en")).toEqual([logs[0]]);
  });
  it("combines direction and warning filters with the query", () => {
    expect(filterLogs(logs, "error", "", "zh-CN")).toEqual([logs[1]]);
    expect(filterLogs(logs, "tx", "", "en")).toEqual([]);
    expect(filterLogs(logs, "all", "no such frame", "en")).toEqual([]);
  });
});
