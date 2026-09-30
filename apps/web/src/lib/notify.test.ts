import { describe, expect, test } from "bun:test";
import {
  GONG_DURATION_SECONDS,
  GONG_FUNDAMENTAL_HZ,
  GONG_PARTIALS,
  clampVolume,
  isInharmonic,
  strike,
  type AudioTarget,
} from "./audio/gong.ts";
import { DEFAULT_PREFS, Notifier, TITLE_FLIP_MS, type NotifyPrefs } from "./notify.ts";

// ---------------------------------------------------------------------------
// a recorder standing in for Web Audio, which Bun does not have
// ---------------------------------------------------------------------------

type Rec = {
  oscillators: { frequency: number; detune: number; start: number; stop: number }[];
  gains: number;
  connects: number;
  buffers: number;
};

function fakeAudio(): { ctx: AudioTarget; rec: Rec } {
  const rec: Rec = { oscillators: [], gains: 0, connects: 0, buffers: 0 };
  const node = () => ({ connect: () => void (rec.connects += 1) });

  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });

  const ctx = {
    currentTime: 0,
    sampleRate: 48_000,
    destination: node() as unknown as AudioNode,
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { value: 0 },
        detune: { value: 0 },
        ...node(),
        start(at: number) {
          entry.start = at;
        },
        stop(at: number) {
          entry.stop = at;
          entry.frequency = osc.frequency.value;
          entry.detune = osc.detune.value;
        },
      };
      const entry = { frequency: 0, detune: 0, start: -1, stop: -1 };
      rec.oscillators.push(entry);
      return osc as unknown as OscillatorNode;
    },
    createGain() {
      rec.gains += 1;
      return { gain: param(), ...node() } as unknown as GainNode;
    },
    createBuffer(_c: number, length: number) {
      rec.buffers += 1;
      const data = new Float32Array(length);
      return { getChannelData: () => data, length } as unknown as AudioBuffer;
    },
    createBufferSource() {
      return { buffer: null, ...node(), start() {}, stop() {} } as unknown as AudioBufferSourceNode;
    },
    createBiquadFilter() {
      return {
        type: "bandpass",
        frequency: { value: 0 },
        Q: { value: 0 },
        ...node(),
      } as unknown as BiquadFilterNode;
    },
  };
  return { ctx: ctx as unknown as AudioTarget, rec };
}

// ---------------------------------------------------------------------------

describe("the gong is a gong, not a chime", () => {
  test("its partials are inharmonic", () => {
    // Integer multiples of the fundamental are a musical tone -- a bell, a
    // chime, a UI beep. Metal struck in the middle is inharmonic, and that is
    // the difference between "the app wants me" and "something happened in
    // game".
    expect(isInharmonic()).toBe(true);
    for (const p of GONG_PARTIALS.slice(1)) {
      expect(Math.abs(p.ratio - Math.round(p.ratio))).toBeGreaterThan(0.05);
    }
  });

  test("it is not a harmonic series by accident", () => {
    const harmonic = [1, 2, 3, 4, 5].map((ratio) => ({ ratio, gain: 1, decay: 1, detune: 0 }));
    expect(isInharmonic(harmonic)).toBe(false);
  });

  test("higher partials die first, as struck metal does", () => {
    for (let i = 1; i < GONG_PARTIALS.length; i += 1) {
      expect(GONG_PARTIALS[i]!.decay).toBeLessThan(GONG_PARTIALS[i - 1]!.decay);
      expect(GONG_PARTIALS[i]!.gain).toBeLessThan(GONG_PARTIALS[i - 1]!.gain);
    }
  });

  test("the tail is long enough to cover the did-I-hear-that moment", () => {
    // A cue that needs to repeat is a cue that gets muted, and a muted tool
    // never reaches anyone again.
    expect(GONG_PARTIALS[0]!.decay).toBeGreaterThanOrEqual(4);
    expect(GONG_DURATION_SECONDS).toBeGreaterThanOrEqual(GONG_PARTIALS[0]!.decay);
  });

  test("the fundamental is low enough to carry through game audio", () => {
    // ...and high enough to survive a laptop speaker.
    expect(GONG_FUNDAMENTAL_HZ).toBeLessThan(200);
    expect(GONG_FUNDAMENTAL_HZ).toBeGreaterThan(80);
  });

  test("paired partials are detuned, which is where the shimmer comes from", () => {
    expect(GONG_PARTIALS.filter((p) => p.detune !== 0).length).toBeGreaterThan(4);
  });
});

