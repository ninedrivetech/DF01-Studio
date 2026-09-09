import { expect, test, type Page } from "@playwright/test";

async function voices(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { audioVoiceCount: number }).audioVoiceCount,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      audioVoiceCount: number;
      audioStopCount: number;
    };
    state.audioVoiceCount = 0;
    state.audioStopCount = 0;
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      createOscillator() {
        const oscillator = super.createOscillator();
        state.audioVoiceCount++;
        const stop = oscillator.stop.bind(oscillator);
        oscillator.stop = (when?: number) => {
          if (when === undefined) state.audioStopCount++;
          stop(when);
        };
        return oscillator;
      }
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(page.locator(".rf-control")).toContainText("已保存 33 dB");
});

test("automatic UID and block reports sound once, manual reads and repeat polling stay quiet", async ({
  page,
}) => {
  const initial = await voices(page);
  await page.getByLabel("工作台自动模式").selectOption("1");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect(page.locator(".quick-mode .control-heading")).toContainText(
    "关闭自动读取",
  );
  await page.getByRole("button", { name: "读取卡号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "读取卡号", exact: true }),
  ).toBeEnabled();
  expect(await voices(page)).toBe(initial);
  for (const mode of ["0", "2"]) {
    const before = await voices(page);
    await page.getByLabel("工作台自动模式").selectOption(mode);
    await page.getByRole("button", { name: "应用模式", exact: true }).click();
    await expect.poll(() => voices(page)).toBe(before + 1);
    // Observe several 450 ms snapshot polls to catch repeated notifications.
    await page.waitForTimeout(1400);
    expect(await voices(page)).toBe(before + 1);
  }
});

test("global mute stops active audio, silences reports and easter eggs, and survives reload", async ({
  page,
}) => {
  const gain = page.getByRole("slider", {
    name: "工作台天线增益",
    exact: true,
  });
  await gain.focus();
  await gain.press("End");
  await expect.poll(() => voices(page)).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "全局静音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消全局静音", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { audioStopCount: number }).audioStopCount,
    ),
  ).toBeGreaterThanOrEqual(3);
  const mutedVoices = await voices(page);
  await gain.focus();
  await gain.press("Home");
  await gain.press("End");
  await expect(page.locator(".gain-easter-egg")).toBeVisible();
  await page.getByLabel("工作台自动模式").selectOption("2");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect(page.locator(".latest-data")).toContainText("DF-01 FRUITFLY");
  expect(await voices(page)).toBe(mutedVoices);
  await page.getByRole("button", { name: "取消全局静音", exact: true }).click();
  await page.waitForTimeout(1000);
  expect(await voices(page)).toBe(mutedVoices);
  await page.getByLabel("工作台自动模式").selectOption("0");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect.poll(() => voices(page)).toBe(mutedVoices + 1);
  await page.getByRole("button", { name: "全局静音", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "取消全局静音", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await voices(page)).toBe(0);
});
