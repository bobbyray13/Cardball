import type { GameEvent, GameEventKind } from '@cardball/engine';

/**
 * The sounds of a game night, synthesized with WebAudio as they happen — no
 * audio files to license, load, or go stale. The browser only lets audio
 * start after a user gesture, and every beat here follows one (a click on
 * "throw the pitch"), so the context is created lazily on first play.
 * Sound is decoration: nothing here is allowed to throw into the game.
 */

export type SoundKind = 'dice' | 'bat' | 'catch' | 'cheer' | 'home-run';

const PREF_KEY = 'cb_sound';

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // A private-browsing mode that refuses storage keeps the session default.
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
  return ctx;
}

function noise(c: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A short burst of filtered noise — the raw material of clacks, cracks, and pops. */
function burst(
  c: AudioContext,
  at: number,
  seconds: number,
  volume: number,
  filter: { type: BiquadFilterType; from: number; to?: number; q?: number },
): void {
  const src = c.createBufferSource();
  src.buffer = noise(c, seconds);
  const biquad = c.createBiquadFilter();
  biquad.type = filter.type;
  biquad.frequency.setValueAtTime(filter.from, at);
  if (filter.to !== undefined) biquad.frequency.exponentialRampToValueAtTime(filter.to, at + seconds);
  if (filter.q !== undefined) biquad.Q.value = filter.q;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(biquad).connect(gain).connect(c.destination);
  src.start(at);
  src.stop(at + seconds);
}

/** A short tone with a decay — thumps and organ stings. */
function tone(c: AudioContext, at: number, fromHz: number, toHz: number, seconds: number, volume: number, type: OscillatorType = 'sine'): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, at);
  if (toHz !== fromHz) osc.frequency.exponentialRampToValueAtTime(toHz, at + seconds);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + seconds);
}

/** Dice on a table: three clacks, each a little duller than the last. */
function dice(c: AudioContext, at: number): void {
  burst(c, at, 0.03, 0.5, { type: 'bandpass', from: 3800, to: 2100, q: 1.4 });
  burst(c, at + 0.06, 0.026, 0.4, { type: 'bandpass', from: 3200, to: 1800, q: 1.2 });
  burst(c, at + 0.11, 0.022, 0.3, { type: 'bandpass', from: 2600, to: 1400, q: 1 });
  tone(c, at, 190, 120, 0.08, 0.12);
}

/** Bat on ball: a bright crack. */
function bat(c: AudioContext, at: number): void {
  burst(c, at, 0.02, 0.6, { type: 'highpass', from: 2600 });
  tone(c, at, 1500, 900, 0.05, 0.2);
}

/** The ball finding leather: a soft pop. */
function catchPop(c: AudioContext, at: number): void {
  burst(c, at, 0.05, 0.45, { type: 'lowpass', from: 900, to: 300 });
  tone(c, at, 170, 110, 0.09, 0.22);
}

/** The crowd, swelling for a moment. */
function cheer(c: AudioContext, at: number, seconds: number): void {
  const src = c.createBufferSource();
  src.buffer = noise(c, seconds);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 750;
  band.Q.value = 0.7;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.28, at + seconds * 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(band).connect(gain).connect(c.destination);
  src.start(at);
  src.stop(at + seconds);
}

/** The ballpark organ, gliding up an octave — a home run has left the yard. */
function organ(c: AudioContext, at: number): void {
  const start = at + 0.25;
  for (const [i, hz] of [262, 330, 392].entries()) {
    tone(c, start + i * 0.05, hz, hz * 2, 0.9, 0.14, 'triangle');
  }
}

export function playSound(kind: SoundKind): void {
  if (!soundEnabled()) return;
  // A background tab should not start sounds from socket-driven game updates.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const c = audio();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume().catch(() => undefined);
    const at = c.currentTime + 0.015;
    switch (kind) {
      case 'dice':
        dice(c, at);
        break;
      case 'bat':
        bat(c, at);
        break;
      case 'catch':
        catchPop(c, at);
        break;
      case 'cheer':
        cheer(c, at, 0.55);
        break;
      case 'home-run':
        cheer(c, at, 1.25);
        organ(c, at);
        break;
    }
  } catch {
    // Sound is decoration; never let it throw into the game.
  }
}

/**
 * What a play-by-play beat sounds like. Pure, so tests can pin the mapping:
 * dice for any roll, the crack on contact, leather on the out, the crowd for
 * a hit or a run, and the organ only for a home run.
 */
export function soundFor(event: { kind: GameEventKind; refs?: { hitKind?: unknown } | null | undefined; rolls?: unknown[] | undefined }): SoundKind | null {
  switch (event.kind) {
    case 'contact':
      return 'bat';
    case 'out':
    case 'dp-made':
    case 'dp-failed':
      return 'catch';
    case 'hit':
      return event.refs?.hitKind === 'home-run' ? 'home-run' : 'cheer';
    case 'run':
    case 'game-over':
      return 'cheer';
  }
  if (event.rolls && event.rolls.length > 0) return 'dice';
  return null;
}

/** Type re-export so callers can annotate without importing the engine types. */
export type { GameEvent };
