/**
 * The match gong. Synthesised rather than shipped — a few dozen lines against
 * several hundred KB on a page that must paint before JavaScript runs.
 *
 * One job: reach someone in a fullscreen mission on the same machine, inside
 * sixty seconds, without being mistaken for the game. Hence:
 *
 * - **Inharmonic.** Integer multiples are a musical tone — a bell, a chime, a
 *   UI beep. Struck metal is not, and that is the difference between "the app
 *   wants me" and "something happened in game".
 * - **Long decay.** Covers the "did I hear that?" moment, so it need not
 *   repeat. A repeating alert gets muted, and a muted tool reaches nobody.
 * - **Low fundamental.** Carries through game audio, which is already full of
 *   short bright blips.
 */

export type GongPartial = {
  /** Deliberately not an integer. */
  ratio: number;
  gain: number;
  /** Seconds to near-silence. High partials die first, as in real metal. */
  decay: number;
  /** Cents. Pairs beat against each other and produce the shimmer. */
  detune: number;
};

/** Low enough to cut through game audio, high enough for a laptop speaker. */
export const GONG_FUNDAMENTAL_HZ = 138;

/** If these ever become 1, 2, 3, 4 the sound becomes a chime. */
export const GONG_PARTIALS: readonly GongPartial[] = [
  { ratio: 1, gain: 1.0, decay: 6.0, detune: 0 },
  { ratio: 1.47, gain: 0.72, decay: 5.2, detune: 6 },
  { ratio: 1.93, gain: 0.55, decay: 4.4, detune: -8 },
  { ratio: 2.41, gain: 0.42, decay: 3.6, detune: 11 },
  { ratio: 3.17, gain: 0.3, decay: 2.8, detune: -5 },
  { ratio: 3.86, gain: 0.22, decay: 2.2, detune: 9 },
  { ratio: 4.73, gain: 0.15, decay: 1.6, detune: -12 },
  { ratio: 5.91, gain: 0.1, decay: 1.1, detune: 7 },
];

/** The mallet, not the tone. */
export const STRIKE_SECONDS = 0.14;

/** Longest partial plus a margin. */
export const GONG_DURATION_SECONDS = 6.5;

/**
 * Narrowed to what is used, so tests can supply a recorder — Bun has no Web
 * Audio, and a gong verifiable only by ear is a gong nobody verifies.
 */
export type AudioTarget = {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createBiquadFilter(): BiquadFilterNode;
};

/**
 * One strike. Every node is stopped at the end of its own tail — an alert that
 * leaks an oscillator per match would degrade the tab it was saving.
 */
export function strike(ctx: AudioTarget, volume: number, fundamental = GONG_FUNDAMENTAL_HZ): void {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = clampVolume(volume);
  master.connect(ctx.destination);

  // Without the mallet the partials fade in and it reads as a synth pad.
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * STRIKE_SECONDS), ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
  }
  noise.buffer = buffer;

  const strikeFilter = ctx.createBiquadFilter();
  strikeFilter.type = "bandpass";
  strikeFilter.frequency.value = fundamental * 6;
  strikeFilter.Q.value = 0.7;

  const strikeGain = ctx.createGain();
  strikeGain.gain.setValueAtTime(0.5, now);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + STRIKE_SECONDS);

  noise.connect(strikeFilter);
  strikeFilter.connect(strikeGain);
  strikeGain.connect(master);
  noise.start(now);
  noise.stop(now + STRIKE_SECONDS);

  for (const partial of GONG_PARTIALS) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = fundamental * partial.ratio;
    osc.detune.value = partial.detune;

    const gain = ctx.createGain();
    // Exponential: a linear ramp audibly "switches off".
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(partial.gain, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + partial.decay);
  }
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

/** Metal, not a chime. */
export function isInharmonic(partials: readonly GongPartial[] = GONG_PARTIALS): boolean {
  return partials.every((p) => p.ratio === 1 || Math.abs(p.ratio - Math.round(p.ratio)) > 0.05);
}
