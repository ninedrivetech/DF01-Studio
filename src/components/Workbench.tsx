import { t, useLanguage } from "../lib/i18n";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Copy,
  Fingerprint,
  Pause,
  Play,
  RefreshCw,
  ScanLine,
  Search,
  Terminal,
} from "lucide-react";
import { Button, Empty, IconButton } from "./ui";
import { ByteInspector } from "./ByteInspector";
import { WorkbenchControls } from "./WorkbenchControls";
import type { WorkbenchSettings } from "./WorkbenchControls";
import { COMMAND_NAMES } from "../lib/types";
import { filterLogs } from "../lib/log-filter";
import type { Card, CommandResult, LogEntry, Snapshot } from "../lib/types";
import "./workbench.css";

const timestamp = (value: number) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) +
  "." +
  String(value % 1000).padStart(3, "0");
function TrafficPanel({
  snapshot,
  onCopy,
  onOpenLogs,
}: {
  snapshot: Snapshot;
  onCopy: (value: string) => void;
  onOpenLogs: () => void;
}) {
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("all");
  const [paused, setPaused] = useState<LogEntry[] | null>(null);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const logs = paused ?? snapshot.logs;
  const visible = useMemo(
    () => filterLogs(logs, direction, query, language).slice(-100).reverse(),
    [logs, direction, query, language],
  );
  const connected = snapshot.connection.connected;
  const frame =
    selected ?? visible.find((log) => log.direction !== "system") ?? null;
  return (
    <section className="traffic-workspace" aria-label={t("实时串口通信")}>
      <div className="traffic-overview">
        <div className="traffic-heading">
          <div>
            <Terminal size={18} />
            <h2>{t("实时通信")}</h2>
            <span className={`live-label ${paused ? "paused" : ""}`}>
              {paused ? t("显示已暂停") : connected ? t("实时接收") : t("离线")}
            </span>
          </div>
          <IconButton label={t("全部日志")} onClick={onOpenLogs}>
            <ArrowRight size={18} />
          </IconButton>
        </div>
        <div className="traffic-counters">
          <div className="traffic-counter tx">
            <ArrowUpRight size={16} />
            <span>TX</span>
            <strong>{snapshot.stats.tx}</strong>
          </div>
          <div className="traffic-counter rx">
            <ArrowDownLeft size={16} />
            <span>RX</span>
            <strong>{snapshot.stats.rx}</strong>
          </div>
          <div className="traffic-counter">
            <Activity size={16} />
            <span>{t("异常")}</span>
            <strong className={snapshot.stats.errors ? "danger-text" : ""}>
              {snapshot.stats.errors}
            </strong>
          </div>
        </div>
      </div>
      <div className="traffic-toolbar">
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label={t("搜索实时通信")}
            placeholder={t("搜索报文或事件")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label={t("实时通信筛选")}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="all">{t("全部方向")}</option>
          <option value="tx">{t("发送 TX")}</option>
          <option value="rx">{t("接收 RX")}</option>
          <option value="system">{t("系统事件")}</option>
          <option value="error">{t("异常")}</option>
        </select>
        <IconButton
          label={t(paused ? "恢复实时通信" : "暂停实时通信")}
          onClick={() => setPaused(paused ? null : [...snapshot.logs])}
        >
          {paused ? <Play size={17} /> : <Pause size={17} />}
        </IconButton>
      </div>
      <div className="traffic-columns" aria-hidden="true">
        <span>{t("时间 / 方向")}</span>
        <span>{t("报文与事件")}</span>
      </div>
      <div className="traffic-stream" aria-label={t("实时通信记录")}>
        {!visible.length ? (
          <Empty
            icon={<Terminal size={28} />}
            title={t(logs.length ? "无匹配记录" : "暂无通信记录")}
          />
        ) : (
          visible.map((log) => (
            <button
              key={log.id}
              className={`traffic-row ${log.direction} ${frame?.id === log.id ? "selected" : ""}`}
              aria-pressed={frame?.id === log.id}
              onClick={() => setSelected(log)}
            >
              <span className="traffic-stamp">
                <time>{timestamp(log.timestamp)}</time>
                <span className={`direction ${log.direction}`}>
                  {log.direction === "tx" ? (
                    <ArrowUpRight size={13} />
                  ) : log.direction === "rx" ? (
                    <ArrowDownLeft size={13} />
                  ) : (
                    <Activity size={13} />
                  )}
                  {log.direction === "system"
                    ? "SYS"
                    : log.direction.toUpperCase()}
                </span>
              </span>
              <span className="traffic-payload">
                <span className="traffic-event">
                  <strong>
                    {log.command === null
                      ? t("会话事件")
                      : (t(COMMAND_NAMES[log.command & 0x7f]) ?? t("设备上报"))}
                  </strong>
                  <span
                    className={
                      log.level === "error" || log.level === "warning"
                        ? "danger-text"
                        : "muted"
                    }
                  >
                    {log.message}
                  </span>
                </span>
                <code>{log.hex || ""}</code>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="traffic-detail" aria-label={t("选中报文")}>
        <div className="traffic-detail-heading">
          <strong>{selected ? t("选中报文") : t("最近报文")}</strong>
          <span>{frame ? timestamp(frame.timestamp) : t("等待数据")}</span>
          {selected && (
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t("跟随最新")}
            </Button>
          )}
          <IconButton
            label={t("复制选中报文")}
            disabled={!frame}
            onClick={() => frame && onCopy(frame.hex || frame.message)}
          >
            <Copy size={15} />
          </IconButton>
        </div>
        <code>{frame?.hex || frame?.message || t("暂无报文")}</code>
        {frame?.hex && <p>{frame.message}</p>}
      </div>
    </section>
  );
}

export function Workbench({
  snapshot,
  busy,
  lastResult,
  latestBlock,
  settings,
  onCopy,
  onOpenLogs,
  onRead,
  onPresence,
  onNextCard,
}: {
  snapshot: Snapshot;
  busy: string;
  lastResult: CommandResult | null;
  latestBlock: Card | null;
  settings: WorkbenchSettings;
  onCopy: (value: string) => void;
  onOpenLogs: () => void;
  onRead: () => void;
  onPresence: (present: boolean) => void;
  onNextCard: () => void;
}) {
  useLanguage();
  const card = snapshot.lastCard;
  const connected = snapshot.connection.connected;
  const sensitive =
    latestBlock &&
    (latestBlock.block === null ||
      (latestBlock.block % 4 === 3 && latestBlock.cardType !== "Ultralight"));
  return (
    <div className="workbench">
      <div className="reader-workspace" aria-label={t("卡片与操作")}>
        <section className="reader-summary">
          <div className="reader-identity">
            <div className="reader-summary-heading">
              <h2>{t("卡片识别")}</h2>
              <span className="muted">
                {card ? t("已识别") : t("等待卡片")}
              </span>
            </div>
            <div
              className={`card-identity ${card ? "detected" : ""}`}
              role="img"
              aria-label={t(
                card ? `已识别卡片 ${card.uidHex}` : "等待识别卡片",
              )}
            >
              <Fingerprint size={26} />
              <div>
                <strong>{card?.uidRawHex ?? "-- -- -- --"}</strong>
              </div>
            </div>
          </div>
          <dl className="reader-values">
            <dt>{t("卡号 HEX")}</dt>
            <dd>
              <code>{card?.uidHex ?? "--"}</code>
              <IconButton
                label={t("复制卡号")}
                disabled={!card}
                onClick={() => card && onCopy(card.uidHex)}
              >
                <Copy size={14} />
              </IconButton>
            </dd>
            <dt>{t("卡号 DEC")}</dt>
            <dd className="mono">{card?.uidDecimal ?? "--"}</dd>
            <dt>ATQA</dt>
            <dd className="mono">{card?.atqaHex ?? "--"}</dd>
            <dt>{t("最近读取")}</dt>
            <dd className="mono">{card ? timestamp(card.timestamp) : "--"}</dd>
          </dl>
          <div className="reader-actions-compact">
            <Button
              variant="primary"
              disabled={!connected || !!busy}
              busy={busy === "读取卡号"}
              onClick={onRead}
            >
              <ScanLine size={17} />
              {t("读取卡号")}
            </Button>
            {connected && snapshot.connection.simulation && (
              <section
                className="simulation-controls"
                aria-label={t("模拟卡片")}
              >
                <label className="switch-label">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={snapshot.simulationCardPresent}
                    disabled={!!busy}
                    onChange={(e) => onPresence(e.target.checked)}
                  />
                  <span className="switch-track" />
                  {t("模拟卡片在场")}
                </label>
                <IconButton
                  label={t("换一张卡")}
                  disabled={!!busy}
                  onClick={onNextCard}
                >
                  <RefreshCw size={16} />
                </IconButton>
              </section>
            )}
          </div>
        </section>
      </div>
      <WorkbenchControls
        settings={settings}
        saved={snapshot.configuration}
        connected={connected}
        busy={busy}
      />
      <div className="workbench-analysis">
        <TrafficPanel
          snapshot={snapshot}
          onCopy={onCopy}
          onOpenLogs={onOpenLogs}
        />
        <section className="latest-data" aria-label={t("最近块数据")}>
          <div className="decode-heading">
            <h2>{t("块数据解码")}</h2>
            <span>
              {latestBlock
                ? t(
                    `${latestBlock.block === null ? "来源未知" : `块 / 页 ${latestBlock.block}`} · ${latestBlock.data?.length ?? 0} 字节`,
                  )
                : t("等待接收")}
            </span>
          </div>
          <div className="decode-source">
            <span>
              {latestBlock
                ? t(`卡号 ${latestBlock.uidHex}`)
                : t("自动上报与手动读取的块数据将在这里解码")}
            </span>
            {latestBlock && <time>{timestamp(latestBlock.timestamp)}</time>}
          </div>
          {sensitive ? (
            <Empty
              icon={<Fingerprint size={24} />}
              title={t("敏感块内容已隐藏")}
              detail={t("控制块或来源未知的数据不展示明文。")}
            />
          ) : (
            <ByteInspector data={latestBlock?.data ?? []} compact />
          )}
        </section>
      </div>
      <div
        className={`workbench-result ${lastResult && lastResult.status !== 0 ? "danger-text" : ""}`}
      >
        <span className="status-dot" />
        <span>
          {busy ||
            lastResult?.message ||
            (connected ? t("设备就绪") : t("连接设备后开始观测"))}
        </span>
        <span>{t("DF-01 · 果蝇1号")}</span>
      </div>
    </div>
  );
}
