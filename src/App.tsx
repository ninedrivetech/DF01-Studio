import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Cable,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  Grid2X2,
  KeyRound,
  Layers3,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Monitor,
  Moon,
  Palette,
  Pause,
  Play,
  Plug,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Sun,
  Terminal,
  TimerReset,
  Trash2,
  Unplug,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { api, errorMessage, hex, isDesktop, parseHex } from "./lib/api";
import { COMMAND_NAMES, EMPTY_SNAPSHOT } from "./lib/types";
import { Workbench } from "./components/Workbench";
import { ByteInspector, ByteComposer } from "./components/ByteInspector";
import { WindowControls } from "./components/WindowControls";
import { MemoryMap } from "./components/MemoryMap";
import { NumberInput } from "./components/NumberInput";
import { SerialPortPicker } from "./components/SerialPortPicker";
import "./components/memory-workspace.css";
import { GainEasterEgg } from "./components/GainEasterEgg";
import { LogExportDialog } from "./components/LogExportDialog";
import { createLogExport } from "./lib/log-export";
import type { LogExport } from "./lib/log-export";
import {
  isSoundMuted,
  playReportSound,
  setSoundMuted,
  unlockAudio,
} from "./lib/audio";
import { createReportSoundTracker } from "./lib/report-sound";
import {
  isNightTheme,
  loadPreferences,
  PREFERENCES_KEY,
  selectTheme,
  toggleAppearance,
} from "./lib/appearance";
import type { Preferences, Theme } from "./lib/appearance";
import type {
  Card,
  CommandRequest,
  CommandResult,
  ConnectConfig,
  LogEntry,
  Snapshot,
} from "./lib/types";
import {
  Button,
  ConfirmDialog,
  Empty,
  Field,
  IconButton,
  Section,
} from "./components/ui";
import type { Confirmation } from "./components/ui";
const appIcon = new URL("../src-tauri/icons/icon.png", import.meta.url).href;

