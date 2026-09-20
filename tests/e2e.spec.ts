import { readFile } from "node:fs/promises";
import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await use(errors);
      expect(errors, "Browser runtime and console errors").toEqual([]);
    },
    { auto: true },
  ],
});

const views = [
  ["overview", "读卡工作台"],
  ["memory", "数据块"],
  ["keys", "密钥管理"],
  ["device", "设备配置"],
  ["logs", "通信日志"],
  ["appearance", "外观设置"],
] as const;

async function navigate(page: Page, name: string) {
  const mobileMenu = page.getByRole("button", {
    name: "打开导航",
    exact: true,
  });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name, level: 1, exact: true }),
  ).toBeVisible();
}

async function connectSimulation(page: Page) {
  await page.getByLabel("连接方式", { exact: true }).selectOption("simulation");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".connection-badge")).toHaveText("模拟设备已连接");
}

async function confirmAction(page: Page, title: string | RegExp) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function readUid(page: Page) {
  await page.getByRole("button", { name: "读取卡号", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /已识别.*ABAF45E0/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "读取卡号", exact: true }),
  ).toBeEnabled();
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const candidates = [
      ...document.querySelectorAll<HTMLElement>(
        "main h1, main h2, main input, main select, main button, main .section",
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
          `${element.tagName} ${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 50)}`,
      );
    return {
      document: document.documentElement.scrollWidth - width,
      body: document.body.scrollWidth - width,
      candidates,
    };
  });
  expect(overflow.document, "Document horizontal overflow").toBeLessThanOrEqual(
    1,
  );
  expect(overflow.body, "Body horizontal overflow").toBeLessThanOrEqual(1);
  expect(
    overflow.candidates,
    "Visible controls extending outside the viewport",
  ).toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const noticeClose = page.getByRole("button", {
    name: "关闭提示",
    exact: true,
  });
  if (await noticeClose.isVisible()) await noticeClose.click();
  await assertNoHorizontalOverflow(page);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "读卡工作台", level: 1, exact: true }),
  ).toBeVisible();
});

test("simulation isolates a timed-out manual read and recovers after reconnecting", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "读取卡号", exact: true }),
  ).toBeDisabled();
  await connectSimulation(page);
  await readUid(page);
  await page
    .getByRole("switch", { name: "模拟卡片在场", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "读取卡号", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "读取卡号", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /等待读卡超时/,
  );
  await expect(
    page.getByRole("button", { name: "连接设备", exact: true }),
  ).toBeEnabled();
  await connectSimulation(page);
  await page.getByRole("switch", { name: "模拟卡片在场", exact: true }).check();
  await readUid(page);
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接设备", exact: true }),
  ).toBeVisible();
});

test("block write confirmation, readback and manufacturer block protection", async ({
  page,
}) => {
  await connectSimulation(page);
  await navigate(page, "数据块");
  await page.getByRole("button", { name: "读取块", exact: true }).click();
  await expect(page.getByLabel("字节 0", { exact: true })).toHaveValue("44");
  await page.getByLabel("字节 0", { exact: true }).fill("7F");
  await page.getByLabel("字节 1", { exact: true }).fill("AB");
  await page.getByLabel("字节 15", { exact: true }).fill("FF");
  await page.getByRole("button", { name: "写入块", exact: true }).click();
  await confirmAction(page, /写入块 1/);
  await expect(page.getByRole("status")).toContainText("写入数据块成功");
  await page.getByRole("button", { name: "填充零值", exact: true }).click();
  await expect(page.getByLabel("字节 0", { exact: true })).toHaveValue("00");
  await page.getByRole("button", { name: "读取块", exact: true }).click();
  await confirmAction(page, "替换当前编辑内容？");
  await expect(page.getByLabel("字节 0", { exact: true })).toHaveValue("7F");
  await expect(page.getByLabel("字节 1", { exact: true })).toHaveValue("AB");
  await expect(page.getByLabel("字节 15", { exact: true })).toHaveValue("FF");
  const expandMap = page.getByRole("button", {
    name: "展开存储映射",
    exact: true,
  });
  if (await expandMap.isVisible()) await expandMap.click();
  await page.getByRole("button", { name: "选择块 0", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "写入块", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("字节 0", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "读取块", exact: true }),
  ).toBeEnabled();
});

