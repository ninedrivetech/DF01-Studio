import { useSyncExternalStore } from "react";
import { english } from "./translations";

export type Language = "zh-CN" | "en";
export const LANGUAGE_KEY = "df01.language";

export function loadLanguage(storage?: Pick<Storage, "getItem">): Language {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(LANGUAGE_KEY) === "en"
      ? "en"
      : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

let language = loadLanguage();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.title =
    language === "en" ? "Fruitfly No. 1 · DF-01" : "果蝇1号 · DF-01";
}
updateDocument();

export function setLanguage(next: Language) {
  language = next;
  try {
    globalThis.localStorage?.setItem(LANGUAGE_KEY, next);
  } catch {
    // Language switching remains available when local storage is blocked.
  }
  updateDocument();
  listeners.forEach((listener) => listener());
}

// Match application-authored dynamic messages without changing stored log data.
// More specific templates precede broad messages such as "{0}成功".
const templates = Object.entries(english)
  .filter(([key]) => /\{\d+\}/.test(key))
  .sort(
    ([a], [b]) =>
      b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length,
  )
  .map(([key, value]) => ({
    pattern: new RegExp(
      "^" +
        key
          .split(/\{\d+\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("(.*?)") +
        "$",
      "s",
    ),
    value,
  }));

export function translate(text: string, locale: Language, depth = 0): string {
  if (locale !== "en" || !/[\u3400-\u9fff]/.test(text)) return text;
  const key = text.trim().replace(/\s+/g, " ");
  let translated = english[key];
  if (translated === undefined && depth < 4) {
    for (const template of templates) {
      const match = key.match(template.pattern);
      if (match) {
        translated = template.value.replace(/\{(\d+)\}/g, (_, index: string) =>
          translate(match[Number(index) + 1], locale, depth + 1),
        );
        break;
      }
    }
  }
  if (translated === undefined) return text;
  return (
    (text.match(/^\s*/)?.[0] ?? "") +
    translated +
    (text.match(/\s*$/)?.[0] ?? "")
  );
}

export function t(text: string): string;
export function t(text: string | null | undefined): string | null | undefined;
export function t(text: string | null | undefined) {
  return typeof text === "string" ? translate(text, language) : text;
}

export function useLanguage() {
  const current = useSyncExternalStore(
    subscribe,
    () => language,
    () => "zh-CN" as const,
  );
  return { language: current, setLanguage, t };
}
