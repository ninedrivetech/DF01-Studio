import { describe, expect, it } from "vitest";
import { loadLanguage, translate } from "./i18n";

describe("interface language", () => {
  it("defaults to Chinese and tolerates missing, invalid, or blocked storage", () => {
    expect(loadLanguage({ getItem: () => null })).toBe("zh-CN");
    expect(loadLanguage({ getItem: () => "fr" })).toBe("zh-CN");
    expect(loadLanguage({ getItem: () => "en" })).toBe("en");
    expect(
      loadLanguage({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("zh-CN");
  });

  it("translates labels and interpolated application feedback", () => {
    expect(translate("读卡工作台", "en")).toBe("Reader Workbench");
    expect(translate("读取数据块成功", "en")).toBe("Read data block succeeded");
    expect(translate("设置电机上电方向成功", "en")).toBe(
      "Set startup motor direction succeeded",
    );
    expect(translate("请输入 0–255 的整数", "en")).toBe(
      "Enter an integer from 0 to 255",
    );
    expect(translate("已保存 500 ms", "en")).toBe("Saved 500 ms");
    expect(translate(" · 3 个", "en")).toBe(" · 3 ports");
    expect(
      translate("编码后为 20 字节，超过单块 16 字节，请缩短内容", "en"),
    ).toBe(
      "Encoded content is 20 bytes, exceeding the 16-byte block; shorten it",
    );
  });

  it("preserves Chinese and unknown strings without changing data", () => {
    expect(translate("读卡工作台", "zh-CN")).toBe("读卡工作台");
    expect(translate("USB-SERIAL CH340 (COM9)", "en")).toBe(
      "USB-SERIAL CH340 (COM9)",
    );
    expect(translate("设备厂商自定义名称 (COM9)", "en")).toBe(
      "设备厂商自定义名称 (COM9)",
    );
    expect(translate("7F 03 00 10 13", "en")).toBe("7F 03 00 10 13");
  });
});
