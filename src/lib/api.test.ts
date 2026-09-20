import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorMessage, frame, hex, parseHex, validateRequest } from "./api";
import type { CommandRequest, ConnectConfig } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const request = (
  command: number,
  parameters: number[] = [],
): CommandRequest => ({ command, parameters });
const automatic = (mode: number, reserved = [0, 0, 0, 1], block = 1) =>
  request(0x2e, [mode, mode + 0x0a, block, ...reserved, 0x23, 0x12, 0x54]);

describe("wire format from the current firmware table", () => {
  const vectors: [number, number, string, string][] = [
    [0, 0x10, "", "7F03001013"],
    [0, 0x90, "00 0400 E045AFAB", "7F0A0090000400E045AFAB3F"],
    [0, 0x11, "01", "7F0400110114"],
    [
      0,
      0x91,
      "00 0400 E045AFAB D3C5C1E9BFC6BCBC0000000000000000",
      "7F1A0091000400E045AFABD3C5C1E9BFC6BCBC000000000000000069",
    ],
    [0, 0x2e, "00 0A 01 00000001 231254", "7F0D002E000A01000000012312544C"],
    [0, 0x2e, "01 0B 01 00000001 231254", "7F0D002E010B01000000012312544C"],
    [0, 0x2e, "02 0C 01 00000001 231254", "7F0D002E020C010000000123125448"],
    [0, 0xae, "00", "7F0400AE00AA"],
    [
      0,
      0x12,
      "01 D3C5C1E9BFC6BCBC0000000000000000",
      "7F14001201D3C5C1E9BFC6BCBC000000000000000040",
    ],
    [0, 0x92, "00 0400 E045AFAB", "7F0A0092000400E045AFAB3D"],
    [0, 0x2f, "E803", "7F05002FE803C1"],
    [0, 0xaf, "00", "7F0400AF00AB"],
    [0, 0x30, "07", "7F0400300733"],
    [0, 0xb0, "0007", "7F0500B00007B2"],
    [0, 0x31, "", "7F03003132"],
    [1, 0xad, "00", "7F0401AD00A8"],
    [
      0,
      0xb1,
      "00 00 00C20100 00 01 00000001 FFFFFFFFFFFF FFFFFFFFFFFF 0000 04",
      "7F1E00B1000000C20100000100000001FFFFFFFFFFFFFFFFFFFFFFFF00000468",
    ],
    [0x7f, 0x10, "", "7F037F7F106C"],
    [0x6c, 0x10, "", "7F036C107F7F"],
    [0, 0x11, "6A", "7F0400116A7F7F"],
    [0x7f, 0x7f, "7F7F", "7F057F7F7F7F7F7F7F7F05"],
  ];

  it.each(vectors)(
    "encodes address %i command %i parameters %s",
    (address, command, parameters, expected) => {
      const encoded = frame(address, command, parseHex(parameters));
      expect(encoded.hex.replaceAll(" ", "")).toBe(expected);
      // Preview length is the complete transmitted byte count, as in the Rust IPC response.
      expect(encoded.length).toBe(expected.length / 2);
    },
  );

  it("checksums unescaped bytes while stuffing consecutive parameter bytes", () => {
    const encoded = frame(0, 0x12, [1, 0x7f, ...Array<number>(15).fill(0)]);
    expect(encoded.hex.replaceAll(" ", "")).toBe(
      "7F140012017F7F00000000000000000000000000000078",
    );
    expect(encoded.length).toBe(23);
  });

  it("rejects invalid frame fields before they can become malformed wire bytes", () => {
    expect(() => frame(256, 0x10, [])).toThrow("有效字节");
    expect(() => frame(0, -1, [])).toThrow("有效字节");
    expect(() => frame(0, 0x10, [Number.NaN])).toThrow("有效字节");
    expect(() => frame(0, 0x10, new Array<number>(1))).toThrow("有效字节");
    expect(() => frame(0, 0x10, Array<number>(253).fill(0))).toThrow("252");
    expect(frame(0, 0x12, Array<number>(123).fill(0x7f)).length).toBe(251);
    expect(
      frame(0, 0x12, Array<number>(124).fill(0)).hex.startsWith("7F 7F 7F "),
    ).toBe(true);
  });
});

