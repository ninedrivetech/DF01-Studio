import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  isNightTheme,
  loadPreferences,
  selectTheme,
  toggleAppearance,
} from "./appearance";
import type { Theme } from "./appearance";

const loadStored = (value: unknown) =>
  loadPreferences({ getItem: () => JSON.stringify(value) });

afterEach(() => vi.unstubAllGlobals());

describe("appearance preference migration", () => {
  it("uses the existing storage key and preserves the current defaults", () => {
    const getItem = vi.fn(() => null);
    expect(loadPreferences({ getItem })).toEqual(DEFAULT_PREFERENCES);
    expect(getItem).toHaveBeenCalledWith(PREFERENCES_KEY);
    expect(PREFERENCES_KEY).toBe("df01.preferences");
  });

  it.each([
    ["light", "light", "graphite"],
    ["forest", "forest", "graphite"],
    ["graphite", "light", "graphite"],
    ["contrast", "light", "contrast"],
  ] as const)(
    "migrates legacy %s to remembered themes %s/%s",
    (theme, dayTheme, nightTheme) => {
      expect(
        loadStored({ theme, density: "comfortable", motion: "reduced" }),
      ).toEqual({
        theme,
        dayTheme,
        nightTheme,
        density: "comfortable",
        motion: "reduced",
      });
    },
  );

  it("preserves both groups across save and reload", () => {
    let prefs = selectTheme({ ...DEFAULT_PREFERENCES }, "forest");
    prefs = selectTheme(prefs, "contrast");
    const loaded = loadStored(prefs);
    expect(loaded).toEqual(prefs);
    expect(toggleAppearance(loaded).theme).toBe("forest");
    expect(toggleAppearance(toggleAppearance(loaded)).theme).toBe("contrast");
  });

  it("treats the active theme as the latest choice when stored group memory disagrees", () => {
    expect(
      loadStored({
        theme: "forest",
        dayTheme: "light",
        nightTheme: "contrast",
      }),
    ).toMatchObject({
      theme: "forest",
      dayTheme: "forest",
      nightTheme: "contrast",
    });
  });

  it("validates group membership and preference values independently", () => {
    expect(
      loadStored({
        theme: "graphite",
        dayTheme: "contrast",
        nightTheme: "forest",
        density: "spacious",
        motion: "fast",
      }),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: "graphite",
    });
    expect(
      loadStored({
        theme: "unknown",
        density: "comfortable",
        motion: "full",
        nightTheme: "contrast",
      }),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      density: "comfortable",
      motion: "full",
      nightTheme: "contrast",
    });
  });

  it.each([null, [], "forest", 42, true])(
    "ignores a non-object stored value %j",
    (value) => {
      expect(loadStored(value)).toEqual(DEFAULT_PREFERENCES);
    },
  );

  it("recovers from malformed JSON and unavailable storage", () => {
    expect(loadPreferences({ getItem: () => "{broken" })).toEqual(
      DEFAULT_PREFERENCES,
    );
    expect(
      loadPreferences({
        getItem: () => {
          throw new Error("Storage denied");
        },
      }),
    ).toEqual(DEFAULT_PREFERENCES);
    vi.stubGlobal("localStorage", undefined);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("loads browser storage when no storage argument is supplied", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ theme: "forest", motion: "full" }),
    });
    expect(loadPreferences()).toMatchObject({
      theme: "forest",
      dayTheme: "forest",
      motion: "full",
    });
  });
});

describe("day and night theme selection", () => {
  it.each<Theme>(["light", "forest"])(
    "classifies %s as a day theme",
    (theme) => {
      expect(isNightTheme(theme)).toBe(false);
    },
  );

  it.each<Theme>(["graphite", "contrast"])(
    "classifies %s as a night theme",
    (theme) => {
      expect(isNightTheme(theme)).toBe(true);
    },
  );

  it("returns to the last day/night selections on repeated toggles", () => {
    const initial = {
      ...DEFAULT_PREFERENCES,
      density: "comfortable" as const,
      motion: "reduced" as const,
    };
    const forest = selectTheme(initial, "forest");
    const firstNight = toggleAppearance(forest);
    expect(firstNight.theme).toBe("graphite");
    const contrast = selectTheme(firstNight, "contrast");
    const day = toggleAppearance(contrast);
    expect(day.theme).toBe("forest");
    expect(toggleAppearance(day)).toEqual(contrast);
    expect(day).toMatchObject({ density: "comfortable", motion: "reduced" });
    expect(initial).toEqual({
      ...DEFAULT_PREFERENCES,
      density: "comfortable",
      motion: "reduced",
    });
  });

  it("updates only the selected theme group and retains all other preferences", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      dayTheme: "forest" as const,
      nightTheme: "contrast" as const,
      motion: "full" as const,
    };
    expect(selectTheme(prefs, "graphite")).toEqual({
      ...prefs,
      theme: "graphite",
      nightTheme: "graphite",
    });
    expect(selectTheme(prefs, "light")).toEqual({
      ...prefs,
      theme: "light",
      dayTheme: "light",
    });
  });

  it("remembers the current theme before toggling even when the caller changed it directly", () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: "forest" as const };
    expect(toggleAppearance(toggleAppearance(prefs)).theme).toBe("forest");
  });
});
