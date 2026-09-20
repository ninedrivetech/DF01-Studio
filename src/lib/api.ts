import { invoke, isTauri } from "@tauri-apps/api/core";
import { BAUD_RATES, COMMAND_NAMES, EMPTY_SNAPSHOT } from "./types";
import type {
  Card,
  CommandRequest,
  CommandResult,
  ConnectConfig,
  Connection,
  DeviceConfiguration,
  LogEntry,
  Port,
  Preview,
  Snapshot,
} from "./types";

export const isDesktop = isTauri();
export const hex = (bytes: number[]) =>
  bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
export function parseHex(value: string, length?: number): number[] {
  const clean = value.replace(/\s/g, "");
  if (
    !/^(?:[0-9a-fA-F]{2})*$/.test(clean) ||
    (length !== undefined && clean.length !== length * 2)
  )
    throw new Error(
      length
        ? `请输入 ${length} 字节的十六进制数据`
        : "十六进制数据必须由完整字节组成",
    );
  return clean.match(/../g)?.map((v) => parseInt(v, 16)) ?? [];
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String(error.message);
  return typeof error === "string" ? error : "操作失败，请检查连接后重试";
}
export function frame(
  address: number,
  command: number,
  parameters: number[],
): Preview {
  if (!isByte(address) || !isByte(command))
    throw new Error("地址和命令必须为有效字节");
  if (!Array.isArray(parameters) || parameters.length > 252)
    throw new Error("帧参数不能超过 252 字节");
  for (const byte of parameters)
    if (!isByte(byte)) throw new Error("参数必须为有效字节");
  const length = 3 + parameters.length;
  const check = [length, address, command, ...parameters].reduce(
    (a, b) => a ^ b,
    0,
  );
  const wire = [
    0x7f,
    ...[length, address, command, ...parameters, check].flatMap((b) =>
      b === 0x7f ? [b, b] : [b],
    ),
  ];
  return { hex: hex(wire), length: wire.length };
}
export function validateRequest(request: CommandRequest): void {
  const { command, parameters: p } = request;
  if (!isByte(command) || !Object.hasOwn(COMMAND_NAMES, command))
    throw new Error("该命令不在支持范围内");
  if (!Array.isArray(p)) throw new Error("命令参数必须为字节数组");
  for (const byte of p)
    if (!isByte(byte)) throw new Error("参数必须为有效字节");
  const lengths: Record<number, number> = {
    16: 0,
    17: 1,
    18: 17,
    43: 18,
    45: 4,
    46: 10,
    47: 2,
    48: 1,
    49: 0,
    50: 4,
    51: 1,
  };
  if (p.length !== lengths[command]) throw new Error("命令参数长度不正确");
  if (command === 18 && p[0] > 63) throw new Error("写入块号必须在 0–63 之间");
  if (command === 18 && p[0] === 0) throw new Error("制造商块 0 只读");
  if (command === 18 && p[0] % 4 === 3 && !request.confirmedWrite)
    throw new Error("扇区控制块需要二次确认");
  const fixed: Record<number, number[]> = {
    43: [0, 3, 8, 5, 2, 7],
    45: [0x37, 0x21, 0x56],
    46: [0x23, 0x12, 0x54],
  };
  if (
    fixed[command] &&
    hex(p.slice(-fixed[command].length)) !== hex(fixed[command])
  )
    throw new Error("命令确认字节不正确");
  if (command === 46 && (p[0] > 3 || p[1] !== p[0] + 10))
    throw new Error("自动方式仅支持 0、1、2、3，模式校验字节必须为模式 + 0A");
  if (
    command === 46 &&
    p[0] === 3 &&
    (![0, 1, 3, 4, 5].includes(p[3]) || p[4] > 1)
  )
    throw new Error("语音编码或等待参数无效");
  if (
    command === 50 &&
    (p[0] + p[1] * 256 < 200 ||
      p[0] + p[1] * 256 > 10000 ||
      p[2] + p[3] * 256 < 200 ||
      p[2] + p[3] * 256 > 5000)
  )
    throw new Error("缓升时间须为 200–10000 ms，启动延时须为 200–5000 ms");
  if (command === 51 && p[0] > 100)
    throw new Error("初始占空比须为 0–100% 的整数");
  if (command === 47) {
    const resetMs = p[0] + p[1] * 256;
    if (resetMs !== 0 && (resetMs < 100 || resetMs > 3000))
      throw new Error("防重读时长必须为 0 或 100 至 3000 ms");
  }
  if (command === 48 && p[0] > 7) throw new Error("天线增益档位必须为 0 至 7");
}

