/**
 * Renders the match gong to a WAV so it can be listened to.
 *
 *   bun scripts/preview-gong.ts            -> gong.wav
 *   bun scripts/preview-gong.ts --out x.wav --volume 0.6
 *
 * T15's verify criterion is "distinguishable from Warframe audio in a
 * side-by-side listen", which no test can settle. This renders the real
 * spectrum — it imports `GONG_PARTIALS` rather than restating it, so a preview
 * that sounds right is evidence about the thing that ships, not about a copy
 * of it that has quietly drifted.
 *
 * Play it next to a Warframe UI sound. If it reads as a chime or a notification
 * blip, the partials have drifted toward integer ratios and it will be
 * mistaken for the game.
 */

import {
  GONG_FUNDAMENTAL_HZ,
  GONG_PARTIALS,
  GONG_DURATION_SECONDS,
  STRIKE_SECONDS,
  clampVolume,
} from "../apps/web/src/lib/audio/gong.ts";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) {
  const key = Bun.argv[i]?.replace(/^--/, "");
  if (key) args.set(key, Bun.argv[i + 1] ?? "");
}

const out = args.get("out") ?? "gong.wav";
const volume = clampVolume(Number(args.get("volume") ?? 0.6));
const fundamental = Number(args.get("hz") ?? GONG_FUNDAMENTAL_HZ);
const SAMPLE_RATE = 48_000;
const frames = Math.ceil(SAMPLE_RATE * GONG_DURATION_SECONDS);
const samples = new Float32Array(frames);

// The strike transient: decaying noise through a rough bandpass, matching the
// shape of the Web Audio graph closely enough to judge the character.
const strikeFrames = Math.floor(SAMPLE_RATE * STRIKE_SECONDS);
let bandpassState = 0;
for (let i = 0; i < strikeFrames; i += 1) {
  const envelope = (1 - i / strikeFrames) ** 2;
  const noise = Math.random() * 2 - 1;
  bandpassState += (noise - bandpassState) * 0.35;
  samples[i]! += (noise - bandpassState) * envelope * 0.5;
}

// The partials. Exponential decay, because struck metal decays exponentially
// and a linear fade audibly switches off.
for (const partial of GONG_PARTIALS) {
  const hz = fundamental * partial.ratio * 2 ** (partial.detune / 1200);
  const omega = (2 * Math.PI * hz) / SAMPLE_RATE;
  const decayFrames = partial.decay * SAMPLE_RATE;
  for (let i = 0; i < frames; i += 1) {
    const envelope = Math.exp((-5 * i) / decayFrames);
    if (envelope < 1e-5) break;
    samples[i]! += Math.sin(omega * i) * partial.gain * envelope;
  }
}

// Normalise, then apply the requested volume. Normalising first means the
// preview at 0.6 is the same loudness the app produces at 0.6.
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
const scale = peak > 0 ? (0.89 / peak) * volume : 0;

const bytes = Buffer.alloc(44 + frames * 2);
bytes.write("RIFF", 0);
bytes.writeUInt32LE(36 + frames * 2, 4);
bytes.write("WAVE", 8);
bytes.write("fmt ", 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20); // PCM
bytes.writeUInt16LE(1, 22); // mono
bytes.writeUInt32LE(SAMPLE_RATE, 24);
bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
bytes.writeUInt16LE(2, 32);
bytes.writeUInt16LE(16, 34);
bytes.write("data", 36);
bytes.writeUInt32LE(frames * 2, 40);

for (let i = 0; i < frames; i += 1) {
  const v = Math.max(-1, Math.min(1, samples[i]! * scale));
  bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

await Bun.write(out, bytes);

console.log(`wrote ${out}`);
console.log(`  ${GONG_DURATION_SECONDS}s, ${fundamental}Hz fundamental, volume ${volume}`);
console.log(`  ${GONG_PARTIALS.length} partials at ratios ${GONG_PARTIALS.map((p) => p.ratio).join(", ")}`);
console.log(`  longest tail ${GONG_PARTIALS[0]!.decay}s`);
