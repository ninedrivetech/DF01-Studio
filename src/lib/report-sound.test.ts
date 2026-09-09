import { expect, it } from "vitest";
import { createReportSoundTracker } from "./report-sound";
import type { LogEntry } from "./types";

const report = (id: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  id,
  timestamp: 1000,
  direction: "rx",
  command: 0x90,
  hex: "",
  message: "自动上报",
  level: "success",
  ...extra,
});

it("baselines existing history and never repeats a report during polling", () => {
  const fresh = createReportSoundTracker();
  expect(fresh([report(1)])).toBe(false);
  expect(fresh([report(1), report(2)])).toBe(true);
  expect(fresh([report(1), report(2)])).toBe(false);
});

it.each([0x90, 0x91])(
  "recognizes native successful automatic command %i",
  (command) => {
    const fresh = createReportSoundTracker();
    fresh([]);
    expect(
      fresh([report(1, { command, message: "主动上报 · 读取卡号：成功" })]),
    ).toBe(true);
  },
);

it("ignores manual responses, failures, transmit frames and unrelated commands", () => {
  const fresh = createReportSoundTracker();
  fresh([]);
  expect(
    fresh([
      report(1, { message: "读取卡号：成功" }),
      report(2, { level: "warning" }),
      report(3, { direction: "tx" }),
      report(4, { command: 0xb1 }),
    ]),
  ).toBe(false);
});

it("handles log clearing, stale snapshots and same-timestamp repeated reports", () => {
  const fresh = createReportSoundTracker();
  fresh([report(100)]);
  expect(fresh([])).toBe(false);
  expect(fresh([report(101), report(102)])).toBe(true);
  expect(fresh([report(100)])).toBe(false);
  expect(fresh([report(102)])).toBe(false);
  expect(fresh([report(103)])).toBe(true);
});

it("consumes muted history so unmuting cannot replay it", () => {
  const fresh = createReportSoundTracker();
  fresh([]);
  fresh([report(1)]);
  expect(fresh([report(1)])).toBe(false);
  expect(fresh([report(1), report(2)])).toBe(true);
});
