import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const storageKey = "df01.preferences";

async function seedPreferences(page: Page, value: Record<string, string>) {
  await page.addInitScript(
    ({ key, preferences }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(preferences));
      }
    },
    { key: storageKey, preferences: value },
  );
}

async function openAppearance(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "外观设置", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "外观设置", level: 1 }),
  ).toBeVisible();
}

async function expectAppearance(
  page: Page,
  theme: string,
  mode: "day" | "night",
) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveCSS(
    "color-scheme",
    mode === "day" ? "light" : "dark",
  );
  const toggle = page.getByRole("button", {
    name: mode === "day" ? "切换到夜间主题" : "切换到日间主题",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await expect(
    toggle.locator(mode === "day" ? "svg.lucide-moon" : "svg.lucide-sun"),
  ).toBeVisible();
}

test("forest is a day theme and survives a round trip through night mode", async ({
  page,
}) => {
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("button", { name: "苔原微光", exact: true }).click();
  await expectAppearance(page, "emerald", "day");
  await page
    .getByRole("button", { name: "切换到夜间主题", exact: true })
    .click();
  await expectAppearance(page, "business", "night");
  await page
    .getByRole("button", { name: "切换到日间主题", exact: true })
    .click();
  await expectAppearance(page, "emerald", "day");
});

test("high contrast is a night theme and survives a round trip through day mode", async ({
  page,
}) => {
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("button", { name: "高对比", exact: true }).click();
  await expectAppearance(page, "black", "night");
  await page
    .getByRole("button", { name: "切换到日间主题", exact: true })
    .click();
  await expectAppearance(page, "corporate", "day");
  await page
    .getByRole("button", { name: "切换到夜间主题", exact: true })
    .click();
  await expectAppearance(page, "black", "night");
});

test("explicit theme choices remember both groups across reload without resetting display preferences", async ({
  page,
}) => {
  await seedPreferences(page, {
    theme: "light",
    density: "comfortable",
    motion: "reduced",
  });
  await page.goto("/");
  await openAppearance(page);
  await page.getByRole("button", { name: "苔原微光", exact: true }).click();
  await page.getByRole("button", { name: "高对比", exact: true }).click();
  await page
    .getByRole("button", { name: "切换到日间主题", exact: true })
    .click();
  await expectAppearance(page, "emerald", "day");
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
        storageKey,
      ),
    )
    .toMatchObject({
      theme: "forest",
      dayTheme: "forest",
      nightTheme: "contrast",
      density: "comfortable",
      motion: "reduced",
    });
  await page.reload();
  await expectAppearance(page, "emerald", "day");
  await expect(page.locator("html")).toHaveAttribute(
    "data-density",
    "comfortable",
  );
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page
    .getByRole("button", { name: "切换到夜间主题", exact: true })
    .click();
  await expectAppearance(page, "black", "night");
});

for (const legacy of [
  {
    theme: "light",
    dayTheme: "light",
    nightTheme: "graphite",
    mode: "day",
    daisyTheme: "corporate",
  },
  {
    theme: "forest",
    dayTheme: "forest",
    nightTheme: "graphite",
    mode: "day",
    daisyTheme: "emerald",
  },
  {
    theme: "graphite",
    dayTheme: "light",
    nightTheme: "graphite",
    mode: "night",
    daisyTheme: "business",
  },
  {
    theme: "contrast",
    dayTheme: "light",
    nightTheme: "contrast",
    mode: "night",
    daisyTheme: "black",
  },
] as const) {
  test(`legacy ${legacy.theme} preferences migrate into the correct day/night group`, async ({
    page,
  }) => {
    await seedPreferences(page, {
      theme: legacy.theme,
      density: "compact",
      motion: "full",
    });
    await page.goto("/");
    await expectAppearance(page, legacy.daisyTheme, legacy.mode);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
          storageKey,
        ),
      )
      .toMatchObject({
        theme: legacy.theme,
        dayTheme: legacy.dayTheme,
        nightTheme: legacy.nightTheme,
        density: "compact",
        motion: "full",
      });
  });
}

test("rapid toggles use the latest state and keep both remembered themes", async ({
  page,
}) => {
  await seedPreferences(page, {
    theme: "forest",
    dayTheme: "forest",
    nightTheme: "contrast",
    density: "compact",
    motion: "system",
  });
  await page.goto("/");
  await expectAppearance(page, "emerald", "day");
  const toggle = page.getByRole("button", { name: /^切换到(日间|夜间)主题$/ });
  await toggle.evaluate((button) => {
    for (let index = 0; index < 7; index++)
      (button as HTMLButtonElement).click();
  });
  await expectAppearance(page, "black", "night");
  await toggle.evaluate((button) => {
    for (let index = 0; index < 6; index++)
      (button as HTMLButtonElement).click();
  });
  await expectAppearance(page, "black", "night");
  await toggle.click();
  await expectAppearance(page, "emerald", "day");
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
        storageKey,
      ),
    )
    .toMatchObject({
      theme: "forest",
      dayTheme: "forest",
      nightTheme: "contrast",
    });
});
