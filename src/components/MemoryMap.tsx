import { t, useLanguage } from "../lib/i18n";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Layers3, LockKeyhole } from "lucide-react";
import "./memory-map.css";

export interface MemoryMapProps {
  block: number;
  readBlocks: number[];
  disabled: boolean;
  onSelect: (block: number) => void;
}

export function MemoryMap({
  block,
  readBlocks,
  disabled,
  onSelect,
}: MemoryMapProps) {
  useLanguage();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const read = useMemo(
    () =>
      new Set(
        readBlocks.filter(
          (value) => Number.isInteger(value) && value >= 0 && value < 64,
        ),
      ),
    [readBlocks],
  );
  const sector = Math.floor(block / 4);

  useEffect(() => {
    if (expanded || !restoreFocus.current) return;
    restoreFocus.current = false;
    const toggle = toggleRef.current;
    if (
      !toggle?.getClientRects().length ||
      document.querySelector("dialog[open]")
    )
      return;
    toggle.focus();
  }, [expanded]);

  return (
    <section
      className={`memory-map ${expanded ? "is-expanded" : ""}`}
      aria-label={t("存储映射")}
    >
      <div className="memory-map-heading">
        <h2>{t("存储映射")}</h2>
        <span>
          {read.size}
          {t(" / 64 已读")}
        </span>
      </div>
      <button
        ref={toggleRef}
        type="button"
        className="memory-map-toggle"
        aria-label={t(expanded ? "收起存储映射" : "展开存储映射")}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <Layers3 size={18} aria-hidden="true" />
        <span className="memory-map-summary">
          <strong>{t("存储映射")}</strong>
          <span>
            {t("扇区 ")}
            {String(sector).padStart(2, "0")}
            {t(" · 块")} {String(block).padStart(2, "0")}
          </span>
        </span>
        <span className="memory-map-progress">
          {read.size}
          {t(" / 64 已读")}
        </span>
        <ChevronDown
          size={17}
          className="memory-map-chevron"
          aria-hidden="true"
        />
      </button>
      <div
        id={panelId}
        className="memory-map-panel"
        role="group"
        aria-label={t("数据块选择")}
      >
        <div className="block-map-head" aria-hidden="true">
          <span>{t("扇区")}</span>
          {[0, 1, 2, 3].map((offset) => (
            <span key={offset}>{offset}</span>
          ))}
        </div>
        <div className="block-map">
          {Array.from({ length: 16 }, (_, sectorIndex) => (
            <div className="sector-row" key={sectorIndex}>
              <span className="memory-map-sector">
                {String(sectorIndex).padStart(2, "0")}
              </span>
              {Array.from({ length: 4 }, (_, offset) => {
                const value = sectorIndex * 4 + offset;
                const protectedBlock = value === 0 || offset === 3;
                const description =
                  value === 0
                    ? "制造商块（只读）"
                    : offset === 3
                      ? "扇区控制块"
                      : "数据块";
                return (
                  <button
                    type="button"
                    key={value}
                    title={`${t(`块 ${value}`)} · ${t(description)}${read.has(value) ? ` ${t("· 已读取")}` : ""}`}
                    aria-label={t(`选择块 ${value}`)}
                    aria-pressed={block === value}
                    disabled={disabled}
                    onClick={() => {
                      restoreFocus.current = Boolean(
                        toggleRef.current?.getClientRects().length,
                      );
                      onSelect(value);
                      setExpanded(false);
                    }}
                    className={`block-cell ${block === value ? "selected" : ""} ${read.has(value) ? "has-data" : ""} ${offset === 3 ? "trailer" : ""}`}
                  >
                    {protectedBlock && (
                      <LockKeyhole size={11} aria-hidden="true" />
                    )}
                    <span>{String(value).padStart(2, "0")}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="memory-map-legend">
          <span>
            <i className="memory-map-read-dot" aria-hidden="true" />
            {t("已读取")}
          </span>
          <span>
            <LockKeyhole size={12} aria-hidden="true" />
            {t("受保护块")}
          </span>
        </div>
      </div>
    </section>
  );
}
