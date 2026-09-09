import type { LogEntry } from "./types";

export function createReportSoundTracker() {
  let lastSeenId: number | undefined;
  return (logs: readonly LogEntry[]) => {
    const previous = lastSeenId;
    let found = false;
    for (const entry of logs) {
      lastSeenId = Math.max(lastSeenId ?? 0, entry.id);
      if (
        previous !== undefined &&
        entry.id > previous &&
        entry.direction === "rx" &&
        entry.level === "success" &&
        (entry.command === 0x90 || entry.command === 0x91) &&
        (entry.message === "自动上报" ||
          entry.message.startsWith("主动上报 · "))
      )
        found = true;
    }
    lastSeenId ??= 0;
    // One cue per fresh batch avoids overlapping tones during fast reporting.
    return found;
  };
}
