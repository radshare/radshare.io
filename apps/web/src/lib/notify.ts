/**
 * Reaching someone who is not looking at this tab. A match that fires silently
 * is a gate that expires, which costs three other people their minute too.
 *
 * Three cues, because each fails differently:
 *
 * - **Gong** — reaches someone in the game. Fails until the tab is clicked.
 * - **Title flip** — reaches someone scanning tabs. Never fails, and is the
 *   only one that works with audio blocked.
 * - **Notification** — reaches another window. Fails without permission.
 *
 * Everything is injected, so all of it is tested without a browser.
 */

import { clampVolume, strike, type AudioTarget } from "./audio/gong.ts";

export const PREFS_KEY = "radshare.notify";

export type NotifyPrefs = {
  muted: boolean;
  /** 0–1. */
  volume: number;
};

/** Audible over a mission, not loud enough to get the tab muted forever. */
export const DEFAULT_PREFS: NotifyPrefs = { muted: false, volume: 0.6 };

/** Slow enough to read, fast enough to catch. */
export const TITLE_FLIP_MS = 1_000;

export type PrefsStore = {
  read(): Partial<NotifyPrefs> | null;
  write(prefs: NotifyPrefs): void;
};

export type NotifierOptions = {
  baseTitle: string;
  setTitle: (title: string) => void;
  /** Null when the browser has no Web Audio. */
  createAudio?: () => AudioTarget | null;
  /** Browsers start contexts suspended. */
  resumeAudio?: (ctx: AudioTarget) => void;
  /**
   * `"interrupted"` is iOS after a phone call. Treating it as running is how
   * the gong silently stops for the rest of the session.
   */
  audioState?: (ctx: AudioTarget) => "running" | "suspended" | "closed" | "interrupted";
  storage?: PrefsStore;
  notificationPermission?: () => "granted" | "denied" | "default";
  requestNotificationPermission?: () => void;
  showNotification?: (title: string, body: string) => void;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
};

export class Notifier {
  #prefs: NotifyPrefs;
  #ctx: AudioTarget | null = null;
  #unlocked = false;
  #flipHandle: number | null = null;
  #flipped = false;
  #opts: NotifierOptions;

  constructor(opts: NotifierOptions) {
    this.#opts = opts;
    this.#prefs = { ...DEFAULT_PREFS, ...(this.#readPrefs() ?? {}) };
    this.#prefs.volume = clampVolume(this.#prefs.volume);
  }

  get prefs(): NotifyPrefs {
    return { ...this.#prefs };
  }

  get unlocked(): boolean {
    return this.#unlocked;
  }

  /**
   * From the FIRST gesture anywhere — in practice typing in the relic search,
   * long before any match. The context is reused for the page's life, because
   * recreating it per match would need a gesture nobody makes while playing.
   *
   * Idempotent, so wiring it to every listener is fine.
   */
  unlock(): void {
    if (this.#unlocked) return;
    try {
      this.#ctx = this.#opts.createAudio?.() ?? null;
      if (this.#ctx) this.#opts.resumeAudio?.(this.#ctx);
      this.#unlocked = this.#ctx !== null;
    } catch {
      this.#ctx = null;
      this.#unlocked = false;
    }
  }

  /**
   * GESTURE ONLY. A prompt before anyone has seen the board is how a stranger
   * closes the tab, and a denial is permanent.
   */
  requestPermission(): void {
    if (this.#opts.notificationPermission?.() !== "default") return;
    this.#opts.requestNotificationPermission?.();
  }

  /**
   * Not conditional on the tab being hidden: `visibilityState` reports visible
   * for a tab behind a fullscreen game, which is the case this exists for.
   */
  matchFound(relicName: string): void {
    this.#playGong();
    this.#startTitleFlip(relicName);
    this.#showNotification(relicName);
  }

  /** Gate confirmed, gate ended, or the tab was focused. */
  clear(): void {
    this.#stopTitleFlip();
  }

  setMuted(muted: boolean): void {
    this.#prefs = { ...this.#prefs, muted };
    this.#writePrefs();
  }

  setVolume(volume: number): void {
    this.#prefs = { ...this.#prefs, volume: clampVolume(volume) };
    this.#writePrefs();
  }

  /** For the settings control. */
  preview(): void {
    this.#playGong();
  }

  // -------------------------------------------------------------------------

  #playGong(): void {
    if (this.#prefs.muted || this.#prefs.volume === 0) return;
    if (!this.#ctx) return;

    // Checked at play time, not trusted from unlock: backgrounding suspends a
    // context and iOS interrupts it, and unlock was minutes ago.
    const state = this.#opts.audioState?.(this.#ctx);
    if (state === "suspended" || state === "interrupted") {
      this.#opts.resumeAudio?.(this.#ctx);
    }
    try {
      strike(this.#ctx, this.#prefs.volume);
    } catch {
      // A failed cue must not take the ready check with it.
    }
  }

  #startTitleFlip(relicName: string): void {
    this.#stopTitleFlip();
    const alert = `(!) SQUAD FOUND — ${relicName}`;
    const tick = () => {
      this.#flipped = !this.#flipped;
      this.#opts.setTitle(this.#flipped ? alert : this.#opts.baseTitle);
      this.#flipHandle = this.#timer(tick, TITLE_FLIP_MS);
    };
    this.#flipped = false;
    tick();
  }

  #stopTitleFlip(): void {
    // Only if a flip was running: otherwise a second match blinks back to
    // normal before alerting again.
    const wasFlipping = this.#flipHandle !== null || this.#flipped;
    if (this.#flipHandle !== null) this.#clearTimer(this.#flipHandle);
    this.#flipHandle = null;
    this.#flipped = false;
    if (wasFlipping) this.#opts.setTitle(this.#opts.baseTitle);
  }

  #showNotification(relicName: string): void {
    if (this.#opts.notificationPermission?.() !== "granted") return;
    try {
      this.#opts.showNotification?.(
        "Squad found",
        `${relicName} — confirm within 60 seconds.`,
      );
    } catch {
      // A cue that fails is not a page that fails.
    }
  }

  #timer(fn: () => void, ms: number): number {
    return this.#opts.setTimer
      ? this.#opts.setTimer(fn, ms)
      : (setTimeout(fn, ms) as unknown as number);
  }

  #clearTimer(handle: number): void {
    if (this.#opts.clearTimer) this.#opts.clearTimer(handle);
    else clearTimeout(handle);
  }

  #readPrefs(): Partial<NotifyPrefs> | null {
    try {
      return this.#opts.storage?.read() ?? null;
    } catch {
      return null;
    }
  }

  #writePrefs(): void {
    try {
      this.#opts.storage?.write(this.#prefs);
    } catch {
      // Losing a preference costs a setting; throwing costs the mute button.
    }
  }
}

/** Guarded the same way the selection store is. */
export function localPrefsStore(): PrefsStore {
  return {
    read() {
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        return parsed as Partial<NotifyPrefs>;
      } catch {
        return null;
      }
    },
    write(prefs) {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        // Private mode. Not fatal.
      }
    },
  };
}
