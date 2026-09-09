import { expect, test } from "@playwright/test";

test("first-screen settings apply through the protocol and preserve independent drafts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "块数据解码", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".latest-data")).toContainText("等待接收");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用模式", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("工作台自动模式").selectOption("2");
  await page.getByLabel("工作台目标块").fill("1");
  await page.getByLabel("工作台防重读时长").fill("1001");
  const gain = page.getByRole("slider", {
    name: "工作台天线增益",
    exact: true,
  });
  await gain.focus();
  await gain.press("End");
  await page.getByRole("button", { name: "保存增益", exact: true }).click();
  await expect(page.locator(".rf-control")).toContainText("已保存 48 dB");
  await expect(page.getByLabel("工作台自动模式")).toHaveValue("2");
  await expect(page.getByLabel("工作台防重读时长")).toHaveValue("1001");
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.locator(".reset-control")).toContainText("已保存 1001 ms");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect(page.locator(".latest-data")).toContainText("DF-01 FRUITFLY");
  await expect(page.locator(".decode-heading")).toContainText("块 / 页 1");
  await page.getByRole("button", { name: "读取卡号", exact: true }).click();
  await expect(page.locator(".latest-data")).toContainText("DF-01 FRUITFLY");
  await page.getByRole("button", { name: "无限期", exact: true }).click();
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.locator(".reset-control")).toContainText("已保存 无限期");
  await page.getByLabel("工作台目标块").fill("3");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect(page.locator(".latest-data")).toContainText("敏感块内容已隐藏");
  await expect(page.locator(".latest-data .byte-inspector")).toHaveCount(0);
  await page.getByLabel("工作台目标块").fill("");
  await page.getByLabel("工作台自动模式").selectOption("1");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect(page.locator(".quick-mode .control-heading")).toContainText(
    "关闭自动读取",
  );
});

test("DF-01 branding and themed first-screen controls survive night mode", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  await expect(page).toHaveTitle("果蝇1号 · DF-01 工作台");
  await expect(page.locator(".brand")).toContainText("果蝇1号");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "应用模式", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("工作台自动模式").selectOption("2");
  await page.getByRole("button", { name: "应用模式", exact: true }).click();
  await expect(page.locator(".latest-data")).toContainText("DF-01 FRUITFLY");
  await page
    .getByRole("button", { name: "切换到夜间主题", exact: true })
    .click();
  const close = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await close.isVisible()) await close.click();
  const dimensions = await page
    .locator("main")
    .evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  for (const selector of [
    ".control-panel",
    ".traffic-workspace",
    ".latest-data",
  ]) {
    for (const element of await page.locator(selector).all()) {
      const box = await element.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(640);
      expect(box!.x + box!.width).toBeLessThanOrEqual(900);
    }
  }
  await page.screenshot({ path: info.outputPath("df01-night.png") });
  for (const name of [
    "读卡工作台",
    "数据块",
    "密钥管理",
    "设备配置",
    "通信日志",
    "外观设置",
  ]) {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator("body")).not.toContainText(
      /CV520|S50|Ultralight|NTAG/i,
    );
  }
});
