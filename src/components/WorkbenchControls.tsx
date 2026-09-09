import { Check, Radio, TimerReset, Zap } from "lucide-react";
import { Button, Field } from "./ui";
import { NumberInput } from "./NumberInput";
import { GAIN_DB } from "../lib/types";
import type { DeviceConfiguration } from "../lib/types";

export interface WorkbenchSettings {
  mode: number;
  block: number;
  gain: number;
  resetMs: number;
  onModeChange: (value: number) => void;
  onBlockChange: (value: number) => void;
  onGainChange: (value: number) => void;
  onResetChange: (value: number) => void;
  onApplyMode: () => void;
  onApplyGain: () => void;
  onApplyReset: () => void;
}

const MODES = ["自动读卡号", "关闭自动读取", "自动读数据块"];

export function WorkbenchControls({
  settings: s,
  saved,
  connected,
  busy,
}: {
  settings: WorkbenchSettings;
  saved: DeviceConfiguration | null;
  connected: boolean;
  busy: string;
}) {
  return (
    <div className="workbench-controls" aria-label="模块控制">
      <section className="control-panel quick-mode" aria-label="自动模式设置">
        <div className="control-heading">
          <h2>
            <Zap size={15} />
            自动模式
          </h2>
          <span>{saved ? MODES[saved.autoMode] : "未同步"}</span>
        </div>
        <select
          aria-label="工作台自动模式"
          value={s.mode}
          disabled={!!busy}
          onChange={(event) => s.onModeChange(Number(event.target.value))}
        >
          {MODES.map((mode, value) => (
            <option key={value} value={value}>
              {mode}
            </option>
          ))}
        </select>
        <div className="control-bottom mode-target">
          <label htmlFor="workbench-block">块 / 页</label>
          <NumberInput
            id="workbench-block"
            aria-label="工作台目标块"
            value={s.block}
            min={0}
            max={255}
            disabled={s.mode !== 2 || !!busy}
            onValueChange={s.onBlockChange}
          />
          <Button
            disabled={!connected || !!busy}
            onClick={s.onApplyMode}
            busy={busy === "设置自动方式"}
          >
            应用模式
          </Button>
        </div>
      </section>
      <section className="control-panel rf-control" aria-label="射频设置">
        <div className="control-heading">
          <h2>
            <Radio size={15} />
            射频增益
          </h2>
          <span>
            {saved ? `已保存 ${GAIN_DB[saved.antennaGain]} dB` : "未同步"}
          </span>
        </div>
        <div className="gain-control-line">
          <input
            type="range"
            min={0}
            max={7}
            step={1}
            value={s.gain}
            disabled={!!busy}
            className="gain-slider"
            aria-label="工作台天线增益"
            aria-valuetext={`档位 ${s.gain}，${GAIN_DB[s.gain]} dB`}
            onChange={(event) => s.onGainChange(Number(event.target.value))}
          />
          <span className="gain-value">
            {GAIN_DB[s.gain]}
            <small> dB</small>
          </span>
        </div>
        <div className="control-bottom">
          <span className="control-caption">档位 {s.gain} / 7</span>
          <Button
            disabled={!connected || !!busy}
            onClick={s.onApplyGain}
            busy={busy === "设置天线增益"}
          >
            <Check size={14} />
            保存增益
          </Button>
        </div>
      </section>
      <section className="control-panel reset-control" aria-label="防重读设置">
        <div className="control-heading">
          <h2>
            <TimerReset size={15} />
            防重读
          </h2>
          <span>
            {saved
              ? saved.resetMs === 0
                ? "已保存 无限期"
                : `已保存 ${saved.resetMs} ms`
              : "未同步"}
          </span>
        </div>
        <div className="reset-presets" aria-label="防重读预设">
          {[0, 500, 1000].map((value) => (
            <button
              key={value}
              disabled={!!busy}
              aria-pressed={s.resetMs === value}
              onClick={() => s.onResetChange(value)}
            >
              {value === 0 ? "无限期" : `${value} ms`}
            </button>
          ))}
        </div>
        <div className="control-bottom reset-value">
          <Field label="时长 ms">
            <NumberInput
              aria-label="工作台防重读时长"
              value={s.resetMs}
              min={0}
              max={3000}
              disabled={!!busy}
              onValueChange={s.onResetChange}
            />
          </Field>
          <Button
            disabled={!connected || !!busy}
            onClick={s.onApplyReset}
            busy={busy === "设置防重读时长"}
          >
            保存时长
          </Button>
        </div>
      </section>
    </div>
  );
}