describe("hexadecimal input and recoverable error messages", () => {
  it("accepts mixed case and whitespace without changing byte order", () => {
    expect(parseHex("aa BB\n7f\t00", 4)).toEqual([0xaa, 0xbb, 0x7f, 0]);
    expect(hex(parseHex("aabb7f00"))).toBe("AA BB 7F 00");
    expect(parseHex("")).toEqual([]);
  });

  it.each(["0", "GG", "0x7F", "AA-BB", "FF,00", "AABBZ0"])(
    "rejects malformed input %s",
    (value) => {
      expect(() => parseHex(value)).toThrow();
    },
  );

  it("enforces the byte count for key and block forms", () => {
    expect(() => parseHex("FF FF", 6)).toThrow("6");
    expect(() => parseHex("00".repeat(17), 16)).toThrow("16");
    expect(parseHex("FF".repeat(6), 6)).toHaveLength(6);
  });

  it("preserves Rust errors and normal JavaScript errors", () => {
    expect(errorMessage({ code: "timeout", message: "设备应答超时" })).toBe(
      "设备应答超时",
    );
    expect(errorMessage(new Error("串口已断开"))).toBe("串口已断开");
    expect(errorMessage("无卡")).toBe("无卡");
    expect(errorMessage(null)).toContain("操作失败");
  });
});

describe("command validation", () => {
  it.each([0x13, 0x14, 0x15, 0x16, 0xa0, 0xff])(
    "excludes identity and transaction command %i",
    (command) => {
      expect(() => validateRequest(request(command))).toThrow("支持范围");
    },
  );

  it("allows the full one-byte read page range without relaxing write protection", () => {
    expect(() => validateRequest(request(0x11, [255]))).not.toThrow();
    expect(() => validateRequest(request(0x11, [256]))).toThrow("有效字节");
    expect(() => validateRequest(request(0x11, [-1]))).toThrow("有效字节");
    expect(() => validateRequest(request(0x11, [1.5]))).toThrow("有效字节");
    expect(() =>
      validateRequest(request(0x12, Array<number>(17).fill(0))),
    ).toThrow("只读");
    expect(() =>
      validateRequest(request(0x12, [64, ...Array<number>(16).fill(0)])),
    ).toThrow();
  });

  it("requires confirmation for a sector trailer and exactly 16 write bytes", () => {
    const trailer = request(0x12, [3, ...Array<number>(16).fill(0xff)]);
    expect(() => validateRequest(trailer)).toThrow("二次确认");
    expect(() =>
      validateRequest({ ...trailer, confirmedWrite: true }),
    ).not.toThrow();
    expect(() => validateRequest(request(0x12, [1, 0]))).toThrow("长度");
  });

  it.each([0, 1, 2])(
    "accepts documented automatic mode %i and its ignored reserved value",
    (mode) => {
      expect(() => validateRequest(automatic(mode))).not.toThrow();
      expect(() =>
        validateRequest(automatic(mode, [0x7f, 0xff, 0x12, 0x34], 255)),
      ).not.toThrow();
    },
  );

  it("rejects undefined automatic modes and damaged confirmation fields", () => {
    expect(() => validateRequest(automatic(4))).toThrow();
    const badCheck = automatic(2);
    badCheck.parameters[1] = 0x0a;
    expect(() => validateRequest(badCheck)).toThrow();
    const badSuffix = automatic(2);
    badSuffix.parameters[9] = 0;
    expect(() => validateRequest(badSuffix)).toThrow("确认");
    expect(() =>
      validateRequest(request(0x2b, Array<number>(18).fill(0xff))),
    ).toThrow("确认");
  });

  it("validates voice encodings, wait flags and startup boundaries", () => {
    for (const encoding of [0, 1, 3, 4, 5]) {
      const req = automatic(3);
      req.parameters[3] = encoding;
      req.parameters[4] = 1;
      expect(() => validateRequest(req)).not.toThrow();
    }
    const invalidVoice = automatic(3);
    invalidVoice.parameters[3] = 2;
    expect(() => validateRequest(invalidVoice)).toThrow();
    invalidVoice.parameters[3] = 1;
    invalidVoice.parameters[4] = 2;
    expect(() => validateRequest(invalidVoice)).toThrow();
    for (const [ramp, delay, valid] of [
      [200, 200, true],
      [10000, 5000, true],
      [199, 200, false],
      [10001, 200, false],
      [1000, 199, false],
      [1000, 5001, false],
    ]) {
      const validate = () =>
        validateRequest(
          request(0x32, [
            Number(ramp) & 255,
            Number(ramp) >> 8,
            Number(delay) & 255,
            Number(delay) >> 8,
          ]),
        );
      if (valid) expect(validate).not.toThrow();
      else expect(validate).toThrow();
    }
    expect(frame(0, 0x32, [0xe8, 3, 0xc8, 0]).hex).toBe(
      "7F 07 00 32 E8 03 C8 00 16",
    );
  });

  it("excludes baud changes and validates reset/gain extension ranges", () => {
    const baud = request(0x2c, [0, 1, 0xc2, 0, 0x98, 0x24, 0x31]);
    expect(() => validateRequest(baud)).toThrow("支持范围");
    for (const value of [0, 100, 1000, 3000])
      expect(() =>
        validateRequest(request(0x2f, [value & 255, value >> 8])),
      ).not.toThrow();
    for (const value of [1, 99, 3001, 65535])
      expect(() =>
        validateRequest(request(0x2f, [value & 255, value >> 8])),
      ).toThrow("防重读");
    expect(() => validateRequest(request(0x30, [7]))).not.toThrow();
    expect(() => validateRequest(request(0x30, [8]))).toThrow("增益");
    expect(() => validateRequest(request(0x31))).not.toThrow();
  });
});