const isByte = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= 255;
const SIMULATION_UIDS = ["E045AFAB", "AABBCCDD"];
const LOG_LIMIT = 1000;
let demo: Snapshot = structuredClone(EMPTY_SNAPSHOT);
let sequence = 0;
let session = 0;
let reportedUid: string | null = null;
let reportedAt = 0;
let commandActive = false;
let queue: Promise<void> = Promise.resolve();
let queueSize = 0;
let responseTimeoutMs = 1000;

function defaultConfiguration(address: number): DeviceConfiguration {
  return {
    moduleId: address,
    baudRate: 115200,
    autoMode: 0,
    autoBlock: 4,
    autoInitialValue: [1, 0, 0, 0],
    keyA: Array<number>(6).fill(255),
    keyB: Array<number>(6).fill(255),
    resetMs: 0,
    antennaGain: 7,
    productMode: 0,
    rampMs: 2500,
    startupDelayMs: 1000,
    initialDutyPercent: 60,
  };
}
let deviceConfiguration = defaultConfiguration(0);

function configurationBytes(): number[] {
  const c = deviceConfiguration;
  return [
    0,
    c.moduleId,
    0,
    0xc2,
    1,
    0,
    c.autoMode,
    c.autoBlock,
    ...c.autoInitialValue,
    ...c.keyA,
    ...c.keyB,
    c.resetMs & 255,
    c.resetMs >> 8,
    c.antennaGain,
    (c.rampMs ?? 2500) & 255,
    (c.rampMs ?? 2500) >> 8,
    (c.startupDelayMs ?? 1000) & 255,
    (c.startupDelayMs ?? 1000) >> 8,
    c.productMode ?? 0,
    c.initialDutyPercent ?? 60,
  ];
}

function syncConfiguration() {
  demo.configuration = structuredClone(deviceConfiguration);
  demo.autoMode = deviceConfiguration.autoMode;
  demo.autoBlock = deviceConfiguration.autoBlock;
  demo.connection.address = deviceConfiguration.moduleId;
}

function createMemory(): number[][] {
  const blocks = Array.from({ length: 64 }, () => Array<number>(16).fill(0));
  blocks[0] = [
    0xe0, 0x45, 0xaf, 0xab, 0xa1, 8, 4, 0, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
    0x68, 0x69,
  ];
  blocks[1] = Array.from(new TextEncoder().encode("DF-01 FRUITFLY")).concat(
    Array<number>(2).fill(0),
  );
  for (let block = 3; block < 64; block += 4)
    blocks[block] = [
      255, 255, 255, 255, 255, 255, 255, 7, 128, 105, 255, 255, 255, 255, 255,
      255,
    ];
  return blocks;
}
let memories = new Map(SIMULATION_UIDS.map((uid) => [uid, createMemory()]));

function demoCard(uid: string, block: number | null = null): Card {
  const uidBytes = parseHex(uid, 4);
  const uidDecimal = uidBytes
    .slice()
    .reverse()
    .reduce((number, byte) => number * 256 + byte, 0);
  const data = block === null ? null : [...memories.get(uid)![block]];
  if (block === 0 && data) {
    data.splice(0, 4, ...uidBytes);
    data[4] = uidBytes.reduce((checksum, byte) => checksum ^ byte, 0);
  }
  return {
    atqaHex: "04 00",
    uidRawHex: hex(uidBytes),
    uidHex: uidDecimal.toString(16).toUpperCase().padStart(8, "0"),
    uidDecimal: String(uidDecimal),
    cardType: "S50",
    data,
    block,
    timestamp: Date.now(),
  };
}

