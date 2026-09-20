import { translate } from "./i18n";
import type { Language } from "./i18n";
import { COMMAND_NAMES } from "./types";
import type { LogEntry } from "./types";

// Search displayed command labels as well as original messages. Logs remain
// untouched so clipboard/export retain the original diagnostic evidence.
export function filterLogs(
  logs: LogEntry[],
  direction: string,
  query: string,
  language: Language,
) {
  const needle = query.trim().toLowerCase();
  return logs.filter((log) => {
    if (
      direction !== "all" &&
      direction !== log.direction &&
      !(direction === "error" && ["warning", "error"].includes(log.level))
    )
      return false;
    if (!needle) return true;
    const command =
      log.command === null
        ? "会话事件"
        : (COMMAND_NAMES[log.command & 0x7f] ?? "设备上报");
    return `${log.hex} ${log.message} ${command} ${translate(command, language)} ${translate(log.message, language)}`
      .toLowerCase()
      .includes(needle);
  });
}
