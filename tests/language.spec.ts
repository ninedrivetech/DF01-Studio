import { expect, test } from "@playwright/test";

test("connected English settings preserve author credit and reject invalid repeat delays", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("df01.language", "en"));
  await page.goto("/");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Device Settings", exact: true }).click();
  await expect(page.locator(".automatic-panel .tag")).toContainText("Auto card ID");
  await expect(page.locator(".radio-panel")).toContainText("Level 7");
  const duration = page.getByLabel("Repeat delay", { exact: true });
  await duration.fill("50");
  await duration.blur();
  await expect(duration).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".number-error")).toContainText("0 or 100–3000");
  await nav.getByRole("button", { name: "Communication Logs", exact: true }).click();
  await page.getByLabel("Search logs", { exact: true }).fill("Read all settings");
  await expect(page.locator(".log-table tbody tr").first()).toBeVisible();
  await nav.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".about-band")).toContainText("Mzee");
  await expect(page.locator(".about-band")).toContainText("xiemaths@outlook.com");
  await expect(page.locator(".author-credit [lang='zh-CN']")).toHaveText("上海玖驱科技有限公司");
});

test("topbar language switch preserves drafts and the active connection, and persists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("连接地址", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Reader Workbench", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Connection address", { exact: true }),
  ).toHaveValue("");
  await page.getByLabel("Connection address", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换到中文", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("连接地址", { exact: true })).toHaveValue("42");
  await page
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "切换到中文", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

for (const viewport of [
  { width: 1280, height: 820 },
  { width: 900, height: 640 },
]) {
  test(`English UI covers all pages at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("df01.language", "en"));
    await page.goto("/");
    for (const name of [
      "Reader Workbench",
      "Memory Blocks",
      "Key Management",
      "Device Settings",
      "Communication Logs",
      "Appearance",
    ]) {
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      const untranslated = await page.locator(".app-shell").evaluate((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const found: string[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const element = node.parentElement;
          if (
            !element ||
            element.closest(
              '.language-toggle, .traffic-payload, .traffic-detail code, .traffic-detail p, .log-table code, .log-export-preview, .author-credit [lang="zh-CN"]',
            )
          )
            continue;
          if (
            element.getClientRects().length &&
            /[\u3400-\u9fff]/.test(node.textContent ?? "")
          )
            found.push(node.textContent!.trim());
        }
        return found;
      });
      expect(untranslated, name).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflow, name).toBe(false);
      if (name === "Device Settings") {
        const gainButton = await page
          .getByRole("button", { name: "Save gain", exact: true })
          .boundingBox();
        expect(gainButton!.y + gainButton!.height).toBeLessThanOrEqual(
          viewport.height,
        );
      }
      await page.screenshot({
        path: info.outputPath(`${name.replaceAll(" ", "-")}.png`),
      });
    }
  });
}

test("switching language does not translate user content or discard key drafts", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "密钥管理", exact: true })
    .click();
  await page.getByLabel("Key A", { exact: true }).fill("112233445566");
  await page
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await expect(page.getByLabel("Key A", { exact: true })).toHaveValue(
    "112233445566",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Memory Blocks", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Encoded input", exact: true })
    .click();
  await page
    .getByLabel("Write content encoding", { exact: true })
    .selectOption("utf-8");
  await page.getByLabel("Conversion input", { exact: true }).fill("数据块");
  await page.getByRole("button", { name: "切换到中文", exact: true }).click();
  await expect(page.getByLabel("转换内容", { exact: true })).toHaveValue(
    "数据块",
  );
  await page
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await expect(
    page.getByLabel("Conversion input", { exact: true }),
  ).toHaveValue("数据块");
});
