import { expect, test } from "@playwright/test";
import { EMPTY_SNAPSHOT } from "../src/lib/types";

for (const viewport of [{ width: 900, height: 640 }, { width: 1280, height: 820 }]) {
  test(`cockroach controls fit the first screen at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByLabel("模拟产品", { exact: true }).selectOption("1");
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    const features = page.locator(".product-features");
    await expect(features).toBeVisible();
    await page.getByRole("button", { name: "关闭提示", exact: true }).click();
    await expect(page.locator(".product-transition")).toHaveCount(0);
    for (const english of [false, true]) {
      if (english) await page.getByRole("button", { name: "Switch to English", exact: true }).click();
      const controls = features.locator("input, select, button").filter({ visible: true });
      await expect(controls).toHaveCount(14);
      for (const control of await controls.all()) await expect(control).toBeInViewport({ ratio: 1 });
      expect(await page.locator("main").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/cockroach-${viewport.width}-${english ? "en" : "zh"}.png` });
    }
    await page.getByRole("button", { name: "切换到中文", exact: true }).click();
    const ramp = page.getByLabel("电机缓启动时间 (ms)", { exact: true });
    await ramp.fill("2300");
    const guideButton = page.getByRole("button", { name: "使用说明", exact: true });
    await guideButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(guideButton).toBeFocused();
    await guideButton.click();
    await page.getByRole("button", { name: "关闭说明", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(ramp).toHaveValue("2300");
  });
}

test("both products are selectable in the real browser simulator", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation");
  await page.getByLabel("模拟产品", {exact: true}).selectOption("1");
  await expect(navigation.getByRole("button", {name: "偷油婆扩展", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "连接设备", exact: true}).click();
  await expect(page.getByRole("heading", {name: "偷油婆扩展", exact: true})).toBeVisible();
  await page.getByLabel("初始占空比 (%)", {exact: true}).fill("75");
  await page.getByRole("button", {name: "保存初始占空比", exact: true}).click();
  await page.getByRole("button", {name: "读取配置", exact: true}).click();
  await expect(page.getByLabel("初始占空比 (%)", {exact: true})).toHaveValue("75");
  await page.getByLabel("电机缓启动时间 (ms)", {exact: true}).fill("10000");
  await page.getByLabel("系统启动延时 (ms)", {exact: true}).fill("600");
  await page.getByRole("button", {name: "保存启动时序", exact: true}).click();
  await expect(page.getByText("已保存时序 · 600 ms → 10000 ms")).toBeVisible();
  await page.getByRole("button", {name: "读取配置", exact: true}).click();
  await expect(page.getByLabel("电机缓启动时间 (ms)", {exact: true})).toHaveValue("10000");
  await page.getByRole("button", {name: "关闭语音自动读取", exact: true}).click();
  await expect(page.getByText("语音模式未开启", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "断开连接", exact: true}).click();
  await page.getByLabel("模拟产品", {exact: true}).selectOption("0");
  await page.getByRole("button", {name: "连接设备", exact: true}).click();
  await expect(page.locator(".brand-copy strong")).toHaveText("果蝇1号");
  await expect(navigation.getByRole("button", {name: "偷油婆扩展", exact: true})).toHaveCount(0);
  await expect(navigation.getByRole("button", {name: "语音与时序", exact: true})).toHaveCount(0);
  await expect(page.locator(".product-features")).toHaveCount(0);
  await expect(page.getByRole("heading", {name: "读卡工作台", exact: true})).toBeVisible();
});

