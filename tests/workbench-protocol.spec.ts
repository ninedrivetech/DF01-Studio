import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".traffic-stream")).toContainText("7F 03 00 31 32");
}

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("connection synchronizes configuration, module reports without host polling, and live stream can pause and filter", async ({
  page,
}) => {
  await connect(page);
  await expect(page.getByLabel("工作台自动模式")).toHaveValue("0");
  await expect
    .poll(() => page.locator(".traffic-counter.rx strong").textContent())
    .not.toBe("0");
  const txBefore = await page
    .locator(".traffic-counter.tx strong")
    .textContent();
  await page.waitForTimeout(1600);
  await expect(page.locator(".traffic-counter.tx strong")).toHaveText(
    txBefore!,
  );
  await expect(page.getByText(/桌面版|手机版|桌面应用|浏览器预览/)).toHaveCount(
    0,
  );
  await expect(page.getByLabel("轮询间隔")).toHaveCount(0);
  await page.getByRole("button", { name: "暂停实时通信", exact: true }).click();
  const count = await page.locator(".traffic-row").count();
  const received = Number(
    await page.locator(".traffic-counter.rx strong").textContent(),
  );
  await page.getByRole("button", { name: "换一张卡", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.locator(".traffic-counter.rx strong").textContent()),
    )
    .toBeGreaterThan(received);
  await expect(page.locator(".traffic-row")).toHaveCount(count);
  await page.getByRole("button", { name: "恢复实时通信", exact: true }).click();
  await expect
    .poll(() => page.locator(".traffic-row").count())
    .toBeGreaterThan(count);
  await page.getByLabel("实时通信筛选").selectOption("tx");
  await expect(page.locator(".traffic-row.rx")).toHaveCount(0);
  await page.getByLabel("搜索实时通信").fill("7F 03 00 31 32");
  await expect(page.locator(".traffic-row")).toHaveCount(1);
  await page.locator(".traffic-row").click();
  await expect(page.getByLabel("选中报文", { exact: true })).toContainText(
    "7F 03 00 31 32",
  );
});

test("new configuration controls persist acknowledged values and reject invalid reset duration", async ({
  page,
}) => {
  await connect(page);
  await navigate(page, "设备配置");
  await expect(page.getByText("新波特率", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("固件配置")).toHaveCount(0);
  await page.getByLabel("防重读时长").fill("50");
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("100–3000");
  await page.getByLabel("防重读时长").fill("1000");
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("设置防重读时长成功");
  await page.getByRole("slider", { name: "天线增益" }).fill("7");
  await page.getByRole("button", { name: "保存增益", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("设置天线增益成功");
  await page.getByLabel("新地址", { exact: true }).fill("127");
  const addressRow = page.locator(".setting-row").filter({
    has: page.getByRole("heading", { name: "模块地址", exact: true }),
  });
  await addressRow.getByRole("button", { name: "应用", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认执行" })
    .click();
  await expect(page.getByLabel("连接地址")).toHaveValue("127");
  await page.getByRole("button", { name: "读取配置", exact: true }).click();
  await expect(page.locator(".saved-configuration")).toContainText("0x7F");
  await expect(page.locator(".saved-configuration")).toContainText("1000 ms");
  await expect(page.locator(".saved-configuration")).toContainText("48 dB");
  await navigate(page, "通信日志");
  await expect(page.locator(".log-table")).toContainText(
    "7F 05 00 2F E8 03 C1",
  );
  await expect(page.locator(".log-table")).toContainText("7F 04 00 30 07 33");
  await expect(page.locator(".log-table")).toContainText(
    "7F 04 7F 7F AD 00 D6",
  );
  await expect(page.locator(".log-table")).not.toContainText(
    "FF FF FF FF FF FF",
  );
});

test("manual block reads stop automatic block reporting and ignore unsaved mode drafts", async ({
  page,
}) => {
  await connect(page);
  await navigate(page, "设备配置");
  await page.getByLabel("自动模式", { exact: true }).selectOption("2");
  await page.getByLabel("自动读取块号").fill("3");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认执行" })
    .click();
  await expect(page.getByRole("status")).toContainText("设置自动方式成功");
  await page.getByLabel("自动读取块号").fill("99");
  await navigate(page, "数据块");
  await page.getByRole("button", { name: "读取块", exact: true }).click();
  await expect(page.getByLabel("字节 0", { exact: true })).toHaveValue("44");
  await navigate(page, "设备配置");
  await expect(page.getByLabel("自动模式", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("自动读取块号")).toHaveValue("3");
  await navigate(page, "通信日志");
  await expect(page.locator(".log-table")).not.toContainText(
    "FF FF FF FF FF FF",
  );
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 900, height: 640 },
  { width: 375, height: 812 },
  { width: 844, height: 390 },
]) {
  test(`live communication occupies the first view at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await connect(page);
    const stream = page.locator(".traffic-stream");
    await expect(stream).toBeVisible();
    const geometry = await stream.boundingBox();
    // Compact diagnostics gives decoding more room in sub-desktop windows.
    expect(geometry!.width).toBeGreaterThan(viewport.width >= 900 ? 250 : 220);
    if (viewport.height >= 640 && viewport.width >= 900)
      expect(geometry!.y + 100).toBeLessThan(viewport.height);
    await expect(page.locator(".statusbar")).toHaveCount(0);
    const topbar = await page.locator(".topbar").boundingBox();
    expect(topbar!.y).toBe(0);
    expect(topbar!.width).toBeLessThanOrEqual(viewport.width);
    await expect(
      page.getByRole("button", { name: "断开连接", exact: true }),
    ).toBeVisible();
    const image = info.outputPath(`workbench-${viewport.width}.png`);
    await page.screenshot({ path: image, animations: "disabled" });
    await info.attach("workbench", { path: image, contentType: "image/png" });
  });
}
