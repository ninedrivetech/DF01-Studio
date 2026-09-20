import { t, useLanguage } from "../lib/i18n";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui";
import { startGainEffects } from "../lib/gain-effects";

export function GainEasterEgg() {
  useLanguage();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!visible) return;
    const stopEffects = startGainEffects();
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => {
      window.clearTimeout(timer);
      stopEffects();
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="gain-easter-egg" aria-live="polite" aria-atomic="true">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={t("白眼果蝇")}
        width="48"
        height="48"
      >
        <g fill="var(--fly-wing)" stroke="var(--fly-outline)" strokeWidth="2">
          <ellipse
            className="fly-wing"
            cx="30"
            cy="38"
            rx="15"
            ry="27"
            transform="rotate(-40 30 38)"
          />
          <ellipse
            className="fly-wing"
            cx="70"
            cy="38"
            rx="15"
            ry="27"
            transform="rotate(40 70 38)"
          />
        </g>
        <path
          d="M43 51L26 48M57 51L74 48M43 61L25 72M57 61L75 72M45 73L35 88M55 73L65 88"
          fill="none"
          stroke="var(--fly-outline)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <ellipse cx="50" cy="64" rx="12" ry="23" fill="var(--fly-body)" />
        <path
          d="M39 65H61M42 75H58"
          stroke="var(--fly-stripe)"
          strokeWidth="3"
        />
        <ellipse
          cx="50"
          cy="43"
          rx="12"
          ry="16"
          fill="var(--fly-wing)"
          stroke="var(--fly-outline)"
          strokeWidth="2"
        />
        <path
          d="M44 29L39 19M56 29L61 19"
          stroke="var(--fly-outline)"
          strokeWidth="3"
        />
        <circle
          cx="42"
          cy="33"
          r="9"
          fill="#fff"
          stroke="var(--fly-outline)"
          strokeWidth="2"
        />
        <circle
          cx="58"
          cy="33"
          r="9"
          fill="#fff"
          stroke="var(--fly-outline)"
          strokeWidth="2"
        />
      </svg>
      <p>{t("白眼果蝇抖擞精神！")}</p>
      <IconButton label={t("关闭彩蛋")} onClick={() => setVisible(false)}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