test("product readback reveals features, saves settings, and switches back", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript((snapshot) => {
    const state = {
      snapshot,
      requests: [] as { command: number; parameters: number[] }[],
      fail: false,
    };
    Object.assign(window, {
      isTauri: true,
      productTest: state,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: () => 1,
        async invoke(
          command: string,
          args: { request?: { command: number; parameters: number[] } },
        ) {
          if (command === "get_snapshot")
            return structuredClone(state.snapshot);
          if (command === "list_ports") return [];
          if (command.startsWith("plugin:")) return false;
          if (command === "execute_command") {
            const req = args.request!;
            state.requests.push(req);
            if (state.fail)
              return {
                command: req.command,
                status: 254,
                data: [254],
                message: "保存失败",
                card: null,
              };
            const c = state.snapshot.configuration!;
            if (req.command === 0x2e) {
              c.autoMode = req.parameters[0];
              c.autoBlock = req.parameters[2];
              c.autoInitialValue = req.parameters.slice(3, 7);
              state.snapshot.autoMode = c.autoMode;
            }
            if (req.command === 0x32) {
              c.rampMs = req.parameters[0] + req.parameters[1] * 256;
              c.startupDelayMs = req.parameters[2] + req.parameters[3] * 256;
            }
            return {
              command: req.command,
              status: 0,
              data: [0, ...req.parameters],
              message: "成功",
              card: null,
            };
          }
          return null;
        },
      },
    });
  }, structuredClone(EMPTY_SNAPSHOT));
  await page.goto("/");
  const navigation = page.getByRole("navigation");
  await expect(
    navigation.getByRole("button", { name: "偷油婆扩展" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const state = (window as any).productTest;
    state.snapshot.connection.connected = true;
    state.snapshot.configuration = {
      moduleId: 0,
      baudRate: 115200,
      autoMode: 3,
      autoBlock: 4,
      autoInitialValue: [1, 0, 9, 8],
      keyA: Array(6).fill(255),
      keyB: Array(6).fill(255),
      resetMs: 0,
      antennaGain: 7,
      productMode: 0,
      rampMs: 1000,
      startupDelayMs: 200,
    };
  });
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-product",
    "fruitfly",
  );
  await expect(
    navigation.getByRole("button", { name: "偷油婆扩展" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).productTest.snapshot.configuration.productMode = 1;
  });
  await expect(
    page.getByRole("heading", { name: "偷油婆扩展", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".product-transition")).toHaveText(
    "已切换至偷油婆一号",
  );
  await expect(page.locator(".brand-copy strong")).toHaveText("偷油婆一号");
  const forward = page.getByRole("radio", {name: "正转", exact: true});
  const reverse = page.getByRole("radio", {name: "反转", exact: true});
  await expect(forward).not.toBeChecked();
  await expect(reverse).not.toBeChecked();
  await forward.check();
  await expect(forward).toBeChecked();
  await forward.focus();
  await page.keyboard.press("ArrowRight");
  await expect(reverse).toBeChecked();
  await expect(page.getByText("仅本页预选，不控制电机；通信协议待接入。", {exact: true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).productTest.requests)).toEqual([]);
  await page.getByLabel("文本编码", { exact: true }).selectOption("5");
  await page
    .getByLabel("等待本条播报完成再发送下一条", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "保存并开启语音", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).productTest.requests.at(-1)),
    )
    .toEqual({ command: 46, parameters: [3, 13, 4, 5, 1, 9, 8, 35, 18, 84] });
  await page.getByLabel("电机缓启动时间 (ms)", { exact: true }).fill("2000");
  await page.getByLabel("系统启动延时 (ms)", { exact: true }).fill("500");
  await page.getByRole("button", { name: "保存启动时序", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).productTest.requests.at(-1)),
    )
    .toEqual({ command: 50, parameters: [208, 7, 244, 1] });
  await expect(page.getByText("已保存时序 · 500 ms → 2000 ms")).toBeVisible();
  await page.evaluate(() => {
    (window as any).productTest.fail = true;
  });
  await page.getByLabel("电机缓启动时间 (ms)", { exact: true }).fill("2500");
  await page.getByRole("button", { name: "保存启动时序", exact: true }).click();
  await expect(page.getByText("已保存时序 · 500 ms → 2000 ms")).toBeVisible();
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await page.getByRole("button", { name: "Switch to English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cockroach Features", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "TTS Voice Playback", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", {name: "Reverse", exact: true})).toBeChecked();
  await page.getByRole("button", { name: "切换到中文", exact: true }).click();
  await page.screenshot({
    path: "test-results/product-features-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/product-features-mobile.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    (window as any).productTest.snapshot.configuration.productMode = 0;
  });
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-product",
    "fruitfly",
  );
  await expect(
    navigation.getByRole("button", { name: "偷油婆扩展" }),
  ).toHaveCount(0);
  await expect(page.locator(".product-features")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "读卡工作台", exact: true }),
  ).toBeVisible();
});
