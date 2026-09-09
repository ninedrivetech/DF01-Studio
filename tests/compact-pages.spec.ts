import { expect, test, type Page } from "@playwright/test";

async function firstScreen(page: Page) {
  const geometry = await page.locator("main").evaluate((main) => {
    const hidden = [
      ...main.querySelectorAll<HTMLElement>("button, input, select, textarea"),
    ]
      .filter(
        (element) =>
          element.getClientRects().length && !element.closest(".byte-readings"),
      )
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.top < 0 ||
          bounds.bottom > innerHeight + 1 ||
          bounds.left < 0 ||
          bounds.right > innerWidth + 1
        );
      })
      .map(
        (element) => element.getAttribute("aria-label") || element.textContent,
      );
    return { extraHeight: main.scrollHeight - main.clientHeight, hidden };
  });
  expect(geometry).toEqual({ extraHeight: 0, hidden: [] });
}

for (const viewport of [
  { width: 1280, height: 820 },
  { width: 900, height: 640 },
]) {
  test(`appearance and complete memory tools fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "主导航" });
    await nav.getByRole("button", { name: "外观设置", exact: true }).click();
    for (const density of ["舒适", "紧凑"]) {
      await page.getByRole("button", { name: density, exact: true }).click();
      for (const theme of ["琥珀标本", "夜航观测", "苔原微光", "高对比"]) {
        await page.getByRole("button", { name: theme, exact: true }).click();
        await firstScreen(page);
        await expect(page.locator(".about-band")).toBeInViewport({ ratio: 1 });
      }
    }
    await page.screenshot({
      path: info.outputPath("appearance-first-screen.png"),
    });
    await page.getByRole("button", { name: "琥珀标本", exact: true }).click();
    await nav.getByRole("button", { name: "数据块", exact: true }).click();
    await firstScreen(page);
    await expect(
      page.getByRole("button", { name: "选择块 63", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "编码输入", exact: true }).click();
    await firstScreen(page);
    await page.getByRole("button", { name: "HEX", exact: true }).click();
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "断开连接", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "读取扇区", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "读取块", exact: true }),
    ).toBeEnabled();
    await firstScreen(page);
    await page.screenshot({ path: info.outputPath("memory-first-screen.png") });
    await page.getByRole("button", { name: "编码输入", exact: true }).click();
    await firstScreen(page);
    await page.screenshot({
      path: info.outputPath("memory-composer-first-screen.png"),
    });
    await page
      .getByRole("button", { name: "分页卡 / 连续读取", exact: true })
      .click();
    await firstScreen(page);
    await page.getByRole("button", { name: "读取连续页", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("连续页读取成功");
    await firstScreen(page);
  });
}

test("maximum gain reveals a dismissible white-eyed fly without saving hardware settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(page.locator(".rf-control")).toContainText("已保存 33 dB");
  const slider = page.getByRole("slider", {
    name: "工作台天线增益",
    exact: true,
  });
  await slider.focus();
  await slider.press("End");
  await expect(page.locator(".gain-easter-egg")).toHaveText(
    "白眼果蝇抖擞精神！",
  );
  await expect(slider).toBeFocused();
  await expect(page.locator(".rf-control")).toContainText("已保存 33 dB");
  await page.getByRole("button", { name: "关闭彩蛋" }).click();
  await expect(page.locator(".gain-easter-egg")).toHaveCount(0);
  await slider.focus();
  await slider.press("ArrowLeft");
  await slider.press("End");
  await expect(
    page.getByRole("img", { name: "白眼果蝇", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".gain-easter-egg")).toHaveCount(0, {
    timeout: 5500,
  });
  await page.getByRole("button", { name: "设备配置", exact: true }).click();
  const deviceSlider = page.getByRole("slider", {
    name: "天线增益",
    exact: true,
  });
  await deviceSlider.focus();
  await deviceSlider.press("Home");
  await deviceSlider.press("End");
  await expect(page.locator(".gain-easter-egg")).toBeVisible();
});
