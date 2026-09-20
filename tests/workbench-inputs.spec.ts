import { expect, test } from "@playwright/test";
import { EMPTY_SNAPSHOT } from "../src/lib/types";

test("serial list stays complete after selection and preserves manual or unplugged ports", async ({
  page,
}) => {
  await page.addInitScript((snapshot) => {
    const state = {
      ports: ["COM10", "COM2", "COM1", "COM2"],
      fail: false,
      connectedPort: "",
    };
    Object.assign(window, {
      isTauri: true,
      serialTest: state,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: () => 1,
        async invoke(command: string, args: { config?: { port: string } }) {
          if (command === "get_snapshot") return snapshot;
          if (command === "list_ports") {
            if (state.fail) throw new Error("扫描测试失败");
            return state.ports.map((name) => ({
              name,
              kind: "USB test reader",
              description:
                name === "COM2"
                  ? "USB-SERIAL CH340 (COM2)"
                  : "USB Serial Device",
            }));
          }
          if (command === "connect_device") {
            state.connectedPort = args.config!.port;
            snapshot.connection.connected = true;
            snapshot.connection.port = state.connectedPort;
            return snapshot.connection;
          }
          if (command.startsWith("plugin:")) return false;
          throw new Error(command);
        },
      },
    });
  }, structuredClone(EMPTY_SNAPSHOT));
  await page.goto("/");
  const ports = page.getByRole("combobox", { name: "串口", exact: true });
  await ports.click();
  const options = page.getByRole("listbox", { name: "可用串口" }).getByRole("option");
  await expect(options).toHaveText([
    "请选择串口",
    "USB Serial Device (COM1)USB test reader",
    "USB-SERIAL CH340 (COM2)USB test reader",
    "USB Serial Device (COM10)USB test reader",
  ]);
  await page
    .getByRole("option", { name: /USB-SERIAL CH340 \(COM2\)/ })
    .click();
  await expect(ports).toHaveText("USB-SERIAL CH340 (COM2)");
  await ports.click();
  await expect(options).toHaveCount(4);
  await ports.press("End");
  await ports.press("Enter");
  await expect(ports).toHaveText("USB Serial Device (COM10)");
  await page.evaluate(() => {
    (
      window as unknown as { serialTest: { ports: string[] } }
    ).serialTest.ports = ["COM1", "COM12"];
  });
  await page.getByRole("button", { name: "刷新串口" }).click();
  await expect(ports).toHaveText("COM10");
  await ports.click();
  await expect(options).toContainText([
    "请选择串口",
    "COM10未检测到 / 手动指定",
    "COM1",
    "COM12",
  ]);
  await ports.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("button", { name: "手动输入", exact: true }).click();
  await page.getByLabel("手动串口").fill("COM99");
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(ports).toHaveText("COM99");
  await page.evaluate(() => {
    (window as unknown as { serialTest: { fail: boolean } }).serialTest.fail =
      true;
  });
  await page.getByRole("button", { name: "刷新串口" }).click();
  await expect(page.getByRole("alert")).toContainText("串口扫描失败");
  await expect(ports).toHaveText("COM99");
  await page.evaluate(() => {
    (window as unknown as { serialTest: { fail: boolean } }).serialTest.fail =
      false;
  });
  await page.getByRole("button", { name: "刷新串口" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await ports.click();
  await page
    .getByRole("option", { name: /USB Serial Device \(COM12\)/ })
    .click();
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { serialTest: { connectedPort: string } })
            .serialTest.connectedPort,
      ),
    )
    .toBe("COM12");
});

test("numeric drafts can be cleared and replaced without sending zero or stale values", async ({
  page,
}) => {
  await page.goto("/");
  const address = page.getByLabel("连接地址");
  await address.fill("");
  await expect(address).toHaveValue("");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toHaveCount(0);
  await expect(address).toHaveValue("");
  await address.pressSequentially("127");
  await expect(address).toHaveValue("127");
  await page.getByRole("button", { name: "连接设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设备配置", exact: true })
    .click();
  const duration = page.getByLabel("防重读时长");
  await duration.fill("");
  await duration.pressSequentially("1001");
  await expect(duration).toHaveValue("1001");
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.locator(".saved-configuration")).toContainText("1001 ms");
  await duration.fill("");
  await page.getByRole("button", { name: "保存时长", exact: true }).click();
  await expect(page.locator(".saved-configuration")).toContainText("1001 ms");
  const gain = page.getByRole("slider", { name: "天线增益" });
  await gain.focus();
  await gain.press("End");
  await expect(gain).toHaveValue("7");
  await expect(gain).toHaveAttribute("aria-valuetext", "档位 7，48 dB");
  await page.getByRole("button", { name: "保存增益", exact: true }).click();
  await expect(page.locator(".saved-configuration")).toContainText("48 dB");
});

for (const viewport of [
  { width: 1280, height: 820 },
  { width: 900, height: 640 },
]) {
  test(`workbench controls fit the first screen at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const assertFits = async () => {
      const main = await page.locator("main").evaluate((element) => ({
        height: element.clientHeight,
        content: element.scrollHeight,
      }));
      expect(main.content).toBeLessThanOrEqual(main.height + 1);
      for (const selector of [
        ".traffic-toolbar",
        ".traffic-detail",
        ".reader-summary",
        ".quick-mode",
        ".rf-control",
        ".reset-control",
        ".latest-data",
      ]) {
        const box = await page.locator(selector).boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
    };
    await assertFits();
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "断开连接", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("工作台自动模式")).toHaveValue("0");
    await assertFits();
    await page.getByLabel("工作台自动模式").selectOption("2");
    await page.getByLabel("工作台目标块").fill("1");
    await page.getByRole("button", { name: "应用模式", exact: true }).click();
    await expect(page.locator(".latest-data")).toContainText("DF-01 FRUITFLY");
    await expect(page.getByLabel("最近块数据", { exact: true })).toBeVisible();
    await assertFits();
    const formats = await page
      .getByRole("group", { name: "查看编码" })
      .boundingBox();
    expect(formats!.y + formats!.height).toBeLessThanOrEqual(viewport.height);
    const simulation = await page.locator(".simulation-controls").boundingBox();
    expect(simulation!.y + simulation!.height).toBeLessThanOrEqual(
      viewport.height,
    );
    await page.screenshot({ path: info.outputPath("workbench-compact.png") });
  });
}
