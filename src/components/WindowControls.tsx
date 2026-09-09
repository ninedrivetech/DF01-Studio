import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, GripHorizontal, Minus, Square, X } from "lucide-react";
import { errorMessage } from "../lib/api";
import "./WindowControls.css";

export interface WindowControlsProps {
  onError?: (message: string) => void;
}

export function WindowControls({ onError }: WindowControlsProps) {
  const native = isTauri();
  const [maximized, setMaximized] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  const pendingRef = useRef(false);
  onErrorRef.current = onError;

  const reportError = useCallback((cause: unknown) => {
    const message = `窗口操作失败：${errorMessage(cause)}`;
    if (onErrorRef.current) onErrorRef.current(message);
    else setError(message);
  }, []);

  useEffect(() => {
    if (!native) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const value = await appWindow.isMaximized();
        if (!disposed) setMaximized(value);
      } catch (cause) {
        if (!disposed) reportError(cause);
      }
    };
    void refresh();
    void appWindow
      .onResized(refresh)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((cause: unknown) => {
        if (!disposed) reportError(cause);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native, reportError]);

  if (!native) return null;

  async function run(action: "minimize" | "toggleMaximize" | "close") {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const appWindow = getCurrentWindow();
      await appWindow[action]();
      if (action === "toggleMaximize") {
        setMaximized(await appWindow.isMaximized());
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <div
        className="window-drag-handle"
        title="拖动窗口"
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          void getCurrentWindow().startDragging().catch(reportError);
        }}
      >
        <GripHorizontal size={16} aria-hidden="true" />
      </div>
      <button
        type="button"
        className="window-control-button"
        aria-label="最小化窗口"
        title="最小化窗口"
        disabled={pending}
        onClick={() => void run("minimize")}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control-button"
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原窗口" : "最大化窗口"}
        disabled={pending}
        onClick={() => void run("toggleMaximize")}
      >
        {maximized ? (
          <Copy size={14} aria-hidden="true" />
        ) : (
          <Square size={14} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="window-control-button window-close-button"
        aria-label="关闭窗口"
        title="关闭窗口"
        disabled={pending}
        onClick={() => void run("close")}
      >
        <X size={17} aria-hidden="true" />
      </button>
      {error && (
        <div className="window-control-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