describe("striking", () => {
  test("builds one oscillator per partial", () => {
    const { ctx, rec } = fakeAudio();
    strike(ctx, 1);
    expect(rec.oscillators).toHaveLength(GONG_PARTIALS.length);
  });

  test("every oscillator is stopped, so a match leaks nothing", () => {
    // An alert that leaks an oscillator per match degrades the tab it was
    // trying to save.
    const { ctx, rec } = fakeAudio();
    strike(ctx, 1);
    for (const osc of rec.oscillators) {
      expect(osc.start).toBe(0);
      expect(osc.stop).toBeGreaterThan(0);
    }
  });

  test("frequencies follow the partial ratios", () => {
    const { ctx, rec } = fakeAudio();
    strike(ctx, 1, 100);
    expect(rec.oscillators.map((o) => o.frequency)).toEqual(
      GONG_PARTIALS.map((p) => 100 * p.ratio),
    );
  });

  test("there is a strike transient as well as the tone", () => {
    // Without the mallet the partials fade in and it reads as a synth pad
    // rather than as something being hit.
    const { ctx, rec } = fakeAudio();
    strike(ctx, 1);
    expect(rec.buffers).toBe(1);
  });

  test("volume is clamped rather than trusted", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(4)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------

function harness(opts: Partial<ConstructorParameters<typeof Notifier>[0]> = {}) {
  const titles: string[] = [];
  const notifications: { title: string; body: string }[] = [];
  const timers: { fn: () => void; at: number; handle: number }[] = [];
  let clock = 0;
  let next = 1;
  let stored: Partial<NotifyPrefs> | null = null;
  let permission: "granted" | "denied" | "default" = "default";
  let requested = 0;
  let resumed = 0;
  let state: "running" | "suspended" | "closed" | "interrupted" = "running";
  const { ctx, rec } = fakeAudio();
  let audio: AudioTarget | null = ctx;

  const notifier = new Notifier({
    baseTitle: "radshare",
    setTitle: (t) => titles.push(t),
    createAudio: () => audio,
    resumeAudio: () => {
      resumed += 1;
      state = "running";
    },
    audioState: () => state,
    storage: {
      read: () => stored,
      write: (p) => {
        stored = p;
      },
    },
    notificationPermission: () => permission,
    requestNotificationPermission: () => {
      requested += 1;
    },
    showNotification: (title, body) => notifications.push({ title, body }),
    setTimer: (fn, ms) => {
      const handle = next++;
      timers.push({ fn, at: clock + ms, handle });
      return handle;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.handle === h);
      if (i >= 0) timers.splice(i, 1);
    },
    ...opts,
  });

  return {
    notifier,
    titles,
    notifications,
    rec,
    get stored() {
      return stored;
    },
    get requested() {
      return requested;
    },
    get resumed() {
      return resumed;
    },
    grant() {
      permission = "granted";
    },
    deny() {
      permission = "denied";
    },
    suspend() {
      state = "suspended";
    },
    interrupt() {
      state = "interrupted";
    },
    noAudio() {
      audio = null;
    },
    advance(ms: number) {
      clock += ms;
      for (const t of [...timers]) {
        if (t.at <= clock) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
    get pendingTimers() {
      return timers.length;
    },
  };
}

describe("unlocking audio", () => {
  test("nothing plays before a gesture", () => {
    // Browsers refuse audio without one, so this is the real default state.
    const h = harness();
    h.notifier.matchFound("Axi A1");
    expect(h.rec.oscillators).toHaveLength(0);
  });

  test("a gesture unlocks it", () => {
    const h = harness();
    h.notifier.unlock();
    expect(h.notifier.unlocked).toBe(true);
    h.notifier.matchFound("Axi A1");
    expect(h.rec.oscillators.length).toBeGreaterThan(0);
  });

  test("unlocking twice creates one context", () => {
    // It is wired to every listener on the page, so it must be idempotent.
    const h = harness();
    h.notifier.unlock();
    h.notifier.unlock();
    h.notifier.unlock();
    expect(h.resumed).toBe(1);
  });

  test("the context survives a reconnect, so a re-queued user still hears it", () => {
    const h = harness();
    h.notifier.unlock();
    h.notifier.matchFound("Axi A1");
    const first = h.rec.oscillators.length;
    h.notifier.clear();
    h.notifier.matchFound("Lith G1");
    expect(h.rec.oscillators.length).toBe(first * 2);
  });

  test("a context suspended while backgrounded is resumed at play time", () => {
    const h = harness();
    h.notifier.unlock();
    h.suspend();
    h.notifier.matchFound("Axi A1");
    expect(h.resumed).toBe(2);
    expect(h.rec.oscillators.length).toBeGreaterThan(0);
  });

  test("an iOS context interrupted by a phone call is resumed too", () => {
    // iOS uses "interrupted" rather than "suspended". Treating it as running
    // is how the gong silently stops working after someone takes a call.
    const h = harness();
    h.notifier.unlock();
    h.interrupt();
    h.notifier.matchFound("Axi A1");
    expect(h.resumed).toBe(2);
    expect(h.rec.oscillators.length).toBeGreaterThan(0);
  });

  test("a browser with no Web Audio is not a broken page", () => {
    const h = harness();
    h.noAudio();
    h.notifier.unlock();
    expect(h.notifier.unlocked).toBe(false);
    expect(() => h.notifier.matchFound("Axi A1")).not.toThrow();
    // The other two cues still fire.
    expect(h.titles.some((t) => t.includes("SQUAD FOUND"))).toBe(true);
  });
});

describe("the title flip", () => {
  test("names the relic, so it answers which bucket fired", () => {
    const h = harness();
    h.notifier.matchFound("Axi A1");
    expect(h.titles[0]).toContain("Axi A1");
    expect(h.titles[0]).toContain("SQUAD FOUND");
  });

  test("alternates with the base title", () => {
    const h = harness();
    h.notifier.matchFound("Axi A1");
    h.advance(TITLE_FLIP_MS);
    h.advance(TITLE_FLIP_MS);
    expect(h.titles[0]).toContain("SQUAD FOUND");
    expect(h.titles[1]).toBe("radshare");
    expect(h.titles[2]).toContain("SQUAD FOUND");
  });

  test("fires even when the tab looks visible", () => {
    // visibilityState says visible when the tab is behind a fullscreen game on
    // another monitor, which is the exact case this exists for.
    const h = harness();
    h.notifier.matchFound("Axi A1");
    expect(h.titles.length).toBeGreaterThan(0);
  });

  test("clearing restores the title and stops the timer", () => {
    const h = harness();
    h.notifier.matchFound("Axi A1");
    h.notifier.clear();
    expect(h.titles.at(-1)).toBe("radshare");
    expect(h.pendingTimers).toBe(0);
  });

  test("a second match does not leave two flips running", () => {
    const h = harness();
    h.notifier.matchFound("Axi A1");
    h.notifier.matchFound("Lith G1");
    expect(h.pendingTimers).toBe(1);
  });
});

describe("notifications", () => {
  test("permission is never requested without a gesture", () => {
    // A prompt before anyone has seen the board is how a stranger from Reddit
    // closes the tab, and a denial is permanent.
    const h = harness();
    h.notifier.matchFound("Axi A1");
    expect(h.requested).toBe(0);
  });

  test("a gesture requests it once", () => {
    const h = harness();
    h.notifier.requestPermission();
    expect(h.requested).toBe(1);
  });

  test("it is not re-requested after a denial", () => {
    const h = harness();
    h.deny();
    h.notifier.requestPermission();
    expect(h.requested).toBe(0);
  });

  test("granted permission shows the relic and the deadline", () => {
    const h = harness();
    h.grant();
    h.notifier.matchFound("Axi A1");
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]!.body).toContain("Axi A1");
    expect(h.notifications[0]!.body).toContain("60 seconds");
  });

  test("without permission nothing is shown and nothing throws", () => {
    const h = harness();
    h.notifier.matchFound("Axi A1");
    expect(h.notifications).toHaveLength(0);
  });
});

describe("mute and volume", () => {
  test("default to audible but not aggressive", () => {
    expect(DEFAULT_PREFS.muted).toBe(false);
    expect(DEFAULT_PREFS.volume).toBeGreaterThan(0);
    expect(DEFAULT_PREFS.volume).toBeLessThan(1);
  });

  test("muting silences the gong but keeps the other cues", () => {
    // An unmuteable sound is how a tool gets closed permanently -- but muting
    // audio must not mute the app.
    const h = harness();
    h.notifier.unlock();
    h.grant();
    h.notifier.setMuted(true);
    h.notifier.matchFound("Axi A1");

    expect(h.rec.oscillators).toHaveLength(0);
    expect(h.titles.length).toBeGreaterThan(0);
    expect(h.notifications).toHaveLength(1);
  });

  test("zero volume is treated as muted", () => {
    const h = harness();
    h.notifier.unlock();
    h.notifier.setVolume(0);
    h.notifier.matchFound("Axi A1");
    expect(h.rec.oscillators).toHaveLength(0);
  });

  test("both persist", () => {
    const h = harness();
    h.notifier.setMuted(true);
    h.notifier.setVolume(0.25);
    expect(h.stored).toEqual({ muted: true, volume: 0.25 });
  });

  test("stored preferences are restored", () => {
    const h = harness();
    h.notifier.setVolume(0.3);
    const restored = new Notifier({
      baseTitle: "radshare",
      setTitle: () => {},
      storage: { read: () => h.stored, write: () => {} },
    });
    expect(restored.prefs.volume).toBe(0.3);
  });

  test("a corrupt stored volume is clamped, not trusted", () => {
    const restored = new Notifier({
      baseTitle: "radshare",
      setTitle: () => {},
      storage: { read: () => ({ volume: 99 }) as never, write: () => {} },
    });
    expect(restored.prefs.volume).toBe(1);
  });

  test("unreadable storage falls back to the defaults", () => {
    const restored = new Notifier({
      baseTitle: "radshare",
      setTitle: () => {},
      storage: {
        read: () => {
          throw new Error("denied");
        },
        write: () => {
          throw new Error("denied");
        },
      },
    });
    expect(restored.prefs).toEqual(DEFAULT_PREFS);
    expect(() => restored.setMuted(true)).not.toThrow();
  });

  test("preview plays at the current volume, for the settings control", () => {
    const h = harness();
    h.notifier.unlock();
    h.notifier.preview();
    expect(h.rec.oscillators.length).toBeGreaterThan(0);
  });
});
