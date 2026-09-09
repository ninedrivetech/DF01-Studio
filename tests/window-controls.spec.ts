import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EMPTY_SNAPSHOT } from "../src/lib/types";

async function assertTopbarLayout(page: Page) {
  const topbar = page.locator(".topbar");
  const controls = topbar.getByRole("group", { name: "窗口控制", exact: true });
  const themeButton = topbar.getByRole("button", {
    name: /^切换到(日间|夜间)主题$/,
  });
  await expect(controls).toBeVisible();
  await expect(themeButton).toBeVisible();
  await expect(page.locator(".statusbar")).toHaveCount(0);
  const headerRect = await topbar.boundingBox();
  const controlsRect = await controls.boundingBox();
  const themeRect = await themeButton.boundingBox();
  if (!headerRect || !controlsRect || !themeRect) {
    throw new Error("Topbar controls must have visible bounds");
  }
  expect(headerRect.y).toBe(0);
  expect(controlsRect.x).toBeGreaterThanOrEqual(themeRect.x + themeRect.width);
  expect(controlsRect.y).toBeGreaterThanOrEqual(headerRect.y);
  expect(controlsRect.y + controlsRect.height).toBeLessThanOrEqual(
    headerRect.y + headerRect.height,
  );
  expect(controlsRect.x + controlsRect.width).toBeLessThanOrEqual(
    headerRect.x + headerRect.width,
  );
  expect(
    Math.abs(
      controlsRect.y +
        controlsRect.height / 2 -
        (themeRect.y + themeRect.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
}

test("window controls stay hidden in a browser", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "读卡工作台", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "窗口控制", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".statusbar")).toHaveCount(0);
  await expect(
    page.locator(".topbar").getByRole("button", {
      name: /^切换到(日间|夜间)主题$/,
    }),
  ).toBeVisible();
});

test("window controls share the topbar with the theme button and preserve native actions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((snapshot) => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let nextId = 1;
    const state = {
      maximized: false,
      failNext: false,
      actions: [] as string[],
      resize(maximized: boolean) {
        state.maximized = maximized;
        for (const [id, listener] of listeners) {
          if (listener.event === "tauri://resize") {
            callbacks.get(listener.handler)?.({
              event: listener.event,
              id,
              payload: { width: 1440, height: 960 },
            });
          }
        }
      },
    };
    Object.assign(window, {
      isTauri: true,
      __windowControlTest: state,
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener(_event: string, id: number) {
          listeners.delete(id);
        },
      },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback(callback: (event: unknown) => void) {
          const id = nextId++;
          callbacks.set(id, callback);
          return id;
        },
        async invoke(
          command: string,
          args: { event?: string; handler?: number; eventId?: number },
        ) {
          if (command === "get_snapshot") return structuredClone(snapshot);
          if (command === "list_ports") return [];
          if (command === "preview_command")
            return { hex: "7F 03 00 10 13", length: 5 };
          if (command === "plugin:event|listen") {
            const id = nextId++;
            listeners.set(id, { event: args.event!, handler: args.handler! });
            return id;
          }
          if (command === "plugin:event|unlisten") {
            listeners.delete(args.eventId!);
            return;
          }
          if (command === "plugin:window|is_maximized") return state.maximized;
          if (command.startsWith("plugin:window|")) {
            state.actions.push(command);
            if (state.failNext) {
              state.failNext = false;
              throw new Error("测试窗口暂不可用");
            }
            if (command === "plugin:window|toggle_maximize")
              state.resize(!state.maximized);
            return;
          }
          throw new Error(`Unexpected test IPC: ${command}`);
        },
      },
    });
  }, EMPTY_SNAPSHOT);
  await page.goto("/");
  const controls = page
    .locator(".topbar")
    .getByRole("group", { name: "窗口控制", exact: true });
  await expect(controls).toBeVisible();
  await page.setViewportSize({ width: 900, height: 640 });
  await assertTopbarLayout(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await assertTopbarLayout(page);
  await controls
    .getByRole("button", { name: "最大化窗口", exact: true })
    .click();
  await expect(
    controls.getByRole("button", { name: "还原窗口", exact: true }),
  ).toBeVisible();
  await controls.getByRole("button", { name: "还原窗口", exact: true }).click();
  await expect(
    controls.getByRole("button", { name: "最大化窗口", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as {
        __windowControlTest: { resize(value: boolean): void };
      }
    ).__windowControlTest.resize(true),
  );
  await expect(
    controls.getByRole("button", { name: "还原窗口", exact: true }),
  ).toBeVisible();
  await controls
    .getByRole("button", { name: "最小化窗口", exact: true })
    .click();
  await page.getByTitle("拖动窗口", { exact: true }).click();
  await page.evaluate(() => {
    (
      window as unknown as { __windowControlTest: { failNext: boolean } }
    ).__windowControlTest.failNext = true;
  });
  await controls.getByRole("button", { name: "还原窗口", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("窗口操作失败");
  await expect(
    controls.getByRole("button", { name: "关闭窗口", exact: true }),
  ).toBeEnabled();
  await controls.getByRole("button", { name: "关闭窗口", exact: true }).click();
  const actions = await page.evaluate(
    () =>
      (window as unknown as { __windowControlTest: { actions: string[] } })
        .__windowControlTest.actions,
  );
  expect(actions).toEqual([
    "plugin:window|toggle_maximize",
    "plugin:window|toggle_maximize",
    "plugin:window|minimize",
    "plugin:window|start_dragging",
    "plugin:window|toggle_maximize",
    "plugin:window|close",
  ]);
  expect(errors).toEqual([]);
});
