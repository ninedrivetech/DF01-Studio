export interface Connection {
  connected: boolean;
  simulation: boolean;
  port: string;
  baudRate: number;
  address: number;
  profile: "current" | "full";
}
export interface ConnectConfig {
  simulationProductMode?: 0 | 1;
  port: string;
  baudRate: number;
  address: number;
  timeoutMs: number;
  simulation: boolean;
  profile: "current" | "full";
}
export interface LogEntry {
  id: number;
  timestamp: number;
  direction: "tx" | "rx" | "system";
  command: number | null;
  hex: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
}
export interface Card {
  atqaHex: string;
  uidRawHex: string;
  uidHex: string;
  uidDecimal: string;
  cardType: string;
  data: number[] | null;
  block: number | null;
  timestamp: number;
}
export interface DeviceConfiguration {
  moduleId: number;
  baudRate: number;
  autoMode: number;
  autoBlock: number;
  autoInitialValue: number[];
  keyA: number[];
  keyB: number[];
  resetMs: number;
  antennaGain: number;
  productMode?: number | null;
  rampMs?: number | null;
  startupDelayMs?: number | null;
  initialDutyPercent?: number | null;
}
export interface Snapshot {
  connection: Connection;
  logs: LogEntry[];
  lastCard: Card | null;
  simulationCardPresent: boolean;
  simulationUid: string;
  autoMode: number | null;
  autoBlock: number | null;
  configuration: DeviceConfiguration | null;
  stats: { tx: number; rx: number; errors: number };
}
export interface CommandRequest {
  command: number;
  parameters: number[];
  confirmedMode?: boolean;
  confirmedWrite?: boolean;
  byteOrder?: "big" | "little";
}
export interface CommandResult {
  command: number;
  status: number;
  data: number[];
  message: string;
  card: Card | null;
}
export interface Port {
  name: string;
  kind: string;
  description?: string | null;
}
export interface Preview {
  hex: string;
  length: number;
}
export const BAUD_RATES = [115200];
export const GAIN_DB = [18, 23, 18, 23, 33, 38, 43, 48] as const;
export const EMPTY_SNAPSHOT: Snapshot = {
  connection: {
    connected: false,
    simulation: false,
    port: "",
    baudRate: 115200,
    address: 0,
    profile: "current",
  },
  logs: [],
  lastCard: null,
  simulationCardPresent: true,
  simulationUid: "E045AFAB",
  autoMode: null,
  autoBlock: null,
  configuration: null,
  stats: { tx: 0, rx: 0, errors: 0 },
};
export const COMMAND_NAMES: Record<number, string> = {
  0x10: "读取卡号",
  0x11: "读取数据块",
  0x12: "写入数据块",
  0x2b: "装载密钥",
  0x2d: "设置地址",
  0x2e: "设置自动方式",
  0x2f: "设置防重读时长",
  0x30: "设置天线增益",
  0x31: "读取全部配置",
  0x32: "设置启动时序",
  0x33: "设置初始占空比",
};
