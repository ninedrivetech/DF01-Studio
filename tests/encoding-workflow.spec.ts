import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

test.setTimeout(60_000);

async function openBlockEditor(page: Page, mode: "hex" | "text" = "text") {
  await page.goto("/");
  await page.getByLabel("连接方式", { exact: true }).selectOption("simulation");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("button", {
    name: "打开导航",
    exact: true,
  });
  if (await navigation.isVisible()) await navigation.click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "数据块", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "数据块", level: 1, exact: true }),
  ).toBeVisible();
  if (mode === "text") {
    await page.getByRole("button", { name: "编码输入", exact: true }).click();
    await expect(
      page.getByLabel("写入内容编码", { exact: true }),
    ).toBeVisible();
  }
}

async function expandMemoryMap(page: Page) {
  const expand = page.getByRole("button", {
    name: "展开存储映射",
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
  await expect(page.locator(".memory-map-panel")).toBeVisible();
}

async function assertMemoryGeometry(page: Page) {
  const layout = await page.locator("main.memory-page").evaluate((main) => {
    const width = document.documentElement.clientWidth;
    const mainRect = main.getBoundingClientRect();
    const controls = [
      ...main.querySelectorAll<HTMLElement>("input, select, textarea, button"),
    ]
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        name:
          element.getAttribute("aria-label") ??
          element.textContent?.trim().slice(0, 40) ??
          element.tagName,
      }))
      .filter(({ element, rect }) => {
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      });
    const outside = controls
      .filter(({ rect }) => rect.left < -1 || rect.right > width + 1)
      .map(({ name }) => name);
    const inView = controls.filter(
      ({ rect }) =>
        rect.bottom > mainRect.top &&
        rect.top < Math.min(mainRect.bottom, innerHeight),
    );
    const overlaps: string[] = [];
    for (let index = 0; index < inView.length; index++) {
      for (const other of inView.slice(index + 1)) {
        const current = inView[index];
        if (
          current.element.contains(other.element) ||
          other.element.contains(current.element)
        )
          continue;
        const overlapX =
          Math.min(current.rect.right, other.rect.right) -
          Math.max(current.rect.left, other.rect.left);
        const overlapY =
          Math.min(current.rect.bottom, other.rect.bottom) -
          Math.max(current.rect.top, other.rect.top);
        if (overlapX > 1 && overlapY > 1)
          overlaps.push(`${current.name} / ${other.name}`);
      }
    }
    return {
      documentOverflow:
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) - width,
      mainOverflow: main.scrollWidth - main.clientWidth,
      outside,
      overlaps,
    };
  });
  expect(
    layout.documentOverflow,
    "Memory page horizontal overflow",
  ).toBeLessThanOrEqual(1);
  expect(
    layout.mainOverflow,
    "Memory workspace horizontal overflow",
  ).toBeLessThanOrEqual(1);
  expect(layout.outside, "Memory controls outside the viewport").toEqual([]);
  expect(layout.overlaps, "Unexpected overlapping memory controls").toEqual([]);
}

