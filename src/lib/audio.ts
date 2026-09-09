const SOUND_MUTED_KEY = "df01.sound-muted";
type Note = readonly [number, number, number, number, number, OscillatorType];
let context: AudioContext | undefined;
let muted = loadMuted();
const activeSounds = new Set<() => void>();

function loadMuted() {
  try {
    return localStorage.getItem(SOUND_MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function isSoundMuted() {
  return muted;
}

export function setSoundMuted(value: boolean) {
  muted = value;
  if (muted) for (const stop of [...activeSounds]) stop();
  try {
    localStorage.setItem(SOUND_MUTED_KEY, String(value));
  } catch {
    // Keep the current session usable when storage is unavailable.
  }
  if (!muted) unlockAudio();
}

// Called from a pointer/keyboard gesture so browser and WebView autoplay allow audio.
export function unlockAudio() {
  if (muted) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    // Audio is optional on systems without Web Audio or an output device.
  }
}

function playNotes(notes: readonly Note[]) {
  const audio = context;
  if (muted || !audio) return () => {};
  let cancelled = false;
  let remaining = notes.length;
  const voices: { oscillator: OscillatorNode; envelope: GainNode }[] = [];
  const stop = () => {
    cancelled = true;
    activeSounds.delete(stop);
    for (const { oscillator, envelope } of voices) {
      oscillator.stop();
      oscillator.disconnect();
      envelope.disconnect();
    }
  };
  activeSounds.add(stop);
  void audio
    .resume()
    .then(() => {
      if (cancelled || muted) return;
      const start = audio.currentTime;
      for (const [delay, duration, from, to, volume, type] of notes) {
        const oscillator = audio.createOscillator();
        const envelope = audio.createGain();
        voices.push({ oscillator, envelope });
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from, start + delay);
        oscillator.frequency.exponentialRampToValueAtTime(
          to,
          start + delay + duration,
        );
        envelope.gain.setValueAtTime(0, start + delay);
        envelope.gain.linearRampToValueAtTime(volume, start + delay + 0.015);
        envelope.gain.exponentialRampToValueAtTime(
          0.001,
          start + delay + duration,
        );
        oscillator.connect(envelope).connect(audio.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          envelope.disconnect();
          if (--remaining === 0) activeSounds.delete(stop);
        };
        oscillator.start(start + delay);
        oscillator.stop(start + delay + duration + 0.02);
      }
    })
    .catch(stop);
  return stop;
}

export function playGainSound() {
  return playNotes([
    [0, 0.48, 125, 210, 0.045, "sawtooth"],
    [0.12, 0.18, 660, 880, 0.09, "sine"],
    [0.3, 0.3, 880, 1320, 0.075, "sine"],
  ]);
}

export function playReportSound() {
  // Never queue old reports while waiting for the first user gesture.
  if (context?.state !== "running") return;
  playNotes([[0, 0.12, 1046, 1318, 0.065, "sine"]]);
}
