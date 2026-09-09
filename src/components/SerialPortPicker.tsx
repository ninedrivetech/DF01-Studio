import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { Port } from "../lib/types";
import { IconButton } from "./ui";

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
  const [ports, setPorts] = useState<Port[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
  return (
    <div className="field serial-picker">
      <div className="serial-label">
        <label htmlFor="serial-port">
          串口{!simulation && ` · ${ports.length} 个`}
        </label>
        <button
          type="button"
          disabled={disabled || simulation}
          onClick={() => setManual((current) => !current)}
        >
          {manual ? "返回列表" : "手动输入"}
        </button>
      </div>
      <div className="serial-controls">
        {manual && !simulation ? (
          <input
            id="serial-port"
            aria-label="手动串口"
            placeholder="例如 COM3"
            value={value}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <select
            id="serial-port"
            aria-label="串口"
            value={simulation ? "SIMULATOR" : value}
            disabled={disabled || simulation}
            onChange={(event) => onChange(event.target.value)}
          >
            {simulation ? (
              <option value="SIMULATOR">SIMULATOR</option>
            ) : (
              <>
                <option value="">
                  {ports.length
                    ? "请选择串口"
                    : loading
                      ? "正在扫描串口…"
                      : "未发现串口，请刷新或手动输入"}
                </option>
                {missing && (
                  <option value={value}>{value} · 未检测到 / 手动指定</option>
                )}
                {ports.map((port) => (
                  <option key={port.name} value={port.name}>
                    {port.name} · {port.kind}
                  </option>
                ))}
              </>
            )}
          </select>
        )}
        <IconButton
          label="刷新串口"
          disabled={disabled || simulation || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={loading ? "spin" : undefined} />
        </IconButton>
      </div>
      {error && (
        <small className="number-error" role="alert">
          串口扫描失败：{error}，请刷新重试。
        </small>
      )}
    </div>
  );
}