function autoReport() {
  if (
    deviceConfiguration.resetMs > 0 &&
    Date.now() - reportedAt >= deviceConfiguration.resetMs
  )
    reportedUid = null;
  if (
    commandActive ||
    !demo.connection.connected ||
    !demo.simulationCardPresent ||
    demo.autoMode === null ||
    ![0, 2].includes(demo.autoMode) ||
    reportedUid === demo.simulationUid
  )
    return;
  const block = demo.autoMode === 2 ? demo.autoBlock : null;
  if (demo.autoMode === 2 && (block === null || block > 63)) return;
  const card = demoCard(demo.simulationUid, block);
  const command = block === null ? 0x90 : 0x91;
  const parameters = [
    0,
    4,
    0,
    ...parseHex(demo.simulationUid),
    ...(card.data ?? []),
  ];
  demo.lastCard = card;
  reportedUid = demo.simulationUid;
  reportedAt = Date.now();
  demo.stats.rx++;
  log({
    direction: "rx",
    command,
    hex:
      block !== null && block % 4 === 3
        ? "[自动块上报可能含密钥，帧已隐藏]"
        : frame(demo.connection.address, command, parameters).hex,
    message: "自动上报",
    level: "success",
  });
}

function log(entry: Omit<LogEntry, "id" | "timestamp">) {
  demo.logs.push({ ...entry, id: ++sequence, timestamp: Date.now() });
  if (demo.logs.length > LOG_LIMIT)
    demo.logs.splice(0, demo.logs.length - LOG_LIMIT);
  if (entry.level === "error") demo.stats.errors++;
}

function requireSimulation() {
  if (!demo.connection.connected || !demo.connection.simulation)
    throw new Error("此操作需要连接模拟设备");
}

function validateConfig(config: ConnectConfig) {
  if (![0, 1].includes(config.simulationProductMode ?? 0))
    throw new Error("模拟产品必须为果蝇或偷油婆");
  if (!config.simulation)
    throw new Error("浏览器仅支持模拟设备。请使用桌面应用连接真实串口。");
  if (config.profile !== "current" && config.profile !== "full")
    throw new Error("固件配置必须为 current 或 full");
  if (!isByte(config.address)) throw new Error("地址必须为 0–255 的整数");
  if (!BAUD_RATES.includes(config.baudRate))
    throw new Error("上位机固定使用 115200 bit/s");
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 15000
  )
    throw new Error("应答超时必须在 100 至 15000 ms 之间");
}

const sensitiveRequest = (request: CommandRequest) =>
  request.command === 0x2b ||
  (request.command === 0x12 && request.parameters[0] % 4 === 3);

