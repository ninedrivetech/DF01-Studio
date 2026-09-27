import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await use(errors);
      expect(errors, "Browser errors during accessibility checks").toEqual([]);
    },
    { auto: true },
  ],
});

const themes = [
  { name: "琥珀标本", theme: "corporate" },
  { name: "夜航观测", theme: "business" },
  { name: "苔原微光", theme: "emerald" },
  { name: "高对比", theme: "black" },
] as const;

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name, level: 1, exact: true }),
  ).toBeVisible();
}

async function renderedContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context unavailable");
    const lineage: Element[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    )
      lineage.unshift(current);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);
    const backgrounds: string[] = [];
    // Canvas resolves modern CSS colors to sRGB and composites transparent ancestors.
    for (const ancestor of lineage) {
      const style = getComputedStyle(ancestor);
      const zeroSizedDaisyNoise =
        style.backgroundImage.startsWith("none, url(") &&
        /^auto,\s*0(?:%|px)(?:\s+(?:auto|0(?:%|px)))?$/.test(
          style.backgroundSize,
        );
      if (style.backgroundImage !== "none" && !zeroSizedDaisyNoise)
        throw new Error(
          `Cannot reduce visible background image to a solid contrast color: ${ancestor.tagName}; image=${style.backgroundImage}; size=${style.backgroundSize}`,
        );
      if (Number(style.opacity) !== 1)
        throw new Error(`Unexpected ancestor opacity: ${style.opacity}`);
      backgrounds.push(style.backgroundColor);
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = Array.from(context.getImageData(0, 0, 1, 1).data).slice(
      0,
      3,
    );
    const style = getComputedStyle(element);
    context.fillStyle = style.color;
    context.fillRect(0, 0, 1, 1);
    const foreground = Array.from(context.getImageData(0, 0, 1, 1).data).slice(
      0,
      3,
    );
    const luminance = (rgb: number[]) =>
      rgb
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (total, value, index) =>
            total + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const a = luminance(foreground);
    const b = luminance(background);
    return {
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      foreground,
      background,
      cssColor: style.color,
      backgrounds,
      fontSize: Number.parseFloat(style.fontSize),
    };
  });
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const destination = testInfo.outputPath(name);
  await mkdir(path.dirname(destination), { recursive: true });
  await page.screenshot({
    path: destination,
    fullPage: false,
    animations: "disabled",
  });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
}

async function assertNoOverflow(page: Page) {
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const outside = [
      ...document.querySelectorAll<HTMLElement>(
        "main h1, main h2, main .section, main input, main select, main button",
      ),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          !element.getClientRects().length
        )
          return false;
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > width + 1;
      })
      .map(
        (element) =>
          `${element.tagName}: ${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40)}`,
      );
    const main = document.querySelector("main");
    return {
      overflow:
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) - width,
      verticalOverflow:
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        ) - window.innerHeight,
      outside,
      mainOverflow: main ? getComputedStyle(main).overflowY : null,
      mainBottom: main?.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(layout.overflow, "Horizontal page overflow").toBeLessThanOrEqual(1);
  expect(layout.outside, "Controls extending beyond the viewport").toEqual([]);
  expect(
    layout.verticalOverflow,
    `Document must remain within the viewport height: ${JSON.stringify(layout)}`,
  ).toBeLessThanOrEqual(0);
  expect(
    layout.mainOverflow,
    "Only the main workspace should scroll vertically",
  ).toMatch(/^(auto|scroll)$/);
  expect(
    layout.mainBottom,
    "Main workspace must not extend below the window",
  ).toBeLessThanOrEqual(layout.viewportHeight);
}

test("selected navigation text meets 4.5 contrast in every actual theme", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await navigate(page, "外观设置");
  const measurements = [];
  for (const { name, theme } of themes) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const selectedText = page.locator('.nav-item[aria-current="page"] > span');
    await expect(selectedText).toBeVisible();
    const measurement = await renderedContrast(selectedText);
    const primary = page.getByRole("button", { name: "连接设备", exact: true });
    await expect(primary).toBeEnabled();
    const primaryContrast = await renderedContrast(primary);
    measurements.push({
      theme,
      navigation: measurement,
      primary: primaryContrast,
    });
    expect
      .soft(
        measurement.ratio,
        `${name} navigation: ${JSON.stringify(measurement)}`,
      )
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(
        primaryContrast.ratio,
        `${name} primary button: ${JSON.stringify(primaryContrast)}`,
      )
      .toBeGreaterThanOrEqual(4.5);
    if (theme === "business")
      await saveScreenshot(page, testInfo, "theme-graphite-final.png");
  }
  const report = testInfo.outputPath("navigation-contrast.json");
  await writeFile(report, JSON.stringify(measurements, null, 2), "utf8");
  await testInfo.attach("navigation-contrast.json", {
    path: report,
    contentType: "application/json",
  });
});

