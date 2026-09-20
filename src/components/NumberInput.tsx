import { t, useLanguage } from "../lib/i18n";
import { useEffect, useId, useState } from "react";
import type { InputHTMLAttributes } from "react";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "min" | "max"
> & {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  validate?: (value: number) => boolean;
  errorMessage?: string;
};

// Keep the user's draft intact. An empty/invalid draft must never submit the
// previous value (or silently turn into zero).
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  validate,
  errorMessage,
  ...props
}: Props) {
  useLanguage();
  const [draft, setDraft] = useState(
    Number.isFinite(value) ? String(value) : "",
  );
  const [touched, setTouched] = useState(false);
  const errorId = useId();
  useEffect(() => {
    setDraft((current) =>
      current.trim() !== "" && Number(current) === value
        ? current
        : Number.isFinite(value)
          ? String(value)
          : "",
    );
  }, [value]);
  const valid =
    draft.trim() !== "" &&
    Number.isInteger(Number(draft)) &&
    Number(draft) >= min &&
    Number(draft) <= max &&
    (!validate || validate(Number(draft)));
  return (
    <span className="number-field">
      <input
        {...props}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={props.step ?? 1}
        value={draft}
        aria-invalid={touched && !valid}
        aria-describedby={
          [props["aria-describedby"], touched && !valid ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          setTouched(false);
          onValueChange(next.trim() === "" ? Number.NaN : Number(next));
        }}
        onBlur={(event) => {
          setTouched(true);
          if (valid) setDraft(String(Number(draft)));
          props.onBlur?.(event);
        }}
      />
      {touched && !valid && (
        <small id={errorId} className="number-error" aria-live="polite">
          {t(errorMessage ?? `请输入 ${min}–${max} 的整数`)}
        </small>
      )}
    </span>
  );
}
