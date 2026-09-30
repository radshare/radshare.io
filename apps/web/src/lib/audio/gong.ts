/**
 * The match gong.
 *
 * Synthesised rather than shipped as a file. A gong is a handful of inharmonic
 * partials with staggered decays, which is a few dozen lines — and an audio
 * asset would be several hundred kilobytes on a page whose entire claim is
 * that it paints a populated board before JavaScript runs.
 *
 * It has one job: reach someone who is in a fullscreen Warframe mission on the
 * same machine, inside a 60-second window, without being mistaken for the
 * game. Three properties follow from that and none of them are decoration:
 *
 * - **Inharmonic.** The partials are deliberately NOT integer multiples of the
 *   fundamental. Integer multiples are a musical tone — a bell, a chime, a UI
 *   beep. Metal struck in the middle is inharmonic, and that is the whole
 *   difference between "the app wants me" and "something happened in game".
 *   Warframe's palette is bright and synthetic; this is low and acoustic.
 * - **Long decay.** The tail covers the "did I hear that?" moment, so the cue
 *   does not need to repeat itself. A repeating alert is how a tool gets muted
 *   permanently, and a muted tool never reaches anyone again.
 * - **Low fundamental.** It carries through game audio better than a short
 *   bright blip, which is exactly what game audio is already full of.
 */

/** One struck partial. */
export type GongPartial = {
  /** Multiple of the fundamental. Deliberately not an integer. */
  ratio: number;
  /** Relative amplitude at the strike. */
  gain: number;
  /** Seconds to near-silence. High partials die first, as in real metal. */
  decay: number;
  /** Cents of detune. Pairs beat against each other and produce the shimmer. */
  detune: number;
};

/**
 * Low enough to cut through game audio, high enough to survive a laptop
 * speaker that rolls off below about 150Hz.
 */
export const GONG_FUNDAMENTAL_HZ = 138;

/**
 * The spectrum.
 *
 * Ratios are irrational-looking on purpose. If these ever become 1, 2, 3, 4
 * the sound becomes a chime and stops doing its job.
 */
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

/** How long the strike transient lasts. Short: it is the mallet, not the tone. */
export const STRIKE_SECONDS = 0.14;

/** Longest partial plus a margin, so nothing is cut off mid-tail. */
export const GONG_DURATION_SECONDS = 6.5;

/**
 * The subset of the Web Audio API this needs.
 *
 * Narrowed to what is used so the tests can supply a recorder instead of a
 * real context — Bun has no Web Audio, and a gong that can only be verified by
 * listening is a gong nobody verifies.
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
 * Builds and fires one strike.
 *
 * Every node is created per strike and stopped at the end of its own tail.
 * Nothing is pooled and nothing is left running — an alert that leaks an
 * oscillator per match would degrade the tab it was trying to save.
 */
export function strike(ctx: AudioTarget, volume: number, fundamental = GONG_FUNDAMENTAL_HZ): void {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = clampVolume(volume);
  master.connect(ctx.destination);

  // The mallet: a short filtered noise burst. Without it the partials fade in
  // and it reads as a synth pad rather than as something being hit.
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
    // Exponential, because amplitude decay in struck metal is exponential and
    // a linear ramp audibly "switches off".
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

/** True when no partial is an integer multiple — i.e. it is metal, not a chime. */
export function isInharmonic(partials: readonly GongPartial[] = GONG_PARTIALS): boolean {
  return partials.every((p) => p.ratio === 1 || Math.abs(p.ratio - Math.round(p.ratio)) > 0.05);
}
