import { t, useLanguage } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { Port } from "../lib/types";
import { IconButton } from "./ui";

function portLabel(port: Port) {
  const description = port.description?.trim();
  if (!description) return port.name;
  return description.toLowerCase().endsWith(`(${port.name.toLowerCase()})`)
    ? description
    : `${description} (${port.name})`;
}

export function SerialPortPicker({
  value,
  onChange,
  disabled,
  simulation,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  simulation: boolean;
}) {
  useLanguage();
  const [ports, setPorts] = useState<Port[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const picker = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const found = await api.listPorts();
      if (!mounted.current) return;
      setPorts(
        [...new Map(found.map((port) => [port.name, port])).values()].sort(
          (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
        ),
      );
      setError("");
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (disabled || simulation)
      return () => {
        mounted.current = false;
      };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [disabled, simulation, refresh]);
  const missing = value && !ports.some((port) => port.name === value);
  const options = [
    { name: "", label: t("请选择串口"), kind: "" },
    ...(missing
      ? [{ name: value, label: value, kind: t("未检测到 / 手动指定") }]
      : []),
    ...ports.map((port) => ({ ...port, label: portLabel(port) })),
  ];
  const selected = options.find((port) => port.name === value);
  const expanded = open && !disabled && !simulation && !manual;
  useEffect(() => {
    if (disabled || simulation || manual) setOpen(false);
  }, [disabled, simulation, manual]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);
  useEffect(() => {
    if (expanded)
      picker.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);
  return (
    <div
      className="field serial-picker"
      ref={picker}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="serial-label">
        <label htmlFor="serial-port">
          {t("串口")}
          {!simulation && t(` · ${ports.length} 个`)}
        </label>
        <button
          type="button"
          disabled={disabled || simulation}
          onClick={() => setManual((current) => !current)}
        >
          {manual ? t("返回列表") : t("手动输入")}
        </button>
      </div>
      <div className="serial-controls">
        {manual && !simulation ? (
          <input
            id="serial-port"
            aria-label={t("手动串口")}
            placeholder={t("例如 COM3")}
            value={value}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <div className="serial-dropdown">
            <button
              type="button"
              className="serial-trigger"
              id="serial-port"
              role="combobox"
              aria-label={t("串口")}
              aria-expanded={expanded}
              aria-controls={expanded ? "serial-options" : undefined}
              aria-activedescendant={
                expanded
                  ? `serial-option-${options.findIndex((port) => port.name === active)}`
                  : undefined
              }
              title={simulation ? "SIMULATOR" : selected?.label}
              disabled={disabled || simulation}
              onClick={() => {
                setActive(value);
                setOpen(!expanded);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  event.preventDefault();
                  return;
                }
                if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const index = options.findIndex(
                    (port) => port.name === (expanded ? active : value),
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? options.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              options.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                  setActive(options[next].name);
                  setOpen(true);
                } else if (
                  expanded &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  if (options.some((port) => port.name === active))
                    onChange(active);
                  setOpen(false);
                }
              }}
            >
              <span>
                {simulation
                  ? "SIMULATOR"
                  : value
                    ? selected?.label
                    : ports.length
                      ? t("请选择串口")
                      : loading
                        ? t("正在扫描串口…")
                        : t("未发现串口")}
              </span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {expanded && (
              <div
                className="serial-options"
                id="serial-options"
                role="listbox"
                aria-label={t("可用串口")}
              >
                {options.map((port, index) => (
                  <div
                    key={port.name}
                    id={`serial-option-${index}`}
                    role="option"
                    aria-selected={port.name === value}
                    data-active={port.name === active}
                    className="serial-option"
                    onPointerMove={() => setActive(port.name)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange(port.name);
                      setOpen(false);
                    }}
                  >
                    <span className="serial-option-copy">
                      <span>{port.label}</span>
                      {port.kind && <small>{port.kind}</small>}
                    </span>
                    {port.name === value && (
                      <Check size={15} aria-hidden="true" />
                    )}
                  </div>
                ))}
                {!ports.length && (
                  <p className="serial-empty">
                    {loading
                      ? t("正在扫描串口…")
                      : t("未发现串口，请刷新或手动输入")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <IconButton
          label={t("刷新串口")}
          disabled={disabled || simulation || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={loading ? "spin" : undefined} />
        </IconButton>
      </div>
      {error && (
        <small className="number-error" role="alert">
          {t("串口扫描失败：")}
          {t(error)}
          {t("，请刷新重试。")}
        </small>
      )}
    </div>
  );
}
