import { expect, test } from "@playwright/test";

test("DF-01 block import validates the format and only stages editor data", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "数据块", exact: true }).click();
  const fileInput = page.locator('input[type="file"]');
  const blocks = [
    { block: 1, data: Array.from({ length: 16 }, (_, i) => i + 32) },
  ];

  await fileInput.setInputFiles({
    name: "invalid-memory.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ format: "unsupported-memory-v1", blocks }),
    ),
  });
  await expect(page.getByRole("alert")).toContainText("不是有效的数据块文件");
  await expect(page.getByLabel("字节 0", { exact: true })).toHaveValue("00");

  await fileInput.setInputFiles({
    name: "df01-memory.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "df01-memory-v1", blocks })),
  });
  await expect(page.getByRole("status")).toContainText(
    "块 1 已载入编辑器，尚未写入卡片",
  );
  for (let i = 0; i < 16; i++) {
    await expect(page.getByLabel(`字节 ${i}`, { exact: true })).toHaveValue(
      (i + 32).toString(16).toUpperCase(),
    );
  }
  await expect(
    page.getByRole("button", { name: "连接设备", exact: true }),
  ).toBeVisible();
});