test("invalid key feedback occurs before sending and valid keys are cleared after loading", async ({
  page,
}) => {
  await connectSimulation(page);
  await navigate(page, "密钥管理");
  await page.getByLabel("Key A", { exact: true }).fill("FF FF");
  await page.getByRole("button", { name: "装载密钥", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("6 字节");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Key A", { exact: true }).fill("AB CD EF 01 02 03");
  await page.getByRole("button", { name: "装载密钥", exact: true }).click();
  await confirmAction(page, "装载模块密钥");
  await expect(page.getByRole("status")).toContainText("装载密钥成功");
  await expect(page.getByLabel("Key A", { exact: true })).toHaveValue("");
  await navigate(page, "通信日志");
  await expect(page.locator(".log-table")).not.toContainText(
    "AB CD EF 01 02 03",
  );
});

test("documented automatic modes can be selected and applied", async ({
  page,
}) => {
  await connectSimulation(page);
  await navigate(page, "设备配置");
  const modes = page.getByLabel("自动模式", { exact: true });
  await expect(modes.locator("option")).toHaveCount(3);
  for (const mode of ["0", "2", "1"]) {
    await modes.selectOption(mode);
    await page.getByRole("button", { name: "应用模式", exact: true }).click();
    await confirmAction(page, "设置自动方式");
    await expect(page.getByRole("status")).toContainText("设置自动方式成功");
    await expect(modes).toHaveValue(mode);
  }
  await navigate(page, "通信日志");
  await expect(page.locator(".log-table")).toContainText("7F 04 00 AE 00 AA");
});

test("page input supports the full protocol range and reports the S50 simulator limit accurately", async ({
  page,
}) => {
  await connectSimulation(page);
  await navigate(page, "数据块");
  await page
    .getByRole("button", { name: "分页卡 / 连续读取", exact: true })
    .click();
  await page.getByLabel("起始页", { exact: true }).fill("256");
  await page.getByRole("button", { name: "读取连续页", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("255");
  await page.getByLabel("起始页", { exact: true }).fill("255");
  await page.getByRole("button", { name: "读取连续页", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("等待读卡超时");
  await expect(page.getByText("尚未读取连续页", { exact: true })).toBeVisible();
  await navigate(page, "通信日志");
  await expect(page.locator(".log-table")).toContainText("7F 04 00 11 FF EA");
});

test("all four themes, density and motion persist after reload", async ({
  page,
}, testInfo) => {
  await navigate(page, "外观设置");
  for (const [name, id, daisyTheme] of [
    ["琥珀标本", "light", "corporate"],
    ["夜航观测", "graphite", "business"],
    ["苔原微光", "forest", "emerald"],
    ["高对比", "contrast", "black"],
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      daisyTheme,
    );
    await capture(page, testInfo, `theme-${id}`);
  }
  await page.getByRole("button", { name: "紧凑", exact: true }).click();
  await page.getByLabel("动态效果", { exact: true }).selectOption("reduced");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("df01.preferences") ?? "{}"),
      ),
    )
    .toMatchObject({
      theme: "contrast",
      density: "compact",
      motion: "reduced",
    });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "black");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});

test("log pause freezes display while acquisition continues, search filters and export contains selected records", async ({
  page,
}) => {
  await connectSimulation(page);
  await readUid(page);
  await navigate(page, "通信日志");
  const rows = page.locator(".log-table tbody tr");
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "暂停日志显示", exact: true }).click();
  await navigate(page, "读卡工作台");
  await readUid(page);
  await navigate(page, "通信日志");
  await expect(rows).toHaveCount(before);
  await page.getByRole("button", { name: "恢复日志显示", exact: true }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(before);
  await page.getByLabel("日志筛选", { exact: true }).selectOption("tx");
  await page.getByLabel("搜索日志", { exact: true }).fill("7F 03 00 10 13");
  await expect(rows).toHaveCount(2);
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出筛选日志", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "导出通信日志" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存日志", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/^df01-logs-.*\.log$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = await readFile(path!, "utf8");
  expect(exported).toContain("设备：模拟设备");
  expect(exported).toContain("记录数：2");
  expect(exported.match(/^\[.*\] \[TX\]/gm)).toHaveLength(2);
  expect(exported.match(/HEX: 7F 03 00 10 13/g)).toHaveLength(2);
  expect(exported).not.toContain("[RX]");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByLabel("搜索日志", { exact: true }).fill("NO-MATCH-EXAMPLE");
  await expect(page.getByText("暂无通信记录", { exact: true })).toBeVisible();
  await page.getByLabel("搜索日志", { exact: true }).fill("");
  await page.getByLabel("日志筛选", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "清空日志", exact: true }).click();
  await confirmAction(page, "清空通信日志");
  await expect(page.getByText("暂无通信记录", { exact: true })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`all six views remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await connectSimulation(page);
    await readUid(page);
    for (const [id, name] of views) {
      await navigate(page, name);
      await capture(page, testInfo, `${viewport.width}-${id}`);
    }
  });
}