type Page = "overview" | "memory" | "keys" | "device" | "logs" | "appearance";
const DAISY_THEMES: Record<Theme, string> = {
  light: "corporate",
  graphite: "business",
  forest: "emerald",
  contrast: "black",
};
interface BlockRecord {
  block: number;
  data: number[];
  uid: string;
  timestamp: number;
}
const NAV = [
  {
    id: "overview" as const,
    label: "读卡工作台",
    icon: ScanLine,
    subtitle: "卡片识别与实时状态",
  },
  {
    id: "memory" as const,
    label: "数据块",
    icon: Grid2X2,
    subtitle: "卡片存储空间",
  },
  {
    id: "keys" as const,
    label: "密钥管理",
    icon: KeyRound,
    subtitle: "模块认证密钥",
  },
  {
    id: "device" as const,
    label: "设备配置",
    icon: SlidersHorizontal,
    subtitle: "通信与自动方式",
  },
  {
    id: "logs" as const,
    label: "通信日志",
    icon: Terminal,
    subtitle: "命令收发记录",
  },
  {
    id: "appearance" as const,
    label: "外观设置",
    icon: Palette,
    subtitle: "个性化工作空间",
  },
];
const THEMES: {
  id: Theme;
  name: string;
  icon: typeof Sun;
}[] = [
  {
    id: "light",
    name: "琥珀标本",
    icon: Sun,
  },
  {
    id: "graphite",
    name: "夜航观测",
    icon: Moon,
  },
  {
    id: "forest",
    name: "苔原微光",
    icon: Layers3,
  },
  {
    id: "contrast",
    name: "高对比",
    icon: Monitor,
  },
];
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const time = (value: number) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label}必须为 ${min}–${max} 的整数`);
  return value;
};

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [prefs, setPrefs] = useState(loadPreferences);
  const [soundMuted, setMuted] = useState(isSoundMuted);
  const [hasNewReport] = useState(createReportSoundTracker);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [config, setConfig] = useState<ConnectConfig>({
    port: "",
    baudRate: 115200,
    address: 0,
    timeoutMs: 1500,
    simulation: !isDesktop,
    profile: "current",
  });
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const [latestBlock, setLatestBlock] = useState<Card | null>(null);
  const [block, setBlock] = useState(1);
  const [editor, setEditor] = useState<string[]>(Array(16).fill("00"));
  const [records, setRecords] = useState<Record<number, BlockRecord>>({});
  const [editorDirty, setEditorDirty] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const [composerEpoch, setComposerEpoch] = useState(0);
  const [editorMode, setEditorMode] = useState<"hex" | "text">("hex");
  const [batch, setBatch] = useState<{ current: number; total: number } | null>(
    null,
  );
  const cancelBatch = useRef(false);
  const [keyA, setKeyA] = useState("");
  const [keyB, setKeyB] = useState("");
  const [sameKey, setSameKey] = useState(true);
  const [showKeys, setShowKeys] = useState(false);
  const [resetMs, setResetMs] = useState(0);
  const [antennaGain, setAntennaGain] = useState(4);
  const [gainCelebration, setGainCelebration] = useState(0);
  const [newAddress, setNewAddress] = useState(0);
  const [autoMode, setAutoMode] = useState(0);
  const [autoBlock, setAutoBlock] = useState(1);
  const [memoryKind, setMemoryKind] = useState<"classic" | "pages">("classic");
  const [pageNumber, setPageNumber] = useState(0);
  const [pageData, setPageData] = useState<{
    data: number[];
    page: number;
    uid: string;
  } | null>(null);
  const [logQuery, setLogQuery] = useState("");
  const [logFilter, setLogFilter] = useState("all");
  const [pausedLogs, setPausedLogs] = useState<LogEntry[] | null>(null);
  const [logExport, setLogExport] = useState<LogExport | null>(null);
  const [preview, setPreview] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastReportTimestamp = useRef(0);
  const connected = snapshot.connection.connected;
  const fullCapabilities = connected;
  const currentPage = NAV.find((n) => n.id === page)!;
  const notify = useCallback(
    (message: string, error = false) => setNotice({ message, error }),
    [],
  );
  const refresh = useCallback(async () => {
    const next = await api.snapshot();
    setSnapshot(next);
    return next;
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = DAISY_THEMES[prefs.theme];
    document.documentElement.style.colorScheme = isNightTheme(prefs.theme)
      ? "dark"
      : "light";
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.motion = prefs.motion;
  }, [prefs.theme, prefs.density, prefs.motion]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    } catch {
      notify("外观设置无法保存到本地", true);
    }
  }, [prefs, notify]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let failed = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.snapshot();
        if (active) {
          setSnapshot(next);
          failed = false;
        }
      } catch (e) {
        if (active && !failed) {
          notify(errorMessage(e), true);
          failed = true;
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 450);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [notify]);
  useEffect(() => {
    if (!connected) {
      cancelBatch.current = true;
      setLatestBlock(null);
    }
  }, [connected]);
  useEffect(() => {
    if (snapshot === EMPTY_SNAPSHOT) return;
    const fresh = hasNewReport(snapshot.logs);
    if (fresh && snapshot.connection.connected) playReportSound();
  }, [snapshot, hasNewReport]);
  useEffect(() => {
    if (!connected) return;
    const card = snapshot.lastCard;
    setLatestBlock((previous) =>
      card?.data ? card : previous?.uidHex === card?.uidHex ? previous : null,
    );
  }, [connected, snapshot.lastCard]);
  useEffect(() => {
    const card = snapshot.lastCard;
    if (
      batch ||
      !card ||
      card.timestamp === lastReportTimestamp.current ||
      !card.data ||
      card.block === null
    )
      return;
    lastReportTimestamp.current = card.timestamp;
    if (
      card.cardType === "Ultralight" ||
      memoryKind === "pages" ||
      card.block > 63
    ) {
      setPageData({ page: card.block, data: card.data, uid: card.uidHex });
      return;
    }
    const record = {
      block: card.block,
      data: card.data,
      uid: card.uidHex,
      timestamp: card.timestamp,
    };
    setRecords((previous) => ({
      ...Object.fromEntries(
        Object.entries(previous).filter(
          ([, value]) => value.uid === card.uidHex,
        ),
      ),
      [record.block]: record,
    }));
  }, [snapshot.lastCard, memoryKind, batch]);
  useEffect(() => {
    const onError = (e: PromiseRejectionEvent) => {
      notify(errorMessage(e.reason), true);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onError);
    return () => window.removeEventListener("unhandledrejection", onError);
  }, [notify]);

  async function run(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      try {
        await refresh();
      } catch (e) {
        notify(errorMessage(e), true);
      } finally {
        busyRef.current = false;
        setBusy("");
      }
    }
  }
  async function execute(request: CommandRequest, silent = false) {
    const result = await api.execute(request);
    setLastResult(result);
    if (result.status !== 0) {
      if (!silent || result.status !== 255) notify(result.message, true);
      return result;
    }
    if (!silent) notify(`${COMMAND_NAMES[request.command]}成功`);
    if (result.card?.data && result.card.block !== null) {
      const card = result.card;
      if (card.cardType === "Ultralight" || card.block! > 63) {
        setPageData({ page: card.block!, data: card.data!, uid: card.uidHex });
        return result;
      }
      const record = {
        block: card.block!,
        data: card.data!,
        uid: card.uidHex,
        timestamp: card.timestamp,
      };
      setRecords((r) => ({
        ...Object.fromEntries(
          Object.entries(r).filter(([, value]) => value.uid === card.uidHex),
        ),
        [record.block]: record,
      }));
    }
    return result;
  }
  const saved = snapshot.configuration;
  useEffect(() => {
    if (saved) {
      setNewAddress(saved.moduleId);
      setConfig((c) => ({ ...c, address: saved.moduleId }));
    }
  }, [saved?.moduleId, connected]);
  useEffect(() => {
    if (saved) setAutoMode(saved.autoMode);
  }, [saved?.autoMode, connected]);
  useEffect(() => {
    if (saved) setAutoBlock(saved.autoBlock);
  }, [saved?.autoBlock, saved?.autoMode, connected]);
  useEffect(() => {
    if (saved) setResetMs(saved.resetMs);
  }, [saved?.resetMs, connected]);
  useEffect(() => {
    if (saved) setAntennaGain(saved.antennaGain);
  }, [saved?.antennaGain, connected]);

  const saveGain = () =>
    void run("设置天线增益", async () => {
      integer(antennaGain, 0, 7, "增益档位");
      await execute({ command: 0x30, parameters: [antennaGain] });
    });
  const changeGain = (value: number) => {
    if (value === 7 && antennaGain !== 7) {
      unlockAudio();
      setGainCelebration((previous) => previous + 1);
    }
    setAntennaGain(value);
  };
  const saveReset = () =>
    void run("设置防重读时长", async () => {
      integer(resetMs, 0, 3000, "防重读时长");
      if (resetMs > 0 && resetMs < 100)
        throw new Error("防重读时长必须为 0 或 100–3000 ms");
      await execute({
        command: 0x2f,
        parameters: [resetMs & 255, resetMs >>> 8],
      });
    });

  const applyAutoMode = async (
    mode: number,
    target = snapshot.configuration?.autoBlock ?? snapshot.autoBlock ?? 1,
  ) => {
    if (mode !== 2)
      target = snapshot.configuration?.autoBlock ?? snapshot.autoBlock ?? 1;
    integer(target, 0, 255, "块号");
    return execute({
      command: 0x2e,
      parameters: [
        mode,
        mode + 10,
        target,
        ...(snapshot.configuration?.autoInitialValue ?? [0, 0, 0, 1]),
        0x23,
        0x12,
        0x54,
      ],
    });
  };

  const prepareManualBlockRead = async () => {
    if (snapshot.autoMode !== 2) return;
    const result = await applyAutoMode(1);
    if (result.status !== 0) throw new Error("关闭自动读取失败，已取消读取");
  };

  const confirm = (
    title: string,
    description: string,
    action: () => void,
    details?: string,
    danger = false,
  ) => {
    setConfirmation({
      title,
      description,
      details,
      danger,
      onCancel: () => setConfirmation(null),
      onConfirm: () => {
        setConfirmation(null);
        action();
      },
    });
  };
  const copy = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .then(() => notify("已复制"))
      .catch(() => notify("无法访问剪贴板", true));
  const changePage = (next: Page) => {
    const action = () => {
      setPage(next);
      setMenuOpen(false);
      setComposerDirty(false);
      mainRef.current?.scrollTo({ top: 0 });
    };
    if (next !== page && composerDirty)
      confirm("放弃未应用的编码内容？", "编码草稿尚未载入写入区。", action);
    else action();
  };
  const selectBlock = (next: number) => {
    const apply = () => {
      setBlock(next);
      setEditor(
        (records[next]?.data ?? Array(16).fill(0)).map((b) =>
          b.toString(16).padStart(2, "0").toUpperCase(),
        ),
      );
      setEditorDirty(false);
      setComposerDirty(false);
      setComposerEpoch((value) => value + 1);
      setPreview("");
    };
    if (editorDirty || composerDirty)
      confirm(
        "放弃未写入的数据？",
        `块 ${block} 的编辑内容尚未写入卡片。`,
        apply,
      );
    else apply();
  };
  const readBlock = () => {
    const action = () =>
      void run("读取数据块", async () => {
        await prepareManualBlockRead();
        const result = await execute({ command: 17, parameters: [block] });
        if (result.status === 0 && result.card?.data) {
          if (result.card.cardType === "Ultralight") {
            setMemoryKind("pages");
            return;
          }
          setEditor(
            result.card.data.map((b) =>
              b.toString(16).padStart(2, "0").toUpperCase(),
            ),
          );
          setEditorDirty(false);
          setComposerDirty(false);
          setComposerEpoch((value) => value + 1);
        }
      });
    if (editorDirty || composerDirty)
      confirm(
        "替换当前编辑内容？",
        "读取结果将替换当前未写入的编辑内容。",
        action,
      );
    else action();
  };
  function writeRequest(): CommandRequest {
    if (composerDirty)
      throw new Error("请先应用编码内容到写入区，再预览或写入");
    return {
      command: 18,
      parameters: [block, ...parseHex(editor.join(" "), 16)],
      confirmedWrite: block % 4 === 3,
    };
  }
  const writeBlock = () => {
    try {
      const request = writeRequest();
      confirm(
        `写入块 ${block}`,
        block % 4 === 3
          ? "这是扇区控制块，包含密钥和访问条件。错误的访问位可能使整个扇区永久不可访问。"
          : "将覆盖此块的 16 字节内容。请保持目标卡片在读卡器感应区内。",
        () =>
          void run("写入数据块", async () => {
            const result = await execute(request);
            if (result.status === 0) {
              setEditorDirty(false);
              setRecords((r) => {
                const next = { ...r };
                delete next[block];
                return next;
              });
            }
          }),
        block % 4 === 3
          ? `扇区 ${Math.floor(block / 4)} · 控制块 ${block}`
          : hex(request.parameters.slice(1)),
        true,
      );
    } catch (e) {
      notify(errorMessage(e), true);
    }
  };
  const batchRead = (all: boolean) => {
    cancelBatch.current = false;
    void run("批量读取", async () => {
      if (snapshot.autoMode !== 1) {
        const result = await applyAutoMode(1);
        if (result.status !== 0)
          throw new Error("关闭自动读取失败，批量读取已取消");
      }
      const blocks = all
        ? Array.from({ length: 64 }, (_, i) => i)
        : Array.from({ length: 4 }, (_, i) => Math.floor(block / 4) * 4 + i);
      let uid: string | null = null;
      let completed = 0;
      try {
        for (const b of blocks) {
          if (cancelBatch.current) break;
          setBatch({ current: completed, total: blocks.length });
          const result = await api.execute({ command: 17, parameters: [b] });
          setLastResult(result);
          if (result.status !== 0 || !result.card?.data)
            throw new Error(`块 ${b}：${result.message}`);
          lastReportTimestamp.current = result.card.timestamp;
          if (uid && uid !== result.card.uidHex)
            throw new Error("检测到卡片变更，批量读取已停止");
          uid = result.card.uidHex;
          const card = result.card;
          setRecords((r) => ({
            ...Object.fromEntries(
              Object.entries(r).filter(
                ([, value]) => value.uid === card.uidHex,
              ),
            ),
            [b]: {
              block: b,
              data: card.data!,
              uid: card.uidHex,
              timestamp: card.timestamp,
            },
          }));
          completed++;
        }
        notify(
          `${cancelBatch.current ? "已停止" : "读取完成"}，已读取 ${completed} 个块`,
        );
      } finally {
        setBatch(null);
      }
    });
  };
  const activeLogs = (pausedLogs ?? snapshot.logs).filter(
    (log) =>
      (logFilter === "all" ||
        log.direction === logFilter ||
        (logFilter === "error" && ["warning", "error"].includes(log.level))) &&
      `${log.hex} ${log.message}`
        .toLowerCase()
        .includes(logQuery.toLowerCase()),
  );
  const exportLogs = () => {
    const directions: Record<string, string> = {
      all: "全部记录",
      tx: "发送 TX",
      rx: "接收 RX",
      system: "系统事件",
      error: "异常",
    };
    const scope = [
      directions[logFilter],
      logQuery && `搜索：${logQuery}`,
      pausedLogs && "已暂停的记录",
    ]
      .filter(Boolean)
      .join(" · ");
    setLogExport(createLogExport(activeLogs, snapshot.connection, scope));
  };
  const exportMemory = () =>
    download(
      `df01-memory-${Date.now()}.json`,
      JSON.stringify(
        {
          format: "df01-memory-v1",
          blocks: Object.values(records).filter((r) => r.block % 4 !== 3),
        },
        null,
        2,
      ),
    );
  const importMemory = async (file: File) => {
    try {
      if (file.size > 128000) throw new Error("文件超过 128 KB");
      const value = JSON.parse(await file.text());
      if (
        value.format !== "df01-memory-v1" ||
        !Array.isArray(value.blocks) ||
        value.blocks.length > 64
      )
        throw new Error("不是有效的数据块文件");
      const record = value.blocks.find((r: BlockRecord) => r.block === block);
      if (
        !record ||
        !Array.isArray(record.data) ||
        record.data.length !== 16 ||
        record.data.some(
          (b: number) => !Number.isInteger(b) || b < 0 || b > 255,
        )
      )
        throw new Error(`文件中没有有效的块 ${block} 数据`);
      const apply = () => {
        setEditor(
          record.data.map((b: number) =>
            b.toString(16).padStart(2, "0").toUpperCase(),
          ),
        );
        setEditorDirty(true);
        setComposerDirty(false);
        setComposerEpoch((value) => value + 1);
        setPreview("");
        notify(`块 ${block} 已载入编辑器，尚未写入卡片`);
      };
      if (editorDirty || composerDirty)
        confirm("替换当前编辑内容？", "导入的块内容将覆盖当前草稿。", apply);
      else apply();
    } catch (e) {
      notify(errorMessage(e), true);
    }
  };

  return (
    <div
      className="app-shell"
      onPointerDownCapture={unlockAudio}
      onKeyDownCapture={unlockAudio}
    >
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol">
            <img src={appIcon} alt="" width="41" height="41" />
          </div>
          <div>
            <strong>果蝇1号</strong>
            <small>DF-01 · FIELD STATION</small>
          </div>
        </div>
        <div className="workspace-label">
          观测工作区 <span>01</span>
        </div>
        <nav aria-label="主导航">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              onClick={() => changePage(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {page === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="module-mark">
            <Radio size={21} />
            <div>
              <strong>DF-01 / UART</strong>
              <small>ISO 14443 A · B</small>
            </div>
          </div>
          <div className="version">
            <span>感知 · 解码 · 控制</span>
            <span>v1.0.0</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="打开导航"
              className="mobile-menu"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </IconButton>
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{currentPage.label}</strong>
          </div>
          <div className="topbar-actions">
            <IconButton
              label={soundMuted ? "取消全局静音" : "全局静音"}
              aria-pressed={soundMuted}
              onClick={() => {
                const next = !soundMuted;
                setSoundMuted(next);
                setMuted(next);
              }}
            >
              {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </IconButton>
            <IconButton
              label={
                isNightTheme(prefs.theme) ? "切换到日间主题" : "切换到夜间主题"
              }
              onClick={() => setPrefs(toggleAppearance)}
            >
              {isNightTheme(prefs.theme) ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </IconButton>
            <WindowControls onError={(message) => notify(message, true)} />
          </div>
        </header>
        <main
          id="main-content"
          ref={mainRef}
          className={
            page === "memory"
              ? "memory-page"
              : page === "overview"
                ? "workbench-page"
                : page === "appearance"
                  ? "appearance-page"
                  : `tool-page ${page}-page`
          }
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                DF-01 WORKSTATION{" "}
                <span>
                  /{" "}
                  {String(NAV.findIndex((n) => n.id === page) + 1).padStart(
                    2,
                    "0",
                  )}
                </span>
              </div>
              <h1>{currentPage.label}</h1>
            </div>
            <div className={`connection-badge ${connected ? "online" : ""}`}>
              <span className="status-dot" />
              {connected
                ? snapshot.connection.simulation
                  ? "模拟设备已连接"
                  : "设备在线"
                : "设备未连接"}
            </div>
          </div>
          <section
            className={`connection-strip ${connected ? "is-connected" : ""} ${connectionExpanded ? "expanded" : ""}`}
            aria-label="串口连接"
          >
            {connected && (
              <div className="connection-summary">
                <div>
                  <strong>
                    {snapshot.connection.simulation
                      ? "模拟设备"
                      : snapshot.connection.port}
                  </strong>
                  <span>
                    115200 · ID{" "}
                    {snapshot.connection.address
                      .toString(16)
                      .padStart(2, "0")
                      .toUpperCase()}
                  </span>
                </div>
                <IconButton
                  label={connectionExpanded ? "收起连接参数" : "展开连接参数"}
                  aria-expanded={connectionExpanded}
                  onClick={() => setConnectionExpanded((value) => !value)}
                >
                  <Settings2 size={17} />
                </IconButton>
              </div>
            )}
            <div className="connection-icon">
              <Cable size={22} />
            </div>
            <Field label="连接方式">
              <select
                aria-label="连接方式"
                value={config.simulation ? "simulation" : "serial"}
                disabled={connected || !!busy}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    simulation: e.target.value === "simulation",
                    baudRate: 115200,
                  }))
                }
              >
                <option value="serial">串口设备</option>
                <option value="simulation">模拟设备</option>
              </select>
            </Field>
            <SerialPortPicker
              value={config.port}
              onChange={(port) => setConfig((c) => ({ ...c, port }))}
              disabled={connected || !!busy}
              simulation={config.simulation}
            />
            <Field label="波特率">
              <input aria-label="连接波特率" value="115200" readOnly />
            </Field>
            <Field label="地址">
              <NumberInput
                aria-label="连接地址"
                min={0}
                max={255}
                value={connected ? snapshot.connection.address : config.address}
                disabled={connected || !!busy}
                onValueChange={(address) =>
                  setConfig((c) => ({ ...c, address }))
                }
              />
            </Field>
            <Button
              variant={connected ? "secondary" : "primary"}
              disabled={!!busy}
              onClick={() =>
                void run(connected ? "断开连接" : "连接设备", async () => {
                  if (connected) {
                    await api.disconnect();
                    notify("连接已断开");
                  } else {
                    integer(config.address, 0, 255, "地址");
                    integer(config.timeoutMs, 100, 15000, "超时");
                    if (!config.simulation && !config.port.trim())
                      throw new Error("请选择或输入串口");
                    await api.connect(config);
                    setConnectionExpanded(false);
                    setRecords({});
                    setLastResult(null);
                    setEditor(Array(16).fill("00"));
                    setEditorDirty(false);
                    setComposerDirty(false);
                    setComposerEpoch((value) => value + 1);
                    setPageData(null);
                    setPreview("");
                    setKeyA("");
                    setKeyB("");
                    setShowKeys(false);
                    notify(
                      config.simulation ? "模拟设备已连接" : "串口连接成功",
                    );
                  }
                })
              }
            >
              {connected ? <Unplug size={17} /> : <Plug size={17} />}
              {connected ? "断开连接" : "连接设备"}
            </Button>
          </section>
          <div className="protocol-strip">
            <ShieldCheck size={14} />
            <span>果蝇1号 · DF-01</span>
            <span>115200 · 8N1</span>
            <span>
              {snapshot.configuration
                ? "配置已同步"
                : connected
                  ? "配置未同步"
                  : "等待连接"}
            </span>
          </div>
          <div className="page-content" key={page}>
            {page === "overview" && (
              <Workbench
                snapshot={snapshot}
                busy={busy}
                lastResult={lastResult}
                latestBlock={latestBlock}
                settings={{
                  mode: autoMode,
                  block: autoBlock,
                  gain: antennaGain,
                  resetMs,
                  onModeChange: setAutoMode,
                  onBlockChange: setAutoBlock,
                  onGainChange: changeGain,
                  onResetChange: setResetMs,
                  onApplyMode: () =>
                    void run("设置自动方式", async () => {
                      await applyAutoMode(autoMode, autoBlock);
                    }),
                  onApplyGain: saveGain,
                  onApplyReset: saveReset,
                }}
                onCopy={copy}
                onOpenLogs={() => changePage("logs")}
                onRead={() =>
                  void run("读取卡号", async () => {
                    await execute({ command: 16, parameters: [] });
                  })
                }
                onPresence={(present) =>
                  void run("模拟卡片", async () => {
                    await api.setSimulationCard(present);
                  })
                }
                onNextCard={() =>
                  void run("更换模拟卡", async () => {
                    await api.nextSimulationCard();
                  })
                }
              />
            )}
            {page === "memory" && (
              <div className="memory-workspace">
                <div className="memory-modebar">
                  <div className="segmented" aria-label="卡片存储类型">
                    <button
                      className={memoryKind === "classic" ? "active" : ""}
                      onClick={() => setMemoryKind("classic")}
                    >
                      分块卡 / 64 块
                    </button>
                    <button
                      className={memoryKind === "pages" ? "active" : ""}
                      onClick={() => {
                        const action = () => {
                          setMemoryKind("pages");
                          setComposerDirty(false);
                        };
                        if (composerDirty)
                          confirm(
                            "放弃未应用的编码内容？",
                            "编码草稿尚未载入写入区。",
                            action,
                          );
                        else action();
                      }}
                    >
                      分页卡 / 连续读取
                    </button>
                  </div>
                  {memoryKind === "classic" && (
                    <div className="toolbar-actions">
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".json,application/json"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void importMemory(file);
                          e.target.value = "";
                        }}
                      />
                      <IconButton
                        label="导入当前块到编辑器"
                        disabled={!!busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        <FileUp size={18} />
                      </IconButton>
                      <IconButton
                        label="导出已读数据（不含控制块）"
                        disabled={!Object.keys(records).length}
                        onClick={exportMemory}
                      >
                        <Download size={18} />
                      </IconButton>
                      <Button
                        disabled={!connected || !!busy}
                        onClick={() => batchRead(true)}
                      >
                        <Layers3 size={16} />
                        读取整卡
                      </Button>
                    </div>
                  )}
                </div>
                {memoryKind === "pages" ? (
                  <Section
                    title="连续页读取"
                    className="memory-pages-section"
                    meta={<span className="tag">4 页 / 16 字节</span>}
                  >
                    <div className="page-address">
                      <Field label="起始页（十进制）">
                        <NumberInput
                          aria-label="起始页"
                          min={0}
                          max={255}
                          value={pageNumber}
                          onValueChange={setPageNumber}
                        />
                      </Field>
                      <Button
                        variant="primary"
                        disabled={!connected || !!busy}
                        onClick={() =>
                          void run("读取连续页", async () => {
                            integer(pageNumber, 0, 255, "页号");
                            await prepareManualBlockRead();
                            const result = await api.execute({
                              command: 17,
                              parameters: [pageNumber],
                            });
                            setLastResult(result);
                            if (result.status !== 0 || !result.card?.data)
                              throw new Error(result.message);
                            setPageData({
                              data: result.card.data,
                              page: pageNumber,
                              uid: result.card.uidHex,
                            });
                            notify("连续页读取成功");
                          })
                        }
                      >
                        <ArrowDownLeft size={16} />
                        读取连续页
                      </Button>
                    </div>
                    {snapshot.connection.simulation && (
                      <div className="inline-warning">
                        <Radio size={17} />
                        <span>
                          模拟器当前为分块卡。分页卡 页读取需连接对应实体卡。
                        </span>
                      </div>
                    )}
                    {pageData ? (
                      <>
                        <div className="sector-data">
                          {Array.from({ length: 4 }, (_, index) => (
                            <div key={index}>
                              <span>+{index}</span>
                              <code>
                                {hex(
                                  pageData.data.slice(index * 4, index * 4 + 4),
                                )}
                              </code>
                            </div>
                          ))}
                        </div>
                        <div className="record-origin">
                          起始页 {pageData.page} · 卡号{" "}
                          <code>{pageData.uid}</code>
                          <IconButton
                            label="复制连续页数据"
                            onClick={() => copy(hex(pageData.data))}
                          >
                            <Copy size={14} />
                          </IconButton>
                        </div>
                        <ByteInspector data={pageData.data} compact />
                      </>
                    ) : (
                      <Empty
                        icon={<Layers3 size={27} />}
                        title="尚未读取连续页"
                      />
                    )}
                  </Section>
                ) : (
                  <>
                    {batch && (
                      <div className="batch-progress">
                        <LoaderCircle size={17} className="spin" />
                        <span>
                          正在读取 {batch.current} / {batch.total}
                        </span>
                        <progress value={batch.current} max={batch.total} />
                        <Button
                          onClick={() => {
                            cancelBatch.current = true;
                          }}
                        >
                          <Square size={14} />
                          停止
                        </Button>
                      </div>
                    )}
                    <div className="memory-layout">
                      <MemoryMap
                        block={block}
                        readBlocks={Object.keys(records).map(Number)}
                        disabled={!!busy}
                        onSelect={selectBlock}
                      />
                      <div className="block-editor-column">
                        <section className="section memory-block-section">
                          <header className="memory-block-heading">
                            <div className="memory-block-identity">
                              <h2>{`块 ${String(block).padStart(2, "0")}`}</h2>
                              <span
                                className={`tag ${block % 4 === 3 ? "warning" : ""}`}
                              >
                                {block === 0
                                  ? "只读 · 制造商块"
                                  : block % 4 === 3
                                    ? "扇区控制块"
                                    : `扇区 ${Math.floor(block / 4)} · 数据块`}
                              </span>
                            </div>
                            <div className="editor-actions">
                              <Button
                                variant="primary"
                                disabled={!connected || !!busy}
                                onClick={readBlock}
                              >
                                <ArrowDownLeft size={16} />
                                读取块
                              </Button>
                              <Button
                                disabled={
                                  !fullCapabilities || !!busy || block === 0
                                }
                                onClick={writeBlock}
                              >
                                <ArrowUpRight size={16} />
                                写入块
                              </Button>
                              <IconButton
                                label="预览写入帧"
                                disabled={block === 0 || !!busy}
                                onClick={() =>
                                  void run("预览命令", async () => {
                                    setPreview(
                                      (await api.preview(writeRequest())).hex,
                                    );
                                  })
                                }
                              >
                                <Search size={17} />
                              </IconButton>
                              <IconButton
                                label="填充零值"
                                disabled={block === 0 || !!busy}
                                onClick={() => {
                                  const apply = () => {
                                    setEditor(Array(16).fill("00"));
                                    setEditorDirty(true);
                                    setComposerDirty(false);
                                    setComposerEpoch((value) => value + 1);
                                    setPreview("");
                                  };
                                  if (composerDirty)
                                    confirm(
                                      "放弃未应用的编码内容？",
                                      "写入区将填充为 16 字节零值。",
                                      apply,
                                    );
                                  else apply();
                                }}
                              >
                                <Square size={16} />
                              </IconButton>
                            </div>
                          </header>
                          <div className="editor-toolbar">
                            <div className="segmented" aria-label="编辑格式">
                              <button
                                className={editorMode === "hex" ? "active" : ""}
                                onClick={() => setEditorMode("hex")}
                              >
                                HEX
                              </button>
                              <button
                                className={
                                  editorMode === "text" ? "active" : ""
                                }
                                onClick={() => setEditorMode("text")}
                              >
                                编码输入
                              </button>
                            </div>
                            <span className="section-meta">
                              {composerDirty
                                ? "编码草稿尚未应用"
                                : editorDirty
                                  ? "有未写入的修改"
                                  : records[block]
                                    ? `读取于 ${time(records[block].timestamp)}`
                                    : "尚未读取"}
                            </span>
                          </div>
                          <div hidden={editorMode !== "hex"}>
                            <div className="hex-editor">
                              {editor.map((value, i) => (
                                <label className="byte-field" key={i}>
                                  <span>
                                    {i
                                      .toString(16)
                                      .padStart(2, "0")
                                      .toUpperCase()}
                                  </span>
                                  <input
                                    aria-label={`字节 ${i}`}
                                    value={value}
                                    maxLength={2}
                                    disabled={
                                      block === 0 || !!busy || composerDirty
                                    }
                                    spellCheck={false}
                                    onChange={(e) => {
                                      const next = e.target.value.toUpperCase();
                                      if (/^[0-9A-F]{0,2}$/.test(next)) {
                                        setEditor((values) =>
                                          values.map((v, index) =>
                                            index === i ? next : v,
                                          ),
                                        );
                                        setEditorDirty(true);
                                      }
                                    }}
                                    onBlur={() =>
                                      setEditor((values) =>
                                        values.map((v) => v.padStart(2, "0")),
                                      )
                                    }
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                          <div hidden={editorMode !== "text"}>
                            <ByteComposer
                              key={`${block}-${composerEpoch}`}
                              disabled={block === 0 || !!busy}
                              onDirtyChange={setComposerDirty}
                              initialData={editor.map((value) =>
                                parseInt(value || "0", 16),
                              )}
                              onApply={(bytes) => {
                                setEditor(
                                  bytes.map((b) =>
                                    b
                                      .toString(16)
                                      .padStart(2, "0")
                                      .toUpperCase(),
                                  ),
                                );
                                setEditorDirty(true);
                                setComposerDirty(false);
                                setPreview("");
                                notify("编码内容已载入，尚未写入卡片");
                              }}
                            />
                          </div>
                          <ByteInspector
                            compact
                            data={editor.map((value) =>
                              parseInt(value || "0", 16),
                            )}
                          />
                          {block % 4 === 3 && (
                            <div className="inline-warning">
                              <LockKeyhole size={17} />
                              <span>
                                字节 0–5：Key A · 6–9：访问条件 · 10–15：Key B
                              </span>
                            </div>
                          )}
                          {preview && (
                            <div className="frame-preview">
                              <span>TX</span>
                              <code>{preview}</code>
                            </div>
                          )}
                        </section>
                        <Section
                          title="当前扇区"
                          className="memory-sector-section"
                          meta={
                            <Button
                              variant="ghost"
                              disabled={!connected || !!busy}
                              onClick={() => batchRead(false)}
                            >
                              <RefreshCw size={15} />
                              读取扇区
                            </Button>
                          }
                        >
                          <div className="sector-data">
                            {Array.from({ length: 4 }, (_, i) => {
                              const b = Math.floor(block / 4) * 4 + i;
                              return (
                                <div key={b}>
                                  <span>{String(b).padStart(2, "0")}</span>
                                  <code>
                                    {records[b]
                                      ? b % 4 === 3
                                        ? "控制块内容已隐藏"
                                        : hex(records[b].data)
                                      : "尚未读取"}
                                  </code>
                                  {records[b] && (
                                    <Check size={14} className="success-text" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {records[block] && (
                            <div className="record-origin">
                              来源卡号 <code>{records[block].uid}</code>
                            </div>
                          )}
                        </Section>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {page === "keys" && (
              <div className="settings-layout">
                <Section
                  title="模块认证密钥"
                  icon={<KeyRound size={16} />}
                  className="tool-panel keys-editor"
                  meta={<span className="section-meta">Key A / Key B</span>}
                >
                  <p className="panel-description">
                    输入 6 字节认证密钥，装载后保存到读卡模块。
                  </p>
                  <div className="key-form">
                    <Field label="Key A · 6 字节">
                      <input
                        aria-label="Key A"
                        className="mono"
                        type={showKeys ? "text" : "password"}
                        placeholder="FF FF FF FF FF FF"
                        autoComplete="off"
                        spellCheck={false}
                        value={keyA}
                        onChange={(e) => setKeyA(e.target.value)}
                      />
                    </Field>
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={sameKey}
                        onChange={(e) => setSameKey(e.target.checked)}
                      />
                      <span className="switch-track" />
                      Key B 与 Key A 相同
                    </label>
                    <Field label="Key B · 6 字节">
                      <input
                        aria-label="Key B"
                        className="mono"
                        type={showKeys ? "text" : "password"}
                        autoComplete="off"
                        value={sameKey ? keyA : keyB}
                        disabled={sameKey}
                        onChange={(e) => setKeyB(e.target.value)}
                      />
                    </Field>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={showKeys}
                        onChange={(e) => setShowKeys(e.target.checked)}
                      />
                      显示密钥
                    </label>
                    <div className="form-actions">
                      <Button
                        variant="primary"
                        disabled={!fullCapabilities || !!busy}
                        onClick={() => {
                          try {
                            const a = parseHex(keyA, 6);
                            const b = parseHex(sameKey ? keyA : keyB, 6);
                            confirm(
                              "装载模块密钥",
                              "新密钥会保存到模块，断电后仍然有效。此操作不直接修改卡片上的密钥。",
                              () =>
                                void run("装载密钥", async () => {
                                  const result = await execute({
                                    command: 43,
                                    parameters: [...a, ...b, 0, 3, 8, 5, 2, 7],
                                  });
                                  if (result.status === 0) {
                                    setKeyA("");
                                    setKeyB("");
                                    setShowKeys(false);
                                  }
                                }),
                              "Key A：6 字节\nKey B：6 字节",
                              true,
                            );
                          } catch (e) {
                            notify(errorMessage(e), true);
                          }
                        }}
                      >
                        <KeyRound size={17} />
                        装载密钥
                      </Button>
                      <Button
                        onClick={() => {
                          setKeyA("");
                          setKeyB("");
                        }}
                      >
                        清空输入
                      </Button>
                    </div>
                  </div>
                </Section>
                <Section
                  title="密钥状态"
                  icon={<ShieldCheck size={16} />}
                  className="tool-panel keys-status"
                >
                  <div className="security-visual">
                    <ShieldCheck size={24} />
                    <strong>设备持久化存储</strong>
                  </div>
                  <dl className="session-details">
                    <dt>Key A 长度</dt>
                    <dd>6 字节</dd>
                    <dt>Key B 长度</dt>
                    <dd>6 字节</dd>
                    <dt>保存位置</dt>
                    <dd>读卡模块</dd>
                    <dt>配置同步</dt>
                    <dd>{snapshot.configuration ? "已读取" : "未同步"}</dd>
                    <dt>当前 Key A</dt>
                    <dd className="mono">
                      {snapshot.configuration
                        ? showKeys
                          ? hex(snapshot.configuration.keyA)
                          : "••••••••••••"
                        : "未同步"}
                    </dd>
                    <dt>当前 Key B</dt>
                    <dd className="mono">
                      {snapshot.configuration
                        ? showKeys
                          ? hex(snapshot.configuration.keyB)
                          : "••••••••••••"
                        : "未同步"}
                    </dd>
                  </dl>
                </Section>
              </div>
            )}
            {page === "device" && (
              <div className="device-settings">
                <Section
                  title="通信参数"
                  icon={<Settings2 size={16} />}
                  className="tool-panel communication-panel"
                  meta={
                    <Button
                      disabled={!connected || !!busy}
                      onClick={() =>
                        void run("读取配置", async () => {
                          await execute({ command: 0x31, parameters: [] });
                        })
                      }
                    >
                      <RefreshCw size={14} />
                      读取配置
                    </Button>
                  }
                >
                  <div className="saved-configuration">
                    <div>
                      <span>模块 ID</span>
                      <strong>
                        {snapshot.configuration
                          ? "0x" +
                            snapshot.configuration.moduleId
                              .toString(16)
                              .padStart(2, "0")
                              .toUpperCase()
                          : "未同步"}
                      </strong>
                    </div>
                    <div>
                      <span>模块波特率</span>
                      <strong>
                        {snapshot.configuration?.baudRate ?? "未同步"}
                      </strong>
                    </div>
                    <div>
                      <span>防重读</span>
                      <strong>
                        {snapshot.configuration
                          ? snapshot.configuration.resetMs === 0
                            ? "无限期"
                            : snapshot.configuration.resetMs + " ms"
                          : "未同步"}
                      </strong>
                    </div>
                    <div>
                      <span>天线增益</span>
                      <strong>
                        {snapshot.configuration
                          ? [18, 23, 18, 23, 33, 38, 43, 48][
                              snapshot.configuration.antennaGain
                            ] + " dB"
                          : "未同步"}
                      </strong>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>模块地址</h3>
                      <p>地址范围 0–255，默认地址为 0。</p>
                    </div>
                    <div className="setting-controls">
                      <Field label="新地址">
                        <NumberInput
                          min={0}
                          max={255}
                          value={newAddress}
                          disabled={!!busy}
                          onValueChange={setNewAddress}
                        />
                      </Field>
                      <Button
                        disabled={!fullCapabilities || !!busy}
                        onClick={() => {
                          try {
                            integer(newAddress, 0, 255, "地址");
                            confirm(
                              "修改模块地址",
                              "响应成功后，本机将使用新地址发送命令。",
                              () =>
                                void run("设置地址", async () => {
                                  await execute({
                                    command: 45,
                                    parameters: [newAddress, 0x37, 0x21, 0x56],
                                  });
                                }),
                              `${snapshot.connection.address} → ${newAddress}`,
                            );
                          } catch (e) {
                            notify(errorMessage(e), true);
                          }
                        }}
                      >
                        应用
                      </Button>
                    </div>
                  </div>
                </Section>
                <Section
                  title="模块自动方式"
                  icon={<Zap size={16} />}
                  className="tool-panel automatic-panel"
                  meta={
                    <span className="tag">
                      {snapshot.autoMode === null
                        ? "当前模式未知"
                        : ["自动读卡号", "自动读取已关闭", "自动读数据块"][
                            snapshot.autoMode
                          ]}
                    </span>
                  }
                >
                  <div className="auto-form">
                    <Field label="自动模式">
                      <select
                        aria-label="自动模式"
                        disabled={!!busy}
                        value={autoMode}
                        onChange={(e) => setAutoMode(Number(e.target.value))}
                      >
                        <option value="0">00 · 自动读卡号</option>
                        <option value="1">01 · 关闭自动读取</option>
                        <option value="2">02 · 自动读数据块</option>
                      </select>
                    </Field>
                    <Field label="目标块 / 页">
                      <NumberInput
                        aria-label="自动读取块号"
                        min={0}
                        max={255}
                        disabled={autoMode !== 2 || !!busy}
                        value={autoBlock}
                        onValueChange={setAutoBlock}
                      />
                    </Field>
                    <Field label="保留字段">
                      <input
                        value={hex(
                          snapshot.configuration?.autoInitialValue ?? [
                            0, 0, 0, 1,
                          ],
                        )}
                        readOnly
                      />
                    </Field>
                    <Button
                      disabled={!connected || !!busy}
                      onClick={() => {
                        try {
                          integer(autoMode, 0, 2, "模式");
                          if (autoMode === 2)
                            integer(autoBlock, 0, 255, "块号");
                          confirm(
                            "设置自动方式",
                            "将更新模块的自动读卡行为。",
                            () =>
                              void run("设置自动方式", async () => {
                                await applyAutoMode(autoMode, autoBlock);
                              }),
                            `${["自动读卡号", "关闭自动读取", "自动读数据块"][autoMode]}${autoMode === 2 ? ` · 块 / 页 ${autoBlock}` : ""}`,
                          );
                        } catch (e) {
                          notify(errorMessage(e), true);
                        }
                      }}
                    >
                      <Zap size={16} />
                      应用模式
                    </Button>
                  </div>
                </Section>
                <Section
                  title="射频与防重读"
                  icon={<Radio size={16} />}
                  className="tool-panel radio-panel"
                >
                  <div className="setting-row">
                    <div>
                      <h3>防重读 RESET 时长</h3>
                      <p>
                        已保存：
                        {snapshot.configuration
                          ? snapshot.configuration.resetMs === 0
                            ? "无限期"
                            : snapshot.configuration.resetMs + " ms"
                          : "未同步"}
                      </p>
                    </div>
                    <div className="setting-controls">
                      <Field label="时长（ms，0 或 100–3000）">
                        <NumberInput
                          aria-label="防重读时长"
                          disabled={!!busy}
                          min={0}
                          max={3000}
                          value={resetMs}
                          onValueChange={setResetMs}
                        />
                      </Field>
                      <Button
                        disabled={!connected || !!busy}
                        onClick={saveReset}
                      >
                        <Check size={16} />
                        保存时长
                      </Button>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>天线接收增益</h3>
                      <p>
                        已保存：
                        {snapshot.configuration
                          ? "档位 " +
                            snapshot.configuration.antennaGain +
                            " · " +
                            [18, 23, 18, 23, 33, 38, 43, 48][
                              snapshot.configuration.antennaGain
                            ] +
                            " dB"
                          : "未同步"}
                      </p>
                    </div>
                    <div className="setting-controls">
                      <Field
                        label={`增益档位 ${antennaGain} · ${[18, 23, 18, 23, 33, 38, 43, 48][antennaGain]} dB`}
                      >
                        <input
                          type="range"
                          min={0}
                          max={7}
                          step={1}
                          className="gain-slider"
                          aria-label="天线增益"
                          aria-valuetext={`档位 ${antennaGain}，${[18, 23, 18, 23, 33, 38, 43, 48][antennaGain]} dB`}
                          disabled={!!busy}
                          value={antennaGain}
                          onChange={(e) => changeGain(Number(e.target.value))}
                        />
                        <span className="slider-ticks" aria-hidden="true">
                          {Array.from({ length: 8 }, (_, level) => (
                            <span key={level}>{level}</span>
                          ))}
                        </span>
                      </Field>
                      <Button
                        disabled={!connected || !!busy}
                        onClick={saveGain}
                      >
                        <Check size={16} />
                        保存增益
                      </Button>
                    </div>
                  </div>
                </Section>
                <Section
                  title="会话选项"
                  icon={<TimerReset size={16} />}
                  className="tool-panel session-panel"
                >
                  <div className="setting-row">
                    <div>
                      <h3>响应超时</h3>
                      <p>连接前设置，当前连接中不可更改。</p>
                    </div>
                    <Field label="毫秒">
                      <NumberInput
                        aria-label="响应超时"
                        min={100}
                        max={15000}
                        value={config.timeoutMs}
                        disabled={connected}
                        onValueChange={(timeoutMs) =>
                          setConfig((c) => ({
                            ...c,
                            timeoutMs,
                          }))
                        }
                      />
                    </Field>
                  </div>
                </Section>
              </div>
            )}
            {page === "logs" && (
              <Section
                title="收发记录"
                icon={<Terminal size={16} />}
                className="tool-panel logs-panel"
                meta={
                  <span className="section-meta">
                    {activeLogs.length} 条{pausedLogs ? " · 显示已暂停" : ""}
                  </span>
                }
              >
                <div className="log-toolbar">
                  <div className="search-input">
                    <Search size={16} />
                    <input
                      aria-label="搜索日志"
                      placeholder="搜索报文或状态…"
                      value={logQuery}
                      onChange={(e) => setLogQuery(e.target.value)}
                    />
                  </div>
                  <div className="log-filter">
                    <ListFilter size={17} />
                    <select
                      aria-label="日志筛选"
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                    >
                      <option value="all">全部记录</option>
                      <option value="tx">发送 TX</option>
                      <option value="rx">接收 RX</option>
                      <option value="system">系统</option>
                      <option value="error">异常</option>
                    </select>
                  </div>
                  <div className="toolbar-actions">
                    <IconButton
                      label={pausedLogs ? "恢复日志显示" : "暂停日志显示"}
                      onClick={() =>
                        setPausedLogs((v) => (v ? null : [...snapshot.logs]))
                      }
                    >
                      {pausedLogs ? <Play size={17} /> : <Pause size={17} />}
                    </IconButton>
                    <IconButton
                      label="导出筛选日志"
                      disabled={!activeLogs.length}
                      onClick={exportLogs}
                    >
                      <Download size={18} />
                    </IconButton>
                    <IconButton
                      label="清空日志"
                      disabled={!!busy || !snapshot.logs.length}
                      onClick={() =>
                        confirm(
                          "清空通信日志",
                          "清空应用中的全部通信日志记录。",
                          () =>
                            void run("清空日志", async () => {
                              await api.clearLogs();
                              setPausedLogs(null);
                            }),
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </IconButton>
                  </div>
                </div>
                <LogTable
                  logs={activeLogs.slice(-200).reverse()}
                  onCopy={copy}
                />
                <div className="log-footer">
                  <span>
                    显示最近 {Math.min(activeLogs.length, 200)} 条 ·
                    导出包含全部筛选记录
                  </span>
                  <span>
                    <LockKeyhole size={12} />
                    敏感数据已隐藏
                  </span>
                </div>
              </Section>
            )}
            {page === "appearance" && (
              <>
                <Section
                  title="主题"
                  icon={<Palette size={16} />}
                  className="tool-panel appearance-themes"
                  meta={
                    <span className="section-meta">
                      {THEMES.find((t) => t.id === prefs.theme)?.name}
                    </span>
                  }
                >
                  <div className="theme-grid">
                    {THEMES.map(({ id, name, icon: Icon }) => (
                      <button
                        key={id}
                        aria-label={name}
                        aria-pressed={prefs.theme === id}
                        className={`theme-option ${prefs.theme === id ? "selected" : ""}`}
                        onClick={() => setPrefs((p) => selectTheme(p, id))}
                      >
                        <div
                          className="theme-sample"
                          data-theme={DAISY_THEMES[id]}
                          style={{ background: "var(--color-base-200)" }}
                        >
                          <div
                            style={{ background: "var(--color-base-100)" }}
                          />
                          <div className="sample-content">
                            <span
                              style={{ background: "var(--color-primary)" }}
                            />
                            <i
                              style={{ background: "var(--color-base-100)" }}
                            />
                            <i
                              style={{ background: "var(--color-base-100)" }}
                            />
                          </div>
                        </div>
                        <div className="theme-name">
                          <Icon size={17} />
                          <span>{name}</span>
                          {prefs.theme === id && <CheckCircle2 size={18} />}
                        </div>
                        <p className="theme-description">
                          {
                            {
                              light: "暖纸与琥珀，留住每次发现",
                              graphite: "深青与薄荷，专注夜间观测",
                              forest: "苔绿与浅雾，安静的实验角落",
                              contrast: "清晰边界，鲜明的信号",
                            }[id]
                          }
                        </p>
                      </button>
                    ))}
                  </div>
                </Section>
                <Section
                  title="显示偏好"
                  icon={<SlidersHorizontal size={16} />}
                  className="tool-panel appearance-preferences"
                >
                  <div className="setting-row">
                    <div>
                      <h3>界面密度</h3>
                      <p>调整控件与内容的间距</p>
                    </div>
                    <div className="segmented">
                      <button
                        aria-pressed={prefs.density === "comfortable"}
                        className={
                          prefs.density === "comfortable" ? "active" : ""
                        }
                        onClick={() =>
                          setPrefs((p) => ({ ...p, density: "comfortable" }))
                        }
                      >
                        舒适
                      </button>
                      <button
                        aria-pressed={prefs.density === "compact"}
                        className={prefs.density === "compact" ? "active" : ""}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, density: "compact" }))
                        }
                      >
                        紧凑
                      </button>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>动态效果</h3>
                      <p>设置界面过渡与彩蛋动画</p>
                    </div>
                    <select
                      aria-label="动态效果"
                      value={prefs.motion}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          motion: e.target.value as Preferences["motion"],
                        }))
                      }
                    >
                      <option value="system">跟随系统</option>
                      <option value="full">完整动画</option>
                      <option value="reduced">减少动态效果</option>
                    </select>
                  </div>
                </Section>
                <div className="about-band">
                  <div className="brand-symbol">
                    <img src={appIcon} alt="" width="41" height="41" />
                  </div>
                  <div>
                    <strong>果蝇1号 · DF-01</strong>
                    <span>微小感知，清晰可见 · 1.0.0</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          <span>
            {notice.error ? (
              <ShieldCheck size={19} />
            ) : (
              <CheckCircle2 size={19} />
            )}
          </span>
          <p>{notice.message}</p>
          <IconButton label="关闭提示" onClick={() => setNotice(null)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      <ConfirmDialog value={confirmation} />
      {logExport && (
        <LogExportDialog value={logExport} onClose={() => setLogExport(null)} />
      )}
      {gainCelebration > 0 && <GainEasterEgg key={gainCelebration} />}
    </div>
  );
}

function LogTable({
  logs,
  onCopy,
}: {
  logs: LogEntry[];
  onCopy: (value: string) => void;
}) {
  if (!logs.length)
    return <Empty icon={<Terminal size={30} />} title="暂无通信记录" />;
  return (
    <div className="log-table-wrap">
      <table className="log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>方向</th>
            <th>报文 / 事件</th>
            <th>状态</th>
            <th>
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="mono">{time(log.timestamp)}</td>
              <td>
                <span className={`direction ${log.direction}`}>
                  {log.direction === "tx" ? (
                    <ArrowUpRight size={12} />
                  ) : log.direction === "rx" ? (
                    <ArrowDownLeft size={12} />
                  ) : (
                    <Activity size={12} />
                  )}
                  {log.direction === "system"
                    ? "SYS"
                    : log.direction.toUpperCase()}
                </span>
              </td>
              <td>
                <code>{log.hex || log.message}</code>
                {log.hex && (
                  <small>
                    {log.command !== null
                      ? (COMMAND_NAMES[log.command & 0x7f] ?? "设备上报")
                      : log.message}
                  </small>
                )}
              </td>
              <td>
                <span className={`log-state ${log.level}`}>
                  {log.level === "error"
                    ? "错误"
                    : log.level === "warning"
                      ? "注意"
                      : log.level === "success"
                        ? "成功"
                        : log.direction === "tx"
                          ? "已发送"
                          : "记录"}
                </span>
              </td>
              <td>
                <IconButton
                  label="复制报文"
                  onClick={() => onCopy(log.hex || log.message)}
                >
                  <Copy size={14} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
