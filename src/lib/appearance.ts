export type DayTheme = "light" | "forest";
export type NightTheme = "graphite" | "contrast";
export type Theme = DayTheme | NightTheme;

export interface Preferences {
  theme: Theme;
  dayTheme: DayTheme;
  nightTheme: NightTheme;
  density: "comfortable" | "compact";
  motion: "system" | "full" | "reduced";
}

export const PREFERENCES_KEY = "df01.preferences";

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  theme: "light",
  dayTheme: "light",
  nightTheme: "graphite",
  density: "compact",
  motion: "system",
});

function isDayTheme(theme: unknown): theme is DayTheme {
  return theme === "light" || theme === "forest";
}

export function isNightTheme(theme: unknown): theme is NightTheme {
  return theme === "graphite" || theme === "contrast";
}

export function selectTheme(prefs: Preferences, theme: Theme): Preferences {
  return {
    ...prefs,
    theme,
    ...(isNightTheme(theme) ? { nightTheme: theme } : { dayTheme: theme }),
  };
}

export function toggleAppearance(prefs: Preferences): Preferences {
  const current = selectTheme(prefs, prefs.theme);
  return selectTheme(
    current,
    isNightTheme(current.theme) ? current.dayTheme : current.nightTheme,
  );
}

export function loadPreferences(
  storage?: Pick<Storage, "getItem">,
): Preferences {
  try {
    const source = storage ?? globalThis.localStorage;
    const parsed: unknown = JSON.parse(
      source?.getItem(PREFERENCES_KEY) ?? "{}",
    );
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ...DEFAULT_PREFERENCES };
    }
    const stored = parsed as Record<string, unknown>;
    const theme =
      isDayTheme(stored.theme) || isNightTheme(stored.theme)
        ? stored.theme
        : DEFAULT_PREFERENCES.theme;
    const prefs: Preferences = {
      theme,
      dayTheme: isDayTheme(stored.dayTheme) ? stored.dayTheme : "light",
      nightTheme: isNightTheme(stored.nightTheme)
        ? stored.nightTheme
        : "graphite",
      density: stored.density === "comfortable" ? "comfortable" : "compact",
      motion:
        stored.motion === "full" ||
        stored.motion === "reduced" ||
        stored.motion === "system"
          ? stored.motion
          : "system",
    };
    // Legacy preferences only contain the active theme; it is the latest choice in its group.
    return selectTheme(prefs, theme);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
