import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileText, Folder, X } from "lucide-react";
import { Button, IconButton } from "./ui";
import { errorMessage } from "../lib/api";
import {
  logExportDirectory,
  logFilename,
  saveLogExport,
} from "../lib/log-export";
import type { LogExport } from "../lib/log-export";
import "./log-export.css";

export function LogExportDialog({
  value,
  onClose,
}: {
  value: LogExport;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [name, setName] = useState(value.name);
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{
    path: string | null;
    filename: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    nameRef.current?.focus();
    return () => {
      dialog?.close();
      previousFocus?.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    void logExportDirectory()
      .then((path) => {
        if (active) setDirectory(path);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const save = async () => {
    if (savingRef.current) return;
    setError("");
    savingRef.current = true;
    setSaving(true);
    try {
      const filename = logFilename(name);
      const path = await saveLogExport(name, value.text);
      setSaved({ path, filename });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="log-export-dialog"
      aria-labelledby="log-export-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!savingRef.current) onClose();
      }}
    >
      <header className="log-export-heading">
        {saved ? <CheckCircle2 size={22} /> : <Download size={22} />}
        <div>
          <h2 id="log-export-title">{saved ? "日志已导出" : "导出通信日志"}</h2>
          <p>{value.count} 条记录 · UTF-8 · .log</p>
        </div>
        <IconButton label="关闭日志导出" onClick={onClose} disabled={saving}>
          <X size={18} />
        </IconButton>
      </header>
      {saved ? (
        <>
          <div className="log-export-success" role="status">
            <FileText size={26} />
            <strong>{saved.path ? "文件已保存" : "已交给浏览器下载"}</strong>
            <p>{saved.path ?? saved.filename}</p>
          </div>
          <footer className="log-export-actions">
            <Button variant="primary" onClick={onClose} autoFocus>
              完成
            </Button>
          </footer>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="log-export-body">
            <label className="field" htmlFor="log-export-name">
              <span id="log-export-name-label">文件名</span>
              <div className="log-export-filename">
                <input
                  id="log-export-name"
                  ref={nameRef}
                  aria-labelledby="log-export-name-label"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={84}
                  disabled={saving}
                  aria-describedby={error ? "log-export-error" : undefined}
                />
                <span aria-hidden="true">.log</span>
              </div>
            </label>
            <div className="log-export-location">
              <Folder size={16} />
              <div>
                <span>保存位置</span>
                <p>{directory || "正在获取下载目录…"}</p>
              </div>
            </div>
            <div className="log-export-scope">
              <span>导出范围</span>
              <p>{value.scope}</p>
              <small>保存当前筛选结果的快照；重名文件会自动编号。</small>
            </div>
            <div className="log-export-preview">
              <span>内容预览</span>
              <pre tabIndex={0} aria-label="日志内容预览">
                {value.text.split("\r\n").slice(0, 24).join("\n")}
              </pre>
              <small>
                预览前 24 行，文件包含全部 {value.count}{" "}
                条记录。敏感数据已隐藏。
              </small>
            </div>
            {error && (
              <p
                className="log-export-error"
                id="log-export-error"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
          <footer className="log-export-actions">
            <Button type="button" onClick={onClose} disabled={saving}>
              取消
            </Button>
            {!directory && error ? (
              <Button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                重新获取保存位置
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                busy={saving}
                disabled={!directory || !name.trim()}
              >
                <Download size={16} />
                保存日志
              </Button>
            )}
          </footer>
        </form>
      )}
    </dialog>
  );
}
