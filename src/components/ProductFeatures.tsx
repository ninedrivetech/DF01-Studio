import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  RefreshCw,
  Volume2,
  CircleHelp,
  RotateCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { Button, Field, Section } from "./ui";
import { NumberInput } from "./NumberInput";
import { t } from "../lib/i18n";
import type { CommandRequest, DeviceConfiguration } from "../lib/types";
import "./product-features.css";

export function ProductMark({ cockroach }: { cockroach: boolean }) {
  return (
    <svg
      className={`product-mark ${cockroach ? "is-cockroach" : "is-fruitfly"}`}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <g className="insect-wings">
        <ellipse cx="21" cy="29" rx="13" ry="8" transform="rotate(-35 21 29)" />
        <ellipse cx="43" cy="29" rx="13" ry="8" transform="rotate(35 43 29)" />
      </g>
      <g className="insect-legs">
        <path d="M25 29 14 22M24 36 10 37M26 44 16 54M39 29 50 22M40 36 54 37M38 44 48 54" />
      </g>
      <ellipse className="insect-body" cx="32" cy="36" rx="9" ry="15" />
      <path d="M32 24v25M27 20 19 8M37 20 45 8" />
      <circle cx="32" cy="22" r="7" />
      <g className="insect-eyes">
        <circle cx="28" cy="20" r="1.5" />
        <circle cx="36" cy="20" r="1.5" />
      </g>
    </svg>
  );
}

