import { expect, test } from "@playwright/test";

for (const motion of ["full", "reduced"] as const) {
  test(`gain celebration plays audio with ${motion} motion`, async ({
    page,
  }) => {
    await page.addInitScript((motion) => {
      localStorage.setItem("df01.preferences", JSON.stringify({ motion }));
      const contexts: AudioContext[] = [];
      const oscillators: OscillatorNode[] = [];
      Object.assign(window, {
        gainAudioContexts: contexts,
        gainOscillators: oscillators,
      });
      const OriginalAudioContext = window.AudioContext;
      window.AudioContext = class extends OriginalAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          contexts.push(this);
        }
        createOscillator() {
          const oscillator = super.createOscillator();
          oscillators.push(oscillator);
          return oscillator;
        }
      };
    }, motion);
    await page.goto("/");
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(page.locator(".rf-control")).toContainText("已保存 48 dB");
    const slider = page.getByRole("slider", {
      name: "工作台天线增益",
      exact: true,
    });
    await slider.focus();
    await slider.press("Home");
    await slider.press("End");
    await expect(page.locator(".gain-easter-egg")).toBeVisible();
    await expect(slider).toBeFocused();
    const active = await page.evaluate(() => {
      const audio = window as typeof window & {
        gainAudioContexts: AudioContext[];
        gainOscillators: OscillatorNode[];
      };
      return {
        shaking: document.getElementById("root")!.getAnimations().length > 0,
        sound: audio.gainAudioContexts.some(
          (context) => context.state === "running",
        ),
        voices: audio.gainOscillators.length,
      };
    });
    expect(active.shaking).toBe(motion === "full");
    expect(active.sound).toBe(true);
    expect(active.voices).toBeGreaterThanOrEqual(3);
    await expect(page.locator("#root")).toHaveCSS("transform", "none");
    await page.getByRole("button", { name: "关闭彩蛋", exact: true }).click();
    await expect(page.locator(".gain-easter-egg")).toHaveCount(0);
  });
}