async function executeLocal(
  request: CommandRequest,
  expectedSession: number,
): Promise<CommandResult> {
  if (session !== expectedSession || !demo.connection.connected)
    throw new Error("设备未连接或连接已变更，待处理命令已取消");
  const { command, parameters: p } = request;
  if (command === 0x33 && demo.configuration?.initialDutyPercent == null)
    throw new Error("当前固件未提供初始占空比，请先读取新版设备配置");
  if (
    (command === 0x32 || (command === 0x2e && p[0] === 3)) &&
    demo.configuration?.productMode !== 0 &&
    demo.configuration?.productMode !== 1
  )
    throw new Error("请先读取支持语音与时序的设备配置");
  if (command === 0x11 && demo.autoMode === 2 && demo.autoBlock !== p[0])
    throw new Error(
      "自动读块与本次目标不同，请先关闭自动读取再读取此块；命令未发送",
    );
  const address = demo.connection.address;
  let uid = demo.simulationUid;
  let present = demo.simulationCardPresent;
  const manualRead = command === 0x10 || command === 0x11;
  if (manualRead) reportedUid = null;
  demo.stats.tx++;
  log({
    direction: "tx",
    command,
    hex: sensitiveRequest(request)
      ? "[敏感数据已隐藏]"
      : frame(address, command, p).hex,
    message: COMMAND_NAMES[command],
    level: "info",
  });
  await new Promise((resolve) => setTimeout(resolve, 90));
  // A disconnected operation must never complete against a newly connected simulator.
  if (session !== expectedSession || !demo.connection.connected)
    throw new Error("连接已关闭，已发送操作的结果未确认");
  if (manualRead) {
    const started = Date.now();
    while (!demo.simulationCardPresent || (command === 0x11 && p[0] > 63)) {
      if (Date.now() - started >= responseTimeoutMs) {
        demo.connection.connected = false;
        throw new Error(
          "等待读卡超时，设备可能仍在等卡或认证；已关闭本次连接以隔离迟到应答，请重新连接",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (session !== expectedSession || !demo.connection.connected)
        throw new Error("连接已关闭，已发送操作的结果未确认");
    }
    uid = demo.simulationUid;
    present = demo.simulationCardPresent;
  }
  if (
    [0x10, 0x11, 0x12].includes(command) &&
    (!present || (command !== 0x10 && p[0] > 63))
  ) {
    const status = present ? 0xfe : 0xff;
    const message = present
      ? "模拟卡为分块卡，块号必须在 0–63 之间"
      : "无卡，请将卡片放入感应区";
    demo.stats.rx++;
    log({
      direction: "rx",
      command: command | 0x80,
      hex: frame(address, command | 0x80, [status, 0, 0, 0, 0, 0, 0]).hex,
      message,
      level: "warning",
    });
    return {
      command,
      status,
      data: [status, 0, 0, 0, 0, 0, 0],
      message,
      card: null,
    };
  }
  let card: Card | null = null;
  let data = [0];
  if ([0x10, 0x11, 0x12].includes(command)) {
    if (command === 0x12) memories.get(uid)![p[0]] = p.slice(1);
    card = demoCard(uid, command === 0x11 ? p[0] : null);
    if (command === 0x12) card.block = p[0];
    demo.lastCard = structuredClone(card);
    data = [0, 4, 0, ...parseHex(uid), ...(card.data ?? [])];
  }
  if (command === 0x2b) {
    deviceConfiguration.keyA = p.slice(0, 6);
    deviceConfiguration.keyB = p.slice(6, 12);
  }
  if (command === 0x2d) deviceConfiguration.moduleId = p[0];
  if (command === 0x2e) {
    deviceConfiguration.autoMode = p[0];
    deviceConfiguration.autoBlock = p[2];
    deviceConfiguration.autoInitialValue = p.slice(3, 7);
    reportedUid = null;
  }
  if (command === 0x2f) {
    deviceConfiguration.resetMs = p[0] + p[1] * 256;
    reportedUid = null;
  }
  if (command === 0x30) {
    deviceConfiguration.antennaGain = p[0];
    data = [0, p[0]];
  }
  if (command === 0x31) data = configurationBytes();
  if (command === 0x33) {
    deviceConfiguration.initialDutyPercent = p[0];
    data = [0, p[0]];
  }
  if (command === 0x32) {
    deviceConfiguration.rampMs = p[0] + p[1] * 256;
    deviceConfiguration.startupDelayMs = p[2] + p[3] * 256;
    data = [0, ...p];
  }
  demo.stats.rx++;
  log({
    direction: "rx",
    command: command | 0x80,
    hex:
      command === 0x31 || (command === 0x11 && p[0] % 4 === 3)
        ? "[密钥配置或控制块内容已隐藏]"
        : frame(command === 0x2d ? p[0] : address, command | 0x80, data).hex,
    message: "操作成功",
    level: "success",
  });
  if (command >= 0x2b) syncConfiguration();
  return { command, status: 0, data, message: "操作成功", card };
}

function enqueue(request: CommandRequest): Promise<CommandResult> {
  validateRequest(request);
  if (!demo.connection.connected)
    return Promise.reject(new Error("设备未连接"));
  if (queueSize >= 9)
    return Promise.reject(new Error("命令队列已满，请等待当前操作完成"));
  const expectedSession = session;
  const queuedRequest = structuredClone(request);
  queueSize++;
  const result = queue.then(async () => {
    commandActive = true;
    try {
      return await executeLocal(queuedRequest, expectedSession);
    } finally {
      commandActive = false;
      queueSize--;
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function local<T>(
  name: string,
  args?: {
    config?: ConnectConfig;
    request?: CommandRequest;
    present?: boolean;
  },
): Promise<T> {
  if (name === "list_ports") return [] as T;
  if (name === "get_snapshot") {
    autoReport();
    return structuredClone(demo) as T;
  }
  if (name === "clear_logs") {
    demo.logs = [];
    return undefined as T;
  }
  if (name === "set_simulation_card") {
    requireSimulation();
    demo.simulationCardPresent = args!.present!;
    log({
      direction: "system",
      command: null,
      hex: "",
      message: args!.present ? "模拟卡片已放入" : "模拟卡片已移开",
      level: "info",
    });
    return undefined as T;
  }
  if (name === "simulate_next_card") {
    requireSimulation();
    demo.simulationUid =
      demo.simulationUid === SIMULATION_UIDS[0]
        ? SIMULATION_UIDS[1]
        : SIMULATION_UIDS[0];
    demo.simulationCardPresent = true;
    log({
      direction: "system",
      command: null,
      hex: "",
      message: "已换入另一张模拟卡片",
      level: "info",
    });
    autoReport();
    return undefined as T;
  }
  if (name === "disconnect_device") {
    const connected = demo.connection.connected;
    session++;
    demo.connection.connected = false;
    if (connected)
      log({
        direction: "system",
        command: null,
        hex: "",
        message: "连接已关闭",
        level: "info",
      });
    return undefined as T;
  }
  if (name === "connect_device") {
    const config = args!.config!;
    validateConfig(config);
    responseTimeoutMs = config.timeoutMs;
    session++;
    demo = {
      ...structuredClone(EMPTY_SNAPSHOT),
      connection: {
        connected: true,
        simulation: true,
        port: "SIMULATOR",
        baudRate: config.baudRate,
        address: config.address,
        profile: config.profile,
      },
      logs: demo.logs,
      stats: demo.stats,
    };
    memories = new Map(SIMULATION_UIDS.map((uid) => [uid, createMemory()]));
    deviceConfiguration = defaultConfiguration(config.address);
    deviceConfiguration.productMode = config.simulationProductMode ?? 0;
    if (deviceConfiguration.productMode === 1) deviceConfiguration.autoMode = 3;
    reportedUid = null;
    log({
      direction: "system",
      command: null,
      hex: "",
      message: "模拟设备已连接",
      level: "success",
    });
    await enqueue({ command: 0x31, parameters: [] });
    return structuredClone(demo.connection) as T;
  }
  const request = args!.request!;
  if (name === "execute_command") return (await enqueue(request)) as T;
  if (name === "preview_command") {
    validateRequest(request);
    const preview = frame(
      demo.connection.address,
      request.command,
      request.parameters,
    );
    return (
      sensitiveRequest(request) ? { ...preview, hex: "[密钥已隐藏]" } : preview
    ) as T;
  }
  throw new Error("未知操作");
}
const call = <T>(name: string, args?: Record<string, unknown>): Promise<T> =>
  isDesktop ? invoke<T>(name, args) : local<T>(name, args);
export const api = {
  listPorts: () => call<Port[]>("list_ports"),
  connect: (config: ConnectConfig) =>
    call<Connection>("connect_device", { config }),
  disconnect: () => call<void>("disconnect_device"),
  snapshot: () => call<Snapshot>("get_snapshot"),
  execute: (request: CommandRequest) =>
    call<CommandResult>("execute_command", { request }),
  preview: (request: CommandRequest) =>
    call<Preview>("preview_command", { request }),
  clearLogs: () => call<void>("clear_logs"),
  setSimulationCard: (present: boolean) =>
    call<void>("set_simulation_card", { present }),
  nextSimulationCard: () => call<void>("simulate_next_card"),
};
