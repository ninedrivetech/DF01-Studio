import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startGainEffects } from "./gain-effects";

const mocks = vi.hoisted(() => ({
  native: true,
  appWindow: {
    isMaximized: vi.fn(),
    isFullscreen: vi.fn(),
    scaleFactor: vi.fn(),
    outerPosition: vi.fn(),
    setPosition: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks.appWindow,
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
let dataset: { motion: string };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.native = true;
  mocks.appWindow.isMaximized.mockResolvedValue(false);
  mocks.appWindow.isFullscreen.mockResolvedValue(false);
  mocks.appWindow.scaleFactor.mockResolvedValue(1.5);
  mocks.appWindow.outerPosition.mockResolvedValue({ x: -1200, y: 180 });
  mocks.appWindow.setPosition.mockResolvedValue(undefined);
  dataset = { motion: "full" };
  vi.stubGlobal("document", {
    documentElement: { dataset },
    getElementById: () => ({ animate }),
  });
  vi.stubGlobal("window", {
    setTimeout,
    matchMedia: () => ({ matches: true }),
  });
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shakes the native window using physical pixels and restores a negative-monitor origin", async () => {
  const stop = startGainEffects();
  await vi.runAllTimersAsync();
  expect(mocks.appWindow.setPosition).toHaveBeenCalledWith({
    x: -1212,
    y: 185,
  });
  expect(mocks.appWindow.setPosition).toHaveBeenLastCalledWith({
    x: -1200,
    y: 180,
  });
  expect(animate).not.toHaveBeenCalled();
  stop();
});

it("restores before a rapidly retriggered shake reads its origin", async () => {
  const stop = startGainEffects();
  await vi.advanceTimersByTimeAsync(60);
  stop();
  const stopNext = startGainEffects();
  mocks.appWindow.outerPosition.mockImplementation(async () => {
    expect(mocks.appWindow.setPosition).toHaveBeenLastCalledWith({
      x: -1200,
      y: 180,
    });
    return { x: -1200, y: 180 };
  });
  await vi.runAllTimersAsync();
  expect(mocks.appWindow.outerPosition).toHaveBeenCalledTimes(2);
  stopNext();
});

it("restores the window if dismissed during a shake", async () => {
  const stop = startGainEffects();
  await vi.advanceTimersByTimeAsync(60);
  stop();
  await vi.runAllTimersAsync();
  expect(mocks.appWindow.setPosition).toHaveBeenLastCalledWith({
    x: -1200,
    y: 180,
  });
  expect(mocks.appWindow.setPosition.mock.calls.length).toBeLessThan(11);
});

it.each(["maximized", "fullscreen", "browser"])(
  "shakes the entire content for %s",
  async (mode) => {
    mocks.native = mode !== "browser";
    mocks.appWindow.isMaximized.mockResolvedValue(mode === "maximized");
    mocks.appWindow.isFullscreen.mockResolvedValue(mode === "fullscreen");
    const stop = startGainEffects();
    await vi.runAllTimersAsync();
    expect(animate).toHaveBeenCalledOnce();
    expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
    stop();
    expect(cancel).toHaveBeenCalledOnce();
  },
);

it.each(["system", "reduced"])("respects %s reduced motion", async (motion) => {
  dataset.motion = motion;
  const stop = startGainEffects();
  await vi.runAllTimersAsync();
  expect(animate).not.toHaveBeenCalled();
  expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
  stop();
});

it("falls back to content motion and restores after a native move fails", async () => {
  mocks.appWindow.setPosition.mockRejectedValueOnce(new Error("move failed"));
  const stop = startGainEffects();
  await vi.runAllTimersAsync();
  expect(animate).toHaveBeenCalledOnce();
  expect(mocks.appWindow.setPosition).toHaveBeenLastCalledWith({
    x: -1200,
    y: 180,
  });
  stop();
});