export function ProductFeatures({
  saved,
  simulation = false,
  busy,
  onExecute,
}: {
  saved: DeviceConfiguration;
  simulation?: boolean;
  busy: boolean;
  onExecute: (label: string, request: CommandRequest) => void;
}) {
  const [block, setBlock] = useState(saved.autoBlock);
  const [encoding, setEncoding] = useState(saved.autoInitialValue[0]);
  const [wait, setWait] = useState(saved.autoInitialValue[1] === 1);
  const [ramp, setRamp] = useState(saved.rampMs ?? 2500);
  const [delay, setDelay] = useState(saved.startupDelayMs ?? 1000);
  const [duty, setDuty] = useState(saved.initialDutyPercent ?? 60);
  const [directionDraft, setDirectionDraft] = useState(
    saved.motorDirection ?? null,
  );
  const directionSupported =
    saved.motorDirection === 0 || saved.motorDirection === 1;
  const guide = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setBlock(saved.autoBlock);
    setEncoding(saved.autoInitialValue[0]);
    setWait(saved.autoInitialValue[1] === 1);
  }, [saved.autoBlock, saved.autoInitialValue.join(",")]);
  useEffect(() => {
    setRamp(saved.rampMs ?? 2500);
    setDelay(saved.startupDelayMs ?? 1000);
  }, [saved.rampMs, saved.startupDelayMs]);
  useEffect(
    () => setDuty(saved.initialDutyPercent ?? 60),
    [saved.initialDutyPercent],
  );
  const voiceValid =
    Number.isInteger(block) &&
    block >= 0 &&
    block <= 255 &&
    [0, 1, 3, 4, 5].includes(encoding);
  useEffect(
    () => setDirectionDraft(saved.motorDirection ?? null),
    [saved.motorDirection],
  );
  const timingValid =
    Number.isInteger(ramp) &&
    ramp >= 200 &&
    ramp <= 10000 &&
    Number.isInteger(delay) &&
    delay >= 200 &&
    delay <= 5000;
  return (
    <div className="product-features">
      <section className="product-hero">
        <ProductMark cockroach />
        <div>
          <h2>{t("偷油婆一号")}</h2>
          <p>{t(simulation ? "模拟设备" : "已识别产品模式")} · PRODUCT 01</p>
        </div>
        <div className="product-toolbar">
          <Button
            disabled={busy}
            onClick={() =>
              onExecute("读取配置", { command: 0x31, parameters: [] })
            }
          >
            <RefreshCw size={14} />
            {t("读取配置")}
          </Button>
          <Button onClick={() => guide.current?.showModal()}>
            <CircleHelp size={15} />
            {t("使用说明")}
          </Button>
        </div>
      </section>
      <div className="product-feature-grid">
        <Section
          className="product-voice"
          title={t("TTS 语音播报")}
          icon={<Volume2 size={18} />}
          meta={
            <span className="tag">
              {t(saved.autoMode === 3 ? "语音模式已开启" : "语音模式未开启")}
            </span>
          }
        >
          <div className="product-fields">
            <Field label={t("语音读取块 / 页")}>
              <NumberInput
                aria-label={t("语音读取块 / 页")}
                min={0}
                max={255}
                value={block}
                onValueChange={setBlock}
                disabled={busy}
              />
            </Field>
            <Field label={t("文本编码")}>
              <select
                aria-label={t("文本编码")}
                value={encoding}
                onChange={(e) => setEncoding(Number(e.target.value))}
                disabled={busy}
              >
                {![0, 1, 3, 4, 5].includes(encoding) && (
                  <option value={encoding} disabled>
                    {t("请选择编码")}
                  </option>
                )}
                <option value={0}>GB2312</option>
                <option value={1}>GBK</option>
                <option value={3}>UTF-16LE</option>
                <option value={4}>UTF-16BE</option>
                <option value={5}>UTF-8</option>
              </select>
            </Field>
          </div>
          <label className="product-wait">
            <input
              type="checkbox"
              checked={wait}
              onChange={(e) => setWait(e.target.checked)}
              disabled={busy}
            />
            <span>
              {t("等待本条播报完成再发送下一条")}
              <small>{t("等待回传，最长 10 秒")}</small>
            </span>
          </label>
          <div className="product-actions">
            <Button
              variant="primary"
              disabled={busy || !voiceValid}
              onClick={() =>
                onExecute("保存并开启语音", {
                  command: 0x2e,
                  parameters: [
                    3,
                    13,
                    block,
                    encoding,
                    Number(wait),
                    ...saved.autoInitialValue.slice(2, 4),
                    0x23,
                    0x12,
                    0x54,
                  ],
                })
              }
            >
              {t("保存并开启语音")}
            </Button>
            <Button
              disabled={busy || saved.autoMode !== 3}
              onClick={() =>
                onExecute("关闭语音自动读取", {
                  command: 0x2e,
                  parameters: [
                    1,
                    11,
                    saved.autoBlock,
                    ...saved.autoInitialValue,
                    0x23,
                    0x12,
                    0x54,
                  ],
                })
              }
            >
              {t("关闭语音自动读取")}
            </Button>
          </div>
        </Section>
        <Section
          className="product-timing"
          title={t("缓启动时序")}
          icon={<Clock3 size={18} />}
          meta={<span className="tag">{t("下次启动生效")}</span>}
        >
          <div className="startup-timeline">
            <span>
              <small>{t("启动延时")}</small>
              <strong>{saved.startupDelayMs ?? "—"} ms</strong>
            </span>
            <i />
            <span>
              <small>{t("输出缓升")}</small>
              <strong>
                {saved.initialDutyPercent == null
                  ? "—"
                  : `${saved.initialDutyPercent}%`}{" "}
                → 100%
              </strong>
            </span>
            <i />
            <span>
              <small>{t("缓升时间")}</small>
              <strong>{saved.rampMs ?? "—"} ms</strong>
            </span>
          </div>
          <div className="product-fields">
            <Field label={t("系统启动延时 (ms)")}>
              <NumberInput
                aria-label={t("系统启动延时 (ms)")}
                min={200}
                max={5000}
                value={delay}
                onValueChange={setDelay}
                disabled={busy}
              />
              <small>200–5000 ms</small>
            </Field>
            <Field label={t("电机缓启动时间 (ms)")}>
              <NumberInput
                aria-label={t("电机缓启动时间 (ms)")}
                min={200}
                max={10000}
                value={ramp}
                onValueChange={setRamp}
                disabled={busy}
              />
              <small>200–10000 ms</small>
            </Field>
          </div>
          <p className="product-help">
            {t("已保存时序")} · {saved.startupDelayMs ?? "—"} ms →{" "}
            {saved.rampMs ?? "—"} ms
          </p>
          {saved.initialDutyPercent != null ? (
            <div className="product-fields product-duty">
              <Field label={t("初始占空比 (%)")}>
                <NumberInput
                  aria-label={t("初始占空比 (%)")}
                  min={0}
                  max={100}
                  value={duty}
                  onValueChange={setDuty}
                  disabled={busy}
                />
              </Field>
              <Button
                disabled={
                  busy || !Number.isInteger(duty) || duty < 0 || duty > 100
                }
                onClick={() =>
                  onExecute("设置初始占空比", {
                    command: 0x33,
                    parameters: [duty],
                  })
                }
              >
                {t("保存初始占空比")}
              </Button>
            </div>
          ) : (
            <p className="product-help">{t("旧固件未提供初始占空比设置")}</p>
          )}
          <div className="product-actions">
            <Button
              variant="primary"
              disabled={busy || !timingValid}
              onClick={() =>
                onExecute("保存启动时序", {
                  command: 0x32,
                  parameters: [ramp & 255, ramp >> 8, delay & 255, delay >> 8],
                })
              }
            >
              {t("保存启动时序")}
            </Button>
          </div>
        </Section>
        <Section
          className="product-direction"
          title={t("电机转向")}
          icon={<RotateCw size={18} />}
          meta={<span className="tag">{t("下次启动生效")}</span>}
        >
          <fieldset
            className="direction-options"
            aria-describedby="direction-note"
            disabled={busy || !directionSupported}
          >
            <legend className="sr-only">{t("电机上电方向")}</legend>
            {([0, 1] as const).map((direction) => {
              const Icon = direction === 0 ? RotateCw : RotateCcw;
              return (
                <label
                  key={direction}
                  className={directionDraft === direction ? "is-selected" : ""}
                >
                  <input
                    type="radio"
                    name="motor-direction"
                    aria-label={t(direction === 0 ? "正转" : "反转")}
                    value={direction}
                    checked={directionDraft === direction}
                    onChange={() => setDirectionDraft(direction)}
                  />
                  <Icon size={18} aria-hidden="true" />
                  <span>{t(direction === 0 ? "正转" : "反转")}</span>
                </label>
              );
            })}
          </fieldset>
          <div className="direction-save">
            <p id="direction-note" className="product-help">
              {directionSupported
                ? `${t("已保存方向")} · ${t(saved.motorDirection === 0 ? "正转" : "反转")}`
                : t("旧固件未提供方向设置")}
            </p>
            <Button
              variant="primary"
              disabled={
                busy ||
                !directionSupported ||
                (directionDraft !== 0 && directionDraft !== 1)
              }
              onClick={() => {
                if (directionDraft === 0 || directionDraft === 1)
                  onExecute("设置电机上电方向", {
                    command: 0x34,
                    parameters: [directionDraft],
                  });
              }}
            >
              <Save size={14} />
              {t("保存方向")}
            </Button>
          </div>
        </Section>
      </div>
      <dialog
        ref={guide}
        className="product-guide"
        aria-labelledby="product-guide-title"
      >
        <h2 id="product-guide-title">{t("使用说明")}</h2>
        {simulation && (
          <p>
            {t(
              "模拟器可验证配置保存与回读，不播放硬件语音，也不执行实际缓启动。",
            )}
          </p>
        )}
        <h3>{t("TTS 语音播报")}</h3>
        <p>
          {t(
            "读取卡片数据块，将其中的文本发送至语音模块。卡片字节编码应与下方设置一致。",
          )}
        </p>
        <p>{t("最长等待 10 秒；需要语音模块回传连接。")}</p>
        <p>
          {t("只裁去块数据末尾的零字节，不转换编码；UTF-16 末尾可能被截断。")}
        </p>
        <h3>{t("缓启动时序")}</h3>
        <p>
          {t(
            "先等待启动延时，再从已保存的初始占空比缓升至 100%，PWM 固定 20 kHz。设置下次启动生效。",
          )}
        </p>
        <h3>{t("电机上电方向")}</h3>
        <p>{t("实际转向取决于电机接线。")}</p>
        <p>
          {t(
            "方向保存后下次上电或复位生效，不切换当前输出。已保存方向不是当前运行方向。",
          )}
        </p>
        <p>
          {t(
            "产品模式由设备固件决定。连接果蝇设备后，工作站会自动切回果蝇一号。",
          )}
        </p>
        <Button onClick={() => guide.current?.close()}>{t("关闭说明")}</Button>
      </dialog>
    </div>
  );
}
