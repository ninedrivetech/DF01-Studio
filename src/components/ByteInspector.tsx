import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  Copy,
  Eraser,
} from "lucide-react";
import { Button, IconButton } from "./ui";
import {
  BYTE_ENCODINGS,
  decodeBytes,
  encodeBlock,
  encodeBytes,
  formatHex,
  visibleText,
} from "../lib/encoding";
import type { ByteEncoding } from "../lib/encoding";
import "./byte-inspector.css";

function ByteGrid({
  data,
  payloadLength = data.length,
}: {
  data: number[];
  payloadLength?: number;
}) {
  return (
    <div className="byte-grid" aria-label="原始字节">
      {data.map((byte, index) => (
        <span
          className={
            index >= payloadLength ? "byte-cell byte-padding" : "byte-cell"
          }
          key={index}
        >
          <small>{index.toString(16).toUpperCase().padStart(2, "0")}</small>
          <code>{byte.toString(16).toUpperCase().padStart(2, "0")}</code>
        </span>
      ))}
    </div>
  );
}

export function ByteInspector({
  data,
  compact = false,
}: {
  data: number[];
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<ByteEncoding[]>([
    "hex",
    "gbk",
    "utf-8",
  ]);
  const [hideNul, setHideNul] = useState(true);
  const [copied, setCopied] = useState<ByteEncoding | null>(null);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  const readings = useMemo(
    () =>
      selected.map((encoding) => {
        try {
          const raw = decodeBytes(data, encoding);
          const isText = encoding !== "hex" && encoding !== "base64";
          const text = isText && hideNul ? raw.replace(/\0+$/, "") : raw;
          const hidden = raw.length - text.length;
          return {
            encoding,
            text,
            display: isText ? visibleText(text) : text,
            hidden,
            error: "",
          };
        } catch (error) {
          return {
            encoding,
            text: "",
            display: "",
            hidden: 0,
            error: (error as Error).message,
          };
        }
      }),
    [data, selected, hideNul],
  );

  return (
    <div
      className={`byte-inspector ${compact ? "byte-inspector-compact" : ""}`}
    >
      <div className="byte-toolbar">
        <strong>
          数据解码 <span>{data.length} 字节</span>
        </strong>
        <label className="byte-toggle">
          <input
            type="checkbox"
            checked={hideNul}
            onChange={(event) => setHideNul(event.target.checked)}
          />
          隐藏尾部 NUL
        </label>
      </div>
      {!compact && data.length > 0 && <ByteGrid data={data} />}
      <fieldset className="byte-formats" aria-label="查看编码">
        {BYTE_ENCODINGS.map(({ value, label }) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? BYTE_ENCODINGS.filter(
                        (entry) =>
                          entry.value === value ||
                          selected.includes(entry.value),
                      ).map((entry) => entry.value)
                    : selected.filter((entry) => entry !== value),
                )
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="byte-readings">
        {readings.map(({ encoding, text, display, hidden, error }) => (
          <div
            className={`byte-reading ${error ? "byte-reading-invalid" : ""}`}
            key={encoding}
          >
            <span className="byte-reading-label">
              {BYTE_ENCODINGS.find((entry) => entry.value === encoding)!.label}
            </span>
            <div className="byte-reading-value">
              {error ? (
                <span className="byte-decode-error">
                  <AlertCircle size={14} />
                  {error}
                </span>
              ) : (
                <code>{display || "（空）"}</code>
              )}
              {hidden > 0 && <small>尾部 {hidden} 个 NUL 已隐藏</small>}
            </div>
            <IconButton
              label={`复制 ${BYTE_ENCODINGS.find((entry) => entry.value === encoding)!.label} 结果`}
              disabled={Boolean(error) || data.length === 0}
              onClick={() => {
                setCopyError("");
                void navigator.clipboard
                  .writeText(text)
                  .then(() => setCopied(encoding))
                  .catch(() => setCopyError("无法访问剪贴板"));
              }}
            >
              {copied === encoding ? <Check size={15} /> : <Copy size={15} />}
            </IconButton>
          </div>
        ))}
        {selected.length === 0 && <p className="byte-empty">未选择编码</p>}
      </div>
      <span className="byte-copy-status" aria-live="polite">
        {copyError || (copied ? "已复制" : "")}
      </span>
    </div>
  );
}

export interface ByteComposerProps {
  onApply: (bytes: number[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialData?: number[];
  disabled?: boolean;
  applyLabel?: string;
}

export function ByteComposer({
  onApply,
  onDirtyChange,
  initialData,
  disabled = false,
  applyLabel = "应用到写入区",
}: ByteComposerProps) {
  const inputId = useId();
  const [encoding, setEncoding] = useState<ByteEncoding>("hex");
  const [input, setInput] = useState(() =>
    initialData ? formatHex(initialData) : "",
  );
  const [applied, setApplied] = useState(false);
  const [formatError, setFormatError] = useState("");
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const initialHex = initialData ? formatHex(initialData) : undefined;
  useEffect(() => {
    if (initialHex === undefined) return;
    setEncoding("hex");
    setInput(initialHex);
    setApplied(false);
    setFormatError("");
    dirtyCallback.current?.(false);
  }, [initialHex]);
  const preview = useMemo(() => {
    try {
      return { value: encodeBlock(input, encoding), error: "" };
    } catch (error) {
      return { value: null, error: (error as Error).message };
    }
  }, [input, encoding]);
  const error = formatError || preview.error;

  return (
    <div className="byte-composer">
      <div className="byte-toolbar">
        <label className="byte-encoding-select">
          <span>输入编码</span>
          <select
            aria-label="写入内容编码"
            value={encoding}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value as ByteEncoding;
              const binary = (value: ByteEncoding) =>
                value === "hex" || value === "base64";
              try {
                if (binary(encoding) || binary(next)) {
                  const converted = decodeBytes(
                    encodeBytes(input, encoding),
                    next,
                  );
                  setInput(
                    binary(next) ? converted : converted.replace(/\0+$/, ""),
                  );
                }
              } catch (conversionError) {
                setFormatError((conversionError as Error).message);
                return;
              }
              setFormatError("");
              setEncoding(next);
              setApplied(false);
              dirtyCallback.current?.(true);
            }}
          >
            {BYTE_ENCODINGS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <IconButton
          label="清空转换内容"
          disabled={disabled || input.length === 0}
          onClick={() => {
            setInput("");
            setApplied(false);
            setFormatError("");
            dirtyCallback.current?.(true);
          }}
        >
          <Eraser size={16} />
        </IconButton>
      </div>
      <label htmlFor={inputId} className="byte-input-label">
        转换内容
      </label>
      <textarea
        id={inputId}
        rows={3}
        value={input}
        disabled={disabled}
        spellCheck={false}
        className={encoding === "hex" || encoding === "base64" ? "mono" : ""}
        aria-invalid={Boolean(error)}
        aria-describedby={`${inputId}-status`}
        onChange={(event) => {
          setInput(event.target.value);
          setApplied(false);
          setFormatError("");
          dirtyCallback.current?.(true);
        }}
      />
      <div
        className={`byte-composer-status ${error ? "byte-composer-error" : ""}`}
        id={`${inputId}-status`}
        aria-live="polite"
      >
        {error ? (
          <>
            <AlertCircle size={15} />
            {error}
          </>
        ) : (
          <>
            <span>{preview.value!.payloadLength} / 16 字节</span>
            <span>
              {preview.value!.paddingLength > 0
                ? `补零 ${preview.value!.paddingLength} 字节`
                : "完整数据块"}
            </span>
          </>
        )}
      </div>
      <div className="byte-write-preview">
        <span className="byte-input-label">写入字节预览</span>
        {preview.value ? (
          <ByteGrid
            data={preview.value.bytes}
            payloadLength={preview.value.payloadLength}
          />
        ) : (
          <p className="byte-empty">数据格式无效</p>
        )}
      </div>
      <div className="byte-composer-actions">
        <span aria-live="polite" className="byte-applied">
          {applied && (
            <>
              <Check size={14} />
              已应用
            </>
          )}
        </span>
        <Button
          disabled={
            disabled ||
            Boolean(error) ||
            !preview.value ||
            preview.value.payloadLength === 0
          }
          onClick={() => {
            if (!preview.value || disabled || error) return;
            onApply([...preview.value.bytes]);
            setApplied(true);
            dirtyCallback.current?.(false);
          }}
        >
          <ArrowDownToLine size={16} />
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
