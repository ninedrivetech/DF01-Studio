import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { playGainSound } from "./audio";

// One short, decaying shake; coordinates are relative to the original position.
const OFFSETS = [
  [0, 0],
  [-8, 3],
  [8, -3],
  [-7, -2],
  [7, 2],
  [-5, 2],
  [5, -2],
  [-3, -1],
  [3, 1],
  [-1, 0],
  [0, 0],
];
const STEP_MS = 55;
let nativeShake: Promise<void> = Promise.resolve();

export function startGainEffects() {
  const stopSound = playGainSound();
  const motion = document.documentElement.dataset.motion;
  const reduced =
    motion === "reduced" ||
    (motion !== "full" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let cancelled = false;
  let animation: Animation | undefined;
  const shakeContent = () => {
    if (cancelled) return;
    animation = document.getElementById("root")?.animate(
      OFFSETS.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })),
      { duration: STEP_MS * (OFFSETS.length - 1), easing: "ease-in-out" },
    );
  };

  if (!reduced) {
    if (!isTauri()) shakeContent();
    else {
      // Finish restoring a previous shake before reading the next origin.
      nativeShake = nativeShake
        .then(async () => {
          if (cancelled) return;
          const appWindow = getCurrentWindow();
          let origin: PhysicalPosition | undefined;
          let moved = false;
          try {
            const [maximized, fullscreen, scale] = await Promise.all([
              appWindow.isMaximized(),
              appWindow.isFullscreen(),
              appWindow.scaleFactor(),
            ]);
            if (cancelled) return;
            if (maximized || fullscreen) {
              shakeContent();
              return;
            }
            origin = await appWindow.outerPosition();
            for (const [x, y] of OFFSETS.slice(1)) {
              if (cancelled) break;
              moved = true;
              await appWindow.setPosition(
                new PhysicalPosition(
                  origin.x + Math.round(x * scale),
                  origin.y + Math.round(y * scale),
                ),
              );
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, STEP_MS),
              );
            }
          } catch {
            shakeContent();
          } finally {
            if (moved && origin) await appWindow.setPosition(origin);
          }
        })
        .catch(() => {});
    }
  }

  return () => {
    cancelled = true;
    animation?.cancel();
    stopSound();
  };
}
