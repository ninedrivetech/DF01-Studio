import { expect, test } from "@playwright/test";

for (const [theme, width, height] of [
  ["light", 900, 640],
  ["forest", 1280, 820],
  ["graphite", 375, 812],
  ["contrast", 844, 390],
] as const) {
  test(`log export dialog follows ${theme} at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "df01.preferences",
          JSON.stringify({ theme, motion: "reduced" }),
        ),
      theme,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "应用模式", exact: true }),
    ).toBeEnabled();
    const menu = page.getByRole("button", { name: "打开导航", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "通信日志", exact: true })
      .click();
    const trigger = page.getByRole("button", {
      name: "导出筛选日志",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "导出通信日志",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const surface = await page
      .locator(".logs-panel")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(dialog).toHaveCSS("background-color", surface);
    await expect(page.getByLabel("文件名", { exact: true })).toBeFocused();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "保存日志", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("log-export.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test("invalid names stay in the dialog and cancelling creates no download", async ({
  page,
}) => {
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.goto("/");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用模式", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "通信日志", exact: true }).click();
  await page.getByRole("button", { name: "导出筛选日志", exact: true }).click();
  await page.getByLabel("文件名", { exact: true }).fill("../invalid");
  await page.getByRole("button", { name: "保存日志", exact: true }).click();
  await expect(
    page.locator(".log-export-dialog").getByRole("alert"),
  ).toContainText("有效文件名");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(downloads).toBe(0);
});
