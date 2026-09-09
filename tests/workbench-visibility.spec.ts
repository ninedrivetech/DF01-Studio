import { expect, test } from "@playwright/test";

test("the entire application brand renders with one typeface", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".brand strong")).toHaveText("果蝇1号");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: ".brand strong",
    });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    await info.attach("rendered-brand-fonts", {
      body: JSON.stringify(fonts, null, 2),
      contentType: "application/json",
    });
    expect(fonts.filter((font) => font.glyphCount > 0)).toHaveLength(1);
    expect(fonts[0].glyphCount).toBe(4);
  } finally {
    await cdp.detach();
  }
});

for (const [width, height] of [
  [900, 640],
  [1280, 820],
  [375, 812],
  [844, 390],
]) {
  test(`traffic controls and report details remain unobstructed at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "应用模式", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("工作台自动模式").selectOption("2");
    await page.getByRole("button", { name: "应用模式", exact: true }).click();
    await expect(page.locator(".traffic-stream")).toContainText("自动上报");
    await page.locator(".traffic-workspace").scrollIntoViewIfNeeded();

    const bounds = await page
      .locator(".traffic-workspace")
      .evaluate((panel) => {
        const rect = (selector: string) =>
          panel.querySelector(selector)!.getBoundingClientRect().toJSON();
        return {
          panel: panel.getBoundingClientRect().toJSON(),
          toolbar: rect(".traffic-toolbar"),
          input: rect(".search-input input"),
          icon: rect(".search-input svg"),
          columns: rect(".traffic-columns"),
          stream: rect(".traffic-stream"),
          detail: rect(".traffic-detail"),
        };
      });
    await info.attach("traffic-bounds", {
      body: JSON.stringify(bounds, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("workbench.png"),
      fullPage: true,
    });
    expect(
      bounds.input.bottom,
      "search input must not cover column labels",
    ).toBeLessThanOrEqual(bounds.columns.top);
    expect(
      bounds.input.bottom,
      "toolbar must contain its input",
    ).toBeLessThanOrEqual(bounds.toolbar.bottom + 1);
    expect(
      Math.abs(
        (bounds.icon.top + bounds.icon.bottom) / 2 -
          (bounds.input.top + bounds.input.bottom) / 2,
      ),
      "search icon is vertically centered",
    ).toBeLessThanOrEqual(1);
    expect(bounds.stream.bottom).toBeLessThanOrEqual(bounds.detail.top + 1);
    expect(bounds.detail.bottom).toBeLessThanOrEqual(bounds.panel.bottom);
    expect(bounds.stream.height).toBeGreaterThanOrEqual(48);

    await page
      .getByRole("button", { name: "暂停实时通信", exact: true })
      .click();
    await page.locator(".traffic-row").first().click();
    await expect(
      page.getByRole("button", { name: "跟随最新", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "复制选中报文", exact: true })
      .click();
    await page.getByRole("button", { name: "跟随最新", exact: true }).click();
    await page
      .getByRole("button", { name: "恢复实时通信", exact: true })
      .click();
  });
}
