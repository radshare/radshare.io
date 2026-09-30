/**
 * Reaching someone who is not looking at this tab.
 *
 * The ready gate gives four people sixty seconds, and the whole premise is
 * that they are in a fullscreen mission on the same machine. A match that
 * fires silently is a match that expires, and an expired gate costs three
 * other people their minute too. So this fires three cues at once, because
 * each fails differently:
 *
 * - **The gong** reaches someone in the game. Fails when the tab has never
 *   been clicked, because browsers refuse audio without a gesture.
 * - **The title flip** reaches someone scanning their tab strip. Never fails,
 *   never interrupts, and is the only one that works with audio blocked.
 * - **The Notification** reaches someone in another window entirely. Fails
 *   without permission, which is never requested on page load.
 *
 * Everything is injected — clock, storage, audio, title setter, notification
 * factory — so the whole thing is tested without a browser.
 */

import { clampVolume, strike, type AudioTarget } from "./audio/gong.ts";

export const PREFS_KEY = "radshare.notify";

export type NotifyPrefs = {
  muted: boolean;
  /** 0–1. */
  volume: number;
};

/**
 * Loud enough to hear over a mission, quiet enough not to be the reason
 * someone mutes the tab forever.
 */
export const DEFAULT_PREFS: NotifyPrefs = { muted: false, volume: 0.6 };

/** How often the title alternates. Slow enough to read, fast enough to catch. */
export const TITLE_FLIP_MS = 1_000;

export type PrefsStore = {
  read(): Partial<NotifyPrefs> | null;
  write(prefs: NotifyPrefs): void;
};

export type NotifierOptions = {
  baseTitle: string;
  setTitle: (title: string) => void;
  /** Returns null when the browser has no Web Audio or refuses a context. */
  createAudio?: () => AudioTarget | null;
  /** Resumes a suspended context. Browsers start them suspended. */
  resumeAudio?: (ctx: AudioTarget) => void;
  /**
   * `"interrupted"` is included because iOS uses it — a phone call or another
   * app taking audio leaves the context in a state that is neither running nor
   * suspended, and treating it as running is how the gong silently stops
   * working after someone takes a call.
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
   * Called from the FIRST user gesture anywhere on the page.
   *
   * Browsers refuse to start audio without one, and the page's first gesture
   * is usually typing in the relic search — long before any match. The context
   * is created once and reused for the life of the page, so a user who is
   * silently re-queued after a reconnect still gets the ping; recreating it
   * per match would need a fresh gesture each time, which is exactly the
   * gesture nobody makes while playing.
   *
   * Idempotent: wiring it to every listener on the page is fine.
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
   * Asks for notification permission. A GESTURE ONLY — never on page load.
   *
   * A permission prompt before anyone has seen the board is how a stranger
   * from Reddit closes the tab, and a denied permission is permanent.
   */
  requestPermission(): void {
    if (this.#opts.notificationPermission?.() !== "default") return;
    this.#opts.requestNotificationPermission?.();
  }

  /**
   * A match fired. Everything goes off at once.
   *
   * Deliberately not conditional on the tab being hidden. `visibilityState`
   * says the tab is visible when it is behind a fullscreen game on another
   * monitor — which is the exact case this exists for.
   */
  matchFound(relicName: string): void {
    this.#playGong();
    this.#startTitleFlip(relicName);
    this.#showNotification(relicName);
  }

  /** The user has seen it: gate confirmed, gate ended, or the tab was focused. */
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

  /** Lets the settings control demo the sound at the current volume. */
  preview(): void {
    this.#playGong();
  }

  // -------------------------------------------------------------------------

  #playGong(): void {
    if (this.#prefs.muted || this.#prefs.volume === 0) return;
    if (!this.#ctx) return;

    // A context can stop running again after unlock — backgrounding suspends
    // it, and on iOS a phone call interrupts it. Checked at play time rather
    // than trusted from unlock time, because unlock happened minutes ago.
    const state = this.#opts.audioState?.(this.#ctx);
    if (state === "suspended" || state === "interrupted") {
      this.#opts.resumeAudio?.(this.#ctx);
    }
    try {
      strike(this.#ctx, this.#prefs.volume);
    } catch {
      // A failed sound must never take the ready check down with it. The title
      // flip and the notification are still running.
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
    // Only restores the title if a flip was actually running. Writing the base
    // title unconditionally would make every match start by setting the title
    // to what it already is, and a second match would blink back to normal
    // before alerting again.
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
      // Same reasoning as the gong: a cue that fails is not a page that fails.
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
      // Preferences are a convenience. Losing them costs a setting; throwing
      // here costs the mute button the user was trying to press.
    }
  }
}

/** The real browser store, guarded the same way the selection store is. */
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
