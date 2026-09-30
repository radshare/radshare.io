/**
 * Runes over `Notifier`, plus the browser wiring: the real AudioContext, title
 * and Notification. Every decision lives in `notify.ts`.
 */

import { browser } from "$app/environment";
import { Notifier, localPrefsStore, type NotifyPrefs } from "./notify.ts";
import { DEFAULT_PREFS } from "./notify.ts";
import type { AudioTarget } from "./audio/gong.ts";

export class NotifyStore {
  prefs = $state<NotifyPrefs>({ ...DEFAULT_PREFS });
  unlocked = $state(false);
  #notifier: Notifier | null = null;

  start(baseTitle: string): void {
    if (!browser || this.#notifier) return;

    this.#notifier = new Notifier({
      baseTitle,
      setTitle: (t) => {
        document.title = t;
      },
      createAudio: () => {
        const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        return Ctor ? (new Ctor() as unknown as AudioTarget) : null;
      },
      resumeAudio: (ctx) => void (ctx as unknown as AudioContext).resume?.(),
      audioState: (ctx) => (ctx as unknown as AudioContext).state,
      storage: localPrefsStore(),
      notificationPermission: () =>
        typeof Notification === "undefined" ? "denied" : Notification.permission,
      requestNotificationPermission: () => void Notification.requestPermission(),
      showNotification: (title, body) => {
        const n = new Notification(title, { body, tag: "radshare-match" });
        n.onclick = () => window.focus();
      },
    });
    this.prefs = this.#notifier.prefs;

    // In practice the relic search, long before any match -- which is the
    // point, since nobody clicks the tab while playing.
    const unlock = () => {
      this.#notifier?.unlock();
      this.unlocked = this.#notifier?.unlocked ?? false;
    };
    for (const event of ["pointerdown", "keydown", "touchstart"]) {
      window.addEventListener(event, unlock, { once: true, passive: true });
    }

    // Looking at the tab IS acknowledgement -- the ready check is on screen.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.#notifier?.clear();
    });
  }

  matchFound(relicName: string): void {
    this.#notifier?.matchFound(relicName);
  }

  clear(): void {
    this.#notifier?.clear();
  }

  setMuted(muted: boolean): void {
    this.#notifier?.setMuted(muted);
    if (this.#notifier) this.prefs = this.#notifier.prefs;
  }

  setVolume(volume: number): void {
    this.#notifier?.setVolume(volume);
    if (this.#notifier) this.prefs = this.#notifier.prefs;
  }

  preview(): void {
    this.#notifier?.unlock();
    this.#notifier?.preview();
  }

  requestPermission(): void {
    this.#notifier?.requestPermission();
  }
}

export const notify = new NotifyStore();