async function assertMemoryFirstView(page: Page, height: number) {
  const editor = page.locator(".block-editor-column > .section").first();
  await expect(editor.getByRole("heading", { level: 2 })).toBeInViewport({
    ratio: 1,
  });
  await expect(
    editor.getByRole("button", { name: "读取块", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    editor.getByRole("button", { name: "写入块", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(editor.locator(".hex-editor input")).toHaveCount(16);
  if (height >= 640)
    await expect(editor.getByLabel("字节 0", { exact: true })).toBeInViewport({
      ratio: 1,
    });
  await expect(editor.locator(".byte-inspector .byte-grid")).toHaveCount(0);
  await assertMemoryGeometry(page);
}

async function captureMemoryFirstView(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    path: screenshot,
    fullPage: false,
    animations: "disabled",
  });
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" });
}

function reading(page: Page, label: string) {
  return page.locator(".byte-reading").filter({
    has: page
      .locator(".byte-reading-label")
      .filter({ hasText: new RegExp(`^${label}$`) }),
  });
}

test("GBK text writes the documented bytes and reads back through selectable encodings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBlockEditor(page);
  const composer = page.locator(".byte-composer");
  await page.getByLabel("写入内容编码").selectOption("gbk");
  await page.getByLabel("转换内容", { exact: true }).fill("优灵科技");
  await expect(composer.locator(".byte-composer-status")).toContainText(
    "8 / 16 字节",
  );
  await expect(composer.locator(".byte-composer-status")).toContainText(
    "补零 8 字节",
  );
  await expect(composer.locator(".byte-padding")).toHaveCount(8);
  await page.getByRole("button", { name: "应用到写入区", exact: true }).click();
  await expect(reading(page, "GBK")).toContainText("优灵科技");
  await expect(reading(page, "UTF-8")).toContainText("不是有效的 UTF-8");
  await expect(reading(page, "HEX")).toContainText(
    "D3 C5 C1 E9 BF C6 BC BC 00 00 00 00 00 00 00 00",
  );

  await page.getByRole("button", { name: "写入块", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: /写入块 1/ });
  await confirmation
    .getByRole("button", { name: "确认执行", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("写入数据块成功");
  await page.getByRole("button", { name: "填充零值", exact: true }).click();
  await expect(reading(page, "HEX")).toContainText(
    "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
  );
  await page.getByRole("button", { name: "读取块", exact: true }).click();
  const discard = page.getByRole("dialog", { name: /放弃|覆盖|替换/ });
  if (await discard.isVisible())
    await discard
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
  await expect(reading(page, "GBK")).toContainText("优灵科技");
  const inspector = page.locator(".byte-inspector");
  await inspector.getByLabel("GB18030", { exact: true }).check();
  await inspector.getByLabel("Base64", { exact: true }).check();
  await inspector.getByLabel("ASCII", { exact: true }).check();
  await expect(reading(page, "GB18030")).toContainText("优灵科技");
  await expect(reading(page, "Base64")).toContainText(
    "08XB6b/GvLwAAAAAAAAAAA==",
  );
  await expect(reading(page, "ASCII")).toContainText("超出 ASCII 范围");
  await inspector.getByLabel("隐藏尾部 NUL", { exact: true }).uncheck();
  await expect(reading(page, "GBK").locator("code")).toHaveText(
    "优灵科技\\0\\0\\0\\0\\0\\0\\0\\0",
  );
  expect(errors).toEqual([]);
});

test("conversion blocks overlong text, unrepresentable characters and malformed binary data", async ({
  page,
}) => {
  await openBlockEditor(page);
  const format = page.getByLabel("写入内容编码", { exact: true });
  const input = page.getByLabel("转换内容", { exact: true });
  const apply = page.getByRole("button", { name: "应用到写入区", exact: true });
  const status = page.locator(".byte-composer-status");
  await format.selectOption("utf-8");
  await input.fill("中".repeat(6));
  await expect(status).toContainText("18 字节");
  await expect(apply).toBeDisabled();
  await input.fill("\u{1f680}");
  await format.selectOption("gbk");
  await expect(status).toContainText("无法无损编码");
  await expect(apply).toBeDisabled();
  await format.selectOption("gb18030");
  await expect(status).toContainText("4 / 16 字节");
  await expect(apply).toBeEnabled();
  await page.getByRole("button", { name: "清空转换内容", exact: true }).click();
  await format.selectOption("hex");
  await input.fill("0x7F");
  await expect(status).toContainText("HEX 必须");
  await expect(apply).toBeDisabled();
  await input.fill("");
  await format.selectOption("base64");
  await input.fill("AB==");
  await expect(status).toContainText("Base64 填充位无效");
  await expect(apply).toBeDisabled();
});

test("unapplied encoding drafts survive view switches and cancelled overwrite actions", async ({
  page,
}) => {
  await openBlockEditor(page);
  await page.getByLabel("写入内容编码").selectOption("gbk");
  await page.getByLabel("转换内容", { exact: true }).fill("保留草稿");
  await page.getByRole("button", { name: "HEX", exact: true }).click();
  await page.getByRole("button", { name: "编码输入", exact: true }).click();
  await expect(page.getByLabel("转换内容", { exact: true })).toHaveValue(
    "保留草稿",
  );
  await expect(page.getByLabel("写入内容编码")).toHaveValue("gbk");
  await expandMemoryMap(page);
  await page.getByRole("button", { name: "选择块 2", exact: true }).click();
  const changeBlock = page.getByRole("dialog", { name: "放弃未写入的数据？" });
  await expect(changeBlock).toBeVisible();
  await changeBlock
    .getByRole("button", { name: "取消", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("转换内容", { exact: true })).toHaveValue(
    "保留草稿",
  );
  await expandMemoryMap(page);
  await expect(
    page.getByRole("button", { name: "选择块 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "读取块", exact: true }).click();
  const replace = page.getByRole("dialog", { name: "替换当前编辑内容？" });
  await expect(replace).toBeVisible();
  await replace
    .getByRole("button", { name: "取消", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("转换内容", { exact: true })).toHaveValue(
    "保留草稿",
  );
  await page.getByRole("button", { name: "写入块", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请先应用编码内容");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 900, height: 640 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`memory layout and encoding controls fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await openBlockEditor(page, "hex");
    const closeNotice = page.getByRole("button", {
      name: "关闭提示",
      exact: true,
    });
    if (await closeNotice.isVisible()) await closeNotice.click();
    await expect(page.locator("main")).toHaveClass(/memory-page/);
    await expect(page.locator(".memory-workspace")).toBeVisible();
    const narrowMap = viewport.width < 900 || viewport.height < 600;
    const panel = page.locator(".memory-map-panel");
    if (narrowMap) {
      await expect(panel).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "展开存储映射", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(panel).toBeVisible();
      await expect(
        panel.getByRole("button", { name: /^选择块 \d+$/ }),
      ).toHaveCount(64);
    }

    for (const theme of ["corporate", "business"]) {
      if (theme === "business") {
        await page
          .getByRole("button", { name: "切换到夜间主题", exact: true })
          .click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await assertMemoryFirstView(page, viewport.height);
      await captureMemoryFirstView(
        page,
        testInfo,
        `memory-${theme}-${viewport.width}x${viewport.height}`,
      );
      await expandMemoryMap(page);
      await expect(
        panel.getByRole("button", { name: /^选择块 \d+$/ }),
      ).toHaveCount(64);
      await assertMemoryGeometry(page);
      await panel
        .getByRole("button", { name: "选择块 2", exact: true })
        .click();
      await expect(
        page
          .locator(".block-editor-column")
          .getByRole("heading", { name: "块 02", exact: true }),
      ).toBeVisible();
      if (narrowMap) {
        await expect(panel).not.toBeVisible();
        await expect(
          page.getByRole("button", { name: "展开存储映射", exact: true }),
        ).toHaveAttribute("aria-expanded", "false");
      } else {
        await expect(
          panel.getByRole("button", { name: "选择块 2", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      }
      await assertMemoryFirstView(page, viewport.height);
      await expandMemoryMap(page);
      await expect(
        panel.getByRole("button", { name: "选择块 2", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await panel
        .getByRole("button", { name: "选择块 1", exact: true })
        .click();
      if (narrowMap) {
        await expandMemoryMap(page);
        await panel
          .getByRole("button", { name: "选择块 63", exact: true })
          .click();
        await expect(panel).not.toBeVisible();
        await expect(
          page
            .locator(".block-editor-column")
            .getByRole("heading", { name: "块 63", exact: true }),
          "Collapsing the scrolled memory map must reveal the selected block heading",
        ).toBeInViewport({ ratio: 1 });
        await expandMemoryMap(page);
        await expect(
          panel.getByRole("button", { name: "选择块 63", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await panel
          .getByRole("button", { name: "选择块 1", exact: true })
          .click();
        await expect(panel).not.toBeVisible();
        await expect(
          page
            .locator(".block-editor-column")
            .getByRole("heading", { name: "块 01", exact: true }),
        ).toBeInViewport({ ratio: 1 });
      }
    }

    await page.getByRole("button", { name: "编码输入", exact: true }).click();
    await expect(
      page.getByLabel("写入内容编码", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("写入内容编码").selectOption("gbk");
    await page.getByLabel("转换内容", { exact: true }).fill("优灵科技");
    const composer = page.locator(".byte-composer");
    await expect(composer.locator(".byte-cell")).toHaveCount(16);
    const geometry = await composer.evaluate((element) => {
      const root = element.getBoundingClientRect();
      const outside = [
        ...element.querySelectorAll("select, textarea, button, .byte-cell"),
      ].filter((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left < root.left - 1 || rect.right > root.right + 1;
      });
      return {
        left: root.left,
        right: root.right,
        viewport: innerWidth,
        overflow: element.scrollWidth - element.clientWidth,
        outside: outside.length,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.outside).toBe(0);
    if (await closeNotice.isVisible()) await closeNotice.click();
    const screenshot = testInfo.outputPath(`encoding-${viewport.width}.png`);
    await composer.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach("encoding-composer", {
      path: screenshot,
      contentType: "image/png",
    });
    await page
      .getByRole("button", { name: "应用到写入区", exact: true })
      .click();
    await expect(reading(page, "GBK")).toContainText("优灵科技");
    if (await closeNotice.isVisible()) await closeNotice.click();
    const inspector = page.locator(".byte-inspector");
    for (const format of [
      "GB18030",
      "ASCII",
      "UTF-16LE",
      "UTF-16BE",
      "Base64",
    ]) {
      await inspector.getByLabel(format, { exact: true }).check();
    }
    expect(
      await inspector.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const decodedScreenshot = testInfo.outputPath(
      `decoding-${viewport.width}.png`,
    );
    await inspector.screenshot({
      path: decodedScreenshot,
      animations: "disabled",
    });
    await testInfo.attach("encoding-inspector", {
      path: decodedScreenshot,
      contentType: "image/png",
    });
  });
}