describe("browser simulator workflows", () => {
  let api: typeof import("./api").api;
  const config: ConnectConfig = {
    port: "",
    baudRate: 115200,
    address: 0,
    timeoutMs: 1500,
    simulation: true,
    profile: "current",
  };

  beforeEach(async () => {
    vi.resetModules();
    api = (await import("./api")).api;
    await api.connect(config);
    await api.execute(automatic(1));
    await api.clearLogs();
  });
  afterEach(async () => {
    await api.disconnect();
  });

  it("reads UID, reports no card and recovers after the card returns", async () => {
    expect((await api.snapshot()).connection).toMatchObject({
      connected: true,
      simulation: true,
      profile: "current",
    });
    const first = await api.execute(request(0x10));
    expect(first.status).toBe(0);
    expect(first.card).toMatchObject({
      uidHex: "ABAF45E0",
      uidDecimal: String(0xabaf45e0),
    });
    await api.setSimulationCard(false);
    const pending = api.execute(request(0x10));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await api.snapshot()).logs.at(-1)?.direction).toBe("tx");
    await api.setSimulationCard(true);
    expect((await pending).status).toBe(0);
  });

  it("writes a normal block, reads it back and keeps snapshots isolated", async () => {
    const bytes = [
      0x7f,
      0x00,
      0xff,
      ...Array.from({ length: 13 }, (_, i) => i + 1),
    ];
    expect((await api.execute(request(0x12, [1, ...bytes]))).status).toBe(0);
    const result = await api.execute(request(0x11, [1]));
    expect(result.card).toMatchObject({ block: 1, data: bytes });
    const snapshot = await api.snapshot();
    snapshot.logs.length = 0;
    expect((await api.snapshot()).logs.length).toBeGreaterThan(0);
  });

  it("keeps memory separate for each card and returns the correct manufacturer UID bytes", async () => {
    const bytes = Array<number>(16).fill(0x73);
    await api.execute(request(0x12, [1, ...bytes]));
    await api.nextSimulationCard();
    const second = await api.execute(request(0x11, [1]));
    expect(second.card?.uidHex).toBe("DDCCBBAA");
    expect(second.card?.data).not.toEqual(bytes);
    expect(
      (await api.execute(request(0x11, [0]))).card?.data?.slice(0, 5),
    ).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0]);
    await api.nextSimulationCard();
    const original = await api.execute(request(0x11, [1]));
    expect(original.card).toMatchObject({ uidHex: "ABAF45E0", data: bytes });
  });

  it("accepts high page requests but reports S50 memory limits without inventing data", async () => {
    expect(() => validateRequest(request(0x11, [0xff]))).not.toThrow();
    await expect(api.execute(request(0x11, [0xff]))).rejects.toThrow(
      "等待读卡超时",
    );
    const snapshot = await api.snapshot();
    expect(snapshot.connection.connected).toBe(false);
    expect(snapshot.logs.some((entry) => entry.command === 0x91)).toBe(false);
  });

  it("synchronizes persisted configuration and uses the new ID in its acknowledgement", async () => {
    await api.execute(automatic(2));
    expect(await api.snapshot()).toMatchObject({ autoMode: 2, autoBlock: 1 });
    await api.execute(request(0x2d, [0x7f, 0x37, 0x21, 0x56]));
    expect(
      (await api.snapshot()).logs.find((entry) => entry.command === 0xad)?.hex,
    ).toBe("7F 04 7F 7F AD 00 D6");
    await api.execute(request(0x2f, [0xe8, 3]));
    await api.execute(request(0x30, [7]));
    const result = await api.execute(request(0x31));
    expect(result.data).toHaveLength(33);
    expect(result.data.slice(24, 27)).toEqual([0xe8, 3, 7]);
    expect(result.data[31]).toBe(0);
    expect((await api.snapshot()).configuration).toMatchObject({
      moduleId: 0x7f,
      resetMs: 1000,
      antennaGain: 7,
    });
    expect((await api.snapshot()).connection).toMatchObject({
      address: 0x7f,
      baudRate: 115200,
    });
  });

  it("redacts key material from preview and log exports", async () => {
    const keys = request(0x2b, [
      ...Array<number>(12).fill(0xab),
      0,
      3,
      8,
      5,
      2,
      7,
    ]);
    expect((await api.preview(keys)).hex).not.toContain("AB AB");
    await api.execute(keys);
    await api.execute(request(0x31));
    expect((await api.snapshot()).configuration?.keyA).toEqual(
      Array<number>(6).fill(0xab),
    );
    expect(JSON.stringify((await api.snapshot()).logs)).not.toContain(
      "AB AB AB",
    );
    await api.clearLogs();
    expect((await api.snapshot()).logs).toEqual([]);
  });

  it("redacts sector trailer write, read and automatic report logs", async () => {
    const trailer = {
      ...request(0x12, [3, ...Array<number>(16).fill(0xad)]),
      confirmedWrite: true,
    };
    await api.execute(trailer);
    await api.execute(request(0x11, [3]));
    await api.execute(automatic(2, [0, 0, 0, 1], 3));
    const snapshot = await api.snapshot();
    expect(snapshot.lastCard).toMatchObject({
      block: 3,
      data: Array<number>(16).fill(0xad),
    });
    expect(JSON.stringify(snapshot.logs)).not.toContain("AD AD AD");
  });

  it("deduplicates removal/replacement and clears a matching UID after a successful manual read", async () => {
    await api.execute(automatic(0));
    const initial = await api.snapshot();
    expect(initial.autoMode).toBe(0);
    expect(initial.stats).toMatchObject({ tx: 3, rx: 4 });
    expect(initial.lastCard?.block).toBeNull();
    await api.setSimulationCard(false);
    await api.snapshot();
    await api.setSimulationCard(true);
    expect((await api.snapshot()).stats.rx).toBe(4);
    await api.execute(request(0x10));
    expect((await api.snapshot()).stats.rx).toBe(6);
    await api.nextSimulationCard();
    expect((await api.snapshot()).lastCard?.uidHex).toBe("DDCCBBAA");
    expect((await api.snapshot()).stats.rx).toBe(7);
    await api.nextSimulationCard();
    expect((await api.snapshot()).lastCard?.uidHex).toBe("ABAF45E0");
    expect((await api.snapshot()).stats.rx).toBe(8);
  });

  it("uses the configured automatic block while failed reads remain silent and do not consume the UID", async () => {
    await api.execute(automatic(2, [0x7f, 2, 3, 4], 0xff));
    expect((await api.snapshot()).stats.rx).toBe(3);
    expect((await api.snapshot()).lastCard).toBeNull();
    await api.execute(automatic(2, [0x7f, 2, 3, 4], 1));
    const snapshot = await api.snapshot();
    expect(snapshot.stats.rx).toBe(5);
    expect(snapshot.lastCard).toMatchObject({
      block: 1,
      data: expect.any(Array),
    });
    expect(snapshot.lastCard?.data).toHaveLength(16);
    await api.execute(automatic(1));
    await api.nextSimulationCard();
    expect((await api.snapshot()).stats.rx).toBe(6);
  });

  it("serializes concurrent operations and cancels old work when reconnecting", async () => {
    const data = Array<number>(16).fill(0x41);
    const write = api.execute(request(0x12, [1, ...data]));
    const read = api.execute(request(0x11, [1]));
    await write;
    expect((await read).card?.data).toEqual(data);
    const pending = api.execute(request(0x10));
    const cancelled = expect(pending).rejects.toThrow(/连接|取消/);
    await api.disconnect();
    await api.connect(config);
    await cancelled;
    expect((await api.snapshot()).lastCard?.data).toBeNull();
    expect((await api.execute(request(0x11, [1]))).card?.data).not.toEqual(
      data,
    );
  });

  it("connects with one configuration read and supported demo defaults", async () => {
    await api.clearLogs();
    await api.connect({ ...config, address: 0x7f });
    const snapshot = await api.snapshot();
    expect(
      snapshot.logs
        .filter((entry) => entry.direction === "tx")
        .map((entry) => entry.command),
    ).toEqual([0x31]);
    expect(snapshot.configuration).toMatchObject({
      moduleId: 0x7f,
      baudRate: 115200,
      autoMode: 0,
      autoBlock: 4,
      resetMs: 0,
      antennaGain: 7,
      productMode: 0,
    });
    expect(
      snapshot.logs.find((entry) => entry.command === 0xb1)?.hex,
    ).toContain("隐藏");
    await expect(api.connect({ ...config, baudRate: 9600 })).rejects.toThrow(
      "115200",
    );
  });

  it("reads the selected Cockroach product and persists voice and startup settings", async () => {
    await api.connect({ ...config, simulationProductMode: 1 });
    expect((await api.snapshot()).configuration).toMatchObject({
      productMode: 1,
      autoMode: 3,
    });
    await api.execute(request(0x2e, [3, 13, 8, 5, 1, 9, 8, 0x23, 0x12, 0x54]));
    await api.execute(request(0x32, [0xd0, 7, 0xf4, 1]));
    const readback = await api.execute(request(0x31));
    expect(readback.data.slice(6, 12)).toEqual([3, 8, 5, 1, 9, 8]);
    expect(readback.data.slice(27, 32)).toEqual([0xd0, 7, 0xf4, 1, 1]);
    await api.connect({ ...config, simulationProductMode: 0 });
    expect((await api.snapshot()).configuration?.productMode).toBe(0);
    await api.execute(request(0x32, [0xd0, 7, 0xf4, 1]));
    await api.execute(request(0x2e, [3, 13, 8, 5, 1, 9, 8, 0x23, 0x12, 0x54]));
    const fruitfly = await api.execute(request(0x31));
    expect(fruitfly.data.slice(6, 12)).toEqual([3, 8, 5, 1, 9, 8]);
    expect(fruitfly.data.slice(27, 32)).toEqual([0xd0, 7, 0xf4, 1, 0]);
    for (const percent of [0, 60, 100]) {
      expect((await api.execute(request(0x33, [percent]))).data).toEqual([
        0,
        percent,
      ]);
      expect((await api.execute(request(0x31))).data[32]).toBe(percent);
    }
    expect(() => validateRequest(request(0x33, [101]))).toThrow();
    expect(() => validateRequest(request(0x33, []))).toThrow();
    expect(frame(0, 0x33, [60]).hex).toBe("7F 04 00 33 3C 0B");
  });

  it("releases automatic dedup after reset duration or reapplying the same automatic mode", async () => {
    await api.execute(automatic(0));
    const first = (await api.snapshot()).stats.rx;
    expect((await api.snapshot()).stats.rx).toBe(first);
    await api.execute(automatic(0));
    expect((await api.snapshot()).stats.rx).toBe(first + 2);
    await api.execute(request(0x2f, [100, 0]));
    const timed = (await api.snapshot()).stats.rx;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 101);
    expect((await api.snapshot()).stats.rx).toBe(timed + 1);
    vi.restoreAllMocks();
  });

  it("rejects a conflicting manual block after a queued auto-mode change without transmitting it", async () => {
    const mode = api.execute(automatic(2, [0, 0, 0, 1], 3));
    const conflict = expect(api.execute(request(0x11, [1]))).rejects.toThrow(
      "先关闭自动读取",
    );
    await mode;
    await conflict;
    expect(
      (await api.snapshot()).logs
        .filter((entry) => entry.direction === "tx")
        .map((entry) => entry.command),
    ).toEqual([0x2e]);
    expect((await api.execute(request(0x11, [3]))).card?.block).toBe(3);
    await api.execute(automatic(1));
    expect((await api.execute(request(0x11, [1]))).card?.block).toBe(1);
  });

  it("keeps log history bounded and refuses disconnected simulation controls", async () => {
    for (let i = 0; i < 1050; i++) await api.setSimulationCard(i % 2 === 0);
    expect((await api.snapshot()).logs).toHaveLength(1000);
    await api.disconnect();
    await expect(api.setSimulationCard(true)).rejects.toThrow("连接模拟设备");
    await expect(api.nextSimulationCard()).rejects.toThrow("连接模拟设备");
  });

  it("never silently replaces a requested serial connection with simulation", async () => {
    await expect(
      api.connect({ ...config, simulation: false, port: "COM1" }),
    ).rejects.toThrow("桌面应用");
    await api.disconnect();
    await expect(api.execute(request(0x10))).rejects.toThrow("未连接");
  });
});