test("mobile notification stays in one readable row within 100 pixels", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("连接方式", { exact: true }).selectOption("simulation");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  const notice = page.getByRole("status");
  await expect(notice).toContainText("模拟设备已连接");
  await expect(page.locator(".traffic-stream")).toContainText("7F 03 00 31 32");
  const geometry = await page.evaluate(() => {
    const inspect = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        class: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        height: style.height,
        minHeight: style.minHeight,
        overflow: style.overflow,
        position: style.position,
        flex: style.flex,
        inset: style.inset,
        transform: style.transform,
      };
    };
    const main = document.querySelector("main");
    const escaped = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const position = getComputedStyle(element).position;
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.bottom > innerHeight || rect.right > innerWidth) &&
          (!main?.contains(element) ||
            position === "fixed" ||
            position === "absolute")
        );
      })
      .slice(0, 12)
      .map(inspect);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      layers: [
        "html",
        "body",
        "#root",
        ".app-shell",
        ".workspace",
        "main",
        ".toast",
      ].map((selector) => ({
        selector,
        geometry: document.querySelector(selector)
          ? inspect(document.querySelector(selector)!)
          : null,
      })),
      escaped,
      toast: document.querySelector(".toast")?.outerHTML,
    };
  });
  const geometryReport = testInfo.outputPath("mobile-geometry.json");
  await writeFile(geometryReport, JSON.stringify(geometry, null, 2), "utf8");
  await testInfo.attach("mobile-geometry.json", {
    path: geometryReport,
    contentType: "application/json",
  });
  const layout = await notice.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const children = [...element.children].map((child) => {
      const box = child.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        center: (box.top + box.bottom) / 2,
      };
    });
    return {
      direction: style.flexDirection,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      children,
    };
  });
  expect(layout.direction).toBe("row");
  expect(layout.height).toBeLessThanOrEqual(100);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(390);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(844);
  expect(
    Math.max(...layout.children.map((child) => child.center)) -
      Math.min(...layout.children.map((child) => child.center)),
  ).toBeLessThanOrEqual(2);
  for (let index = 1; index < layout.children.length; index++)
    expect(layout.children[index].left).toBeGreaterThanOrEqual(
      layout.children[index - 1].right,
    );
  const text = notice.locator("p");
  const contrast = await renderedContrast(text);
  expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  expect(contrast.fontSize).toBeGreaterThanOrEqual(12);
  const textFits = await text.evaluate(
    (element) =>
      element.scrollWidth <= element.clientWidth + 1 &&
      element.scrollHeight <= element.clientHeight + 1,
  );
  expect(textFits).toBe(true);
  await assertNoOverflow(page);
  await saveScreenshot(page, testInfo, "mobile-toast.png");
  await testInfo.attach("mobile-toast-measurements.json", {
    body: JSON.stringify({ layout, contrast }, null, 2),
    contentType: "application/json",
  });
});

for (const viewport of [
  { width: 1280, height: 820 },
  { width: 900, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`all views stay within a ${viewport.width} by ${viewport.height} viewport with internal scrolling`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page
      .getByLabel("连接方式", { exact: true })
      .selectOption("simulation");
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "断开连接", exact: true }),
    ).toBeVisible();
    for (const name of [
      "读卡工作台",
      "数据块",
      "密钥管理",
      "设备配置",
      "通信日志",
      "外观设置",
    ]) {
      await navigate(page, name);
      await assertNoOverflow(page);
    }
    const screenshot = testInfo.outputPath(
      `viewport-${viewport.width}x${viewport.height}.png`,
    );
    await page.screenshot({
      path: screenshot,
      fullPage: false,
      animations: "disabled",
    });
    await testInfo.attach("bounded-viewport", {
      path: screenshot,
      contentType: "image/png",
    });
    if (viewport.width === 1280)
      await saveScreenshot(page, testInfo, "appearance-compact.png");
    if (viewport.width === 390)
      await saveScreenshot(page, testInfo, "appearance-mobile.png");
  });
}

test("system and explicit reduced motion limit durations to 0.01 milliseconds", async ({
  page,
}) => {
  const assertDurations = async () => {
    for (const selector of [".page-content", ".nav-item.active", ".button"]) {
      const durations = await page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const milliseconds = (value: string) =>
            value
              .split(",")
              .map(
                (duration) =>
                  Number.parseFloat(duration) *
                  (duration.trim().endsWith("ms") ? 1 : 1000),
              );
          return {
            animation: milliseconds(style.animationDuration),
            transition: milliseconds(style.transitionDuration),
            scroll: style.scrollBehavior,
          };
        });
      for (const duration of [...durations.animation, ...durations.transition])
        expect(duration, `${selector} duration`).toBeCloseTo(0.01, 6);
      expect(durations.scroll).toBe("auto");
    }
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "system");
  await assertDurations();
  await navigate(page, "外观设置");
  await page.getByLabel("动态效果", { exact: true }).selectOption("reduced");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await assertDurations();
});
