import { t, useLanguage } from "../lib/i18n";
import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";

export function Button({
  children,
  busy,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  useLanguage();
  const themeClass = {
    primary: "btn-primary",
    secondary: "btn-outline",
    danger: "btn-error",
    ghost: "btn-ghost",
  }[variant];
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`btn button ${themeClass} ${variant} ${props.className ?? ""}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  useLanguage();
  return (
    <button
      {...props}
      className={`btn btn-ghost btn-square icon-button ${props.className ?? ""}`}
      title={t(label)}
      aria-label={t(label)}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  useLanguage();
  return (
    <label className="field">
      <span>{t(label)}</span>
      {children}
      {hint && <small>{t(hint)}</small>}
    </label>
  );
}
export function Section({
  title,
  icon,
  meta,
  children,
  className = "",
}: PropsWithChildren<{
  title: string;
  icon?: ReactNode;
  meta?: ReactNode;
  className?: string;
}>) {
  useLanguage();
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <h2>
          {icon}
          {t(title)}
        </h2>
        {meta}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
}) {
  useLanguage();
  return (
    <div className="empty-state">
      {icon}
      <strong>{t(title)}</strong>
      {detail && <span>{t(detail)}</span>}
    </div>
  );
}
export interface Confirmation {
  title: string;
  description: string;
  details?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConfirmDialog({ value }: { value: Confirmation | null }) {
  useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (value) ref.current?.showModal();
    else ref.current?.close();
  }, [value]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(event) => {
        event.preventDefault();
        value?.onCancel();
      }}
      aria-labelledby="confirm-title"
    >
      {value && (
        <>
          <div className="dialog-heading">
            <AlertTriangle size={24} />
            <IconButton label={t("取消")} onClick={value.onCancel}>
              <X size={18} />
            </IconButton>
          </div>
          <h2 id="confirm-title">{t(value.title)}</h2>
          <p>{t(value.description)}</p>
          {value.details && <pre>{t(value.details)}</pre>}
          <div className="dialog-actions">
            <Button onClick={value.onCancel} autoFocus>
              {t("取消")}
            </Button>
            <Button
              variant={value.danger ? "danger" : "primary"}
              onClick={value.onConfirm}
            >
              {t("确认执行")}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
