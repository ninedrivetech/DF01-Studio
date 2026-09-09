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
  return (
    <button
      {...props}
      className={`btn btn-ghost btn-square icon-button ${props.className ?? ""}`}
      title={label}
      aria-label={label}
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
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
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
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <h2>
          {icon}
          {title}
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
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
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
            <IconButton label="取消" onClick={value.onCancel}>
              <X size={18} />
            </IconButton>
          </div>
          <h2 id="confirm-title">{value.title}</h2>
          <p>{value.description}</p>
          {value.details && <pre>{value.details}</pre>}
          <div className="dialog-actions">
            <Button onClick={value.onCancel} autoFocus>
              取消
            </Button>
            <Button
              variant={value.danger ? "danger" : "primary"}
              onClick={value.onConfirm}
            >
              确认执行
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
