import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 820 },
  { width: 900, height: 640 },
  { width: 1920, height: 1080 },
]) {
  test(`settings and logs share panels; appearance fills ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "主导航" });
    for (const [name, selector] of [
      ["密钥管理", ".keys-page"],
      ["设备配置", ".device-page"],
      ["通信日志", ".logs-page"],
      ["外观设置", ".appearance-page"],
    ]) {
      await nav.getByRole("button", { name, exact: true }).click();
      await expect(
        page.locator(`${selector} .tool-panel`).first(),
      ).toBeVisible();
      const geometry = await page.locator("main").evaluate((main) => {
        const bounds = main.getBoundingClientRect();
        return {
          overflow: main.scrollHeight - main.clientHeight,
          clipped: [
            ...main.querySelectorAll<HTMLElement>("button, input, select"),
          ]
            .filter((element) => {
              if (!element.getClientRects().length) return false;
              const box = element.getBoundingClientRect();
              return (
                box.right > bounds.right + 1 ||
                box.left < bounds.left - 1 ||
                box.bottom > innerHeight + 1
              );
            })
            .map(
              (element) =>
                element.getAttribute("aria-label") || element.textContent,
            ),
        };
      });
      expect(geometry).toEqual({ overflow: 0, clipped: [] });
      if (name === "外观设置") {
        const space = await page
          .locator(".appearance-themes")
          .evaluate((themes) => {
            const content = themes.parentElement!.getBoundingClientRect();
            const about = document
              .querySelector(".about-band")!
              .getBoundingClientRect();
            return {
              bottomGap: innerHeight - about.bottom,
              coverage: themes.getBoundingClientRect().height / content.height,
            };
          });
        expect(space.bottomGap).toBeLessThanOrEqual(16);
        expect(space.coverage).toBeGreaterThan(0.5);
        const titleRows = await page
          .locator(".theme-name")
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().top),
          );
        expect(Math.abs(titleRows[0] - titleRows[1])).toBeLessThanOrEqual(1);
        expect(Math.abs(titleRows[2] - titleRows[3])).toBeLessThanOrEqual(1);
      }
      await page.screenshot({
        path: info.outputPath(`${selector.slice(1)}.png`),
      });
    }
  });
}

test("unified settings retain key loading, independent device saves, and log controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(page.locator(".rf-control")).toContainText("已保存 33 dB");
  const nav = page.getByRole("navigation", { name: "主导航" });
  await nav.getByRole("button", { name: "密钥管理", exact: true }).click();
  await page.getByLabel("Key A", { exact: true }).fill("FF FF FF FF FF FF");
  await page.getByRole("button", { name: "装载密钥", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认执行", exact: true })
    .click();
  await expect(page.getByLabel("Key A", { exact: true })).toHaveValue("");
  await nav.getByRole("button", { name: "设备配置", exact: true }).click();
  await page.getByLabel("防重读时长", { exact: true }).fill("500");
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.locator(".saved-configuration")).toContainText("500 ms");
  await nav.getByRole("button", { name: "通信日志", exact: true }).click();
  await expect(page.locator(".log-table tbody tr").first()).toBeVisible();
  await page.getByLabel("日志筛选").selectOption("tx");
  await expect(page.locator(".log-table tbody .direction").first()).toHaveText(
    "TX",
  );
  await page.getByRole("button", { name: "暂停日志显示", exact: true }).click();
  await expect(page.locator(".logs-panel .section-meta")).toContainText(
    "显示已暂停",
  );
  await page.getByRole("button", { name: "恢复日志显示", exact: true }).click();
  await page.getByLabel("搜索日志").fill("no-matching-frame");
  await expect(page.getByText("暂无通信记录", { exact: true })).toBeVisible();
});

test("settings stay usable on a narrow screen", async ({ page }) => {
  await page.goto("/");
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ["密钥管理", "设备配置", "通信日志", "外观设置"]) {
      const menu = page.getByRole("button", { name: "打开导航", exact: true });
      if (await menu.isVisible()) await menu.click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name, exact: true })
        .click();
      expect(
        await page
          .locator("main")
          .evaluate((main) => main.scrollWidth - main.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("all themes and densities preserve the compact panel layout", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主导航" });
  for (const theme of ["夜航观测", "苔原微光", "高对比", "琥珀标本"]) {
    for (const density of ["舒适", "紧凑"]) {
      await nav.getByRole("button", { name: "外观设置", exact: true }).click();
      await page.getByRole("button", { name: theme, exact: true }).click();
      await page.getByRole("button", { name: density, exact: true }).click();
      for (const name of ["外观设置", "密钥管理", "设备配置", "通信日志"]) {
        await nav.getByRole("button", { name, exact: true }).click();
        expect(
          await page
            .locator("main")
            .evaluate((main) => main.scrollHeight - main.clientHeight),
          `${theme} / ${density} / ${name}`,
        ).toBe(0);
        await expect(page.locator(".tool-panel").first()).toHaveCSS(
          "border-radius",
          "8px",
        );
        if (theme === "夜航观测" && density === "紧凑") {
          await page.screenshot({ path: info.outputPath(`${name}-night.png`) });
        }
      }
    }
  }
});
