/**
 * What the bench sounds like (#2421, `W3b-8`, story C4)
 *
 * ## Sound carries a signal here because the packer is not looking at the screen
 *
 * C4's own reason: *"glare, gloves, one hand occupied, a bench-height screen"*,
 * and the packer's eyes are on the box. So a refusal is **audible**, and
 * `wrong-item` and `over-scan` are **distinguishable by ear** — because the two
 * remedies are different acts. Wrong item means *this does not belong in this
 * box*: put it down, find the right one. Over-scan means *this box already has
 * enough of these*: the item is right and the count is full. A packer who
 * cannot tell them apart without looking up has gained nothing from the sound.
 *
 * They are therefore separated on THREE axes at once, not one:
 *
 * | kind         | pulses | direction  | pitch          |
 * |--------------|--------|------------|----------------|
 * | `wrong-item` | two    | descending | low (392→262)  |
 * | `over-scan`  | one    | flat       | high (784)     |
 *
 * A single axis would not survive a floor. Pitch alone is lost to a compressor,
 * a cheap terminal speaker and a forklift; pulse count alone is lost when two
 * refusals land close together. Two short falling notes versus one long high
 * note are told apart by someone facing away with a box in both hands.
 *
 * ## Sound is an ADDITION, never the carrier
 *
 * A floor may be loud, the terminal may be muted at the OS, and a deaf packer
 * must lose nothing. Every kind below has a visible counterpart that renders
 * whatever this module does — asserted by `bench-scan-sound.test.ts`, which
 * compares the rendered refusal markup with audio on and audio off and requires
 * it to be identical. Muting is therefore safe by construction rather than by
 * discipline: the mute reaches this module and nothing else.
 *
 * ## The patterns are DATA and the player is a thin shell
 *
 * The distinguishability rule above is a property of the table, so it is
 * asserted against the table — no WebAudio, no jsdom shim, no timing. The
 * player is separately allowed to do nothing at all: `AudioContext` is absent
 * in tests, may be `suspended` until the browser sees user activation, and may
 * throw on a locked-down terminal. Every one of those degrades to silence, and
 * silence is a supported state because the visible signal is the real one.
 *
 * @module apps/web/src/features/bench/lib
 */

/** Which refusal is being sounded. */
export const SCAN_SOUND_KIND_VALUES = [
  'wrong-item',
  'over-scan',
  'unreachable',
  'failed',
  'confirm',
] as const;
export type ScanSoundKind = (typeof SCAN_SOUND_KIND_VALUES)[number];

/** One note. `hz` at zero is a rest between pulses. */
export interface ScanTone {
  readonly hz: number;
  readonly ms: number;
}

/**
 * The signatures, and the ONE place they are defined.
 *
 * `wrong-item` and `over-scan` are the pair C4 names; `unreachable` and `failed`
 * exist so a packer can tell a refusal apart from *"this never reached
 * OpenLinker"*, which is a different instruction — scan it again rather than put
 * the item down. `confirm` is the ONE entry that is not a refusal at all.
 */
export const SCAN_SOUND_PATTERNS: Readonly<Record<ScanSoundKind, readonly ScanTone[]>> = {
  // Two short falling notes: "no — not that one."
  'wrong-item': [
    { hz: 392, ms: 110 },
    { hz: 0, ms: 60 },
    { hz: 262, ms: 160 },
  ],
  // One long high note: "that one is fine, the box is full."
  'over-scan': [{ hz: 784, ms: 300 }],
  // Three low taps: the bench itself, not the item.
  unreachable: [
    { hz: 220, ms: 90 },
    { hz: 0, ms: 70 },
    { hz: 220, ms: 90 },
    { hz: 0, ms: 70 },
    { hz: 220, ms: 90 },
  ],
  // One short mid note: nothing was recorded, try the same item again.
  failed: [{ hz: 523, ms: 140 }],
  /**
   * NOT a refusal — the only kind here that is not.
   *
   * It exists so switching the sound back on can prove it works. Reusing a
   * refusal signature for that would be worse than silence: a packer who hears
   * the over-scan tone as a "sound is on" chirp learns that tone means the
   * toggle worked, which is exactly the association that stops it meaning
   * *this box already has enough of these* when it matters. Two rising notes,
   * a shape no refusal has.
   */
  confirm: [
    { hz: 523, ms: 70 },
    { hz: 0, ms: 40 },
    { hz: 880, ms: 110 },
  ],
};

/** Total wall-clock length of a pattern, rests included. */
export function scanSoundDurationMs(kind: ScanSoundKind): number {
  return SCAN_SOUND_PATTERNS[kind].reduce((total, tone) => total + tone.ms, 0);
}

/**
 * Do these two patterns differ by EAR, not merely by value?
 *
 * Two patterns that differ only in a few hertz are equal on a warehouse floor,
 * so this asks the question C4 actually asks: a listener must be able to name
 * which one they heard. Any ONE of three separations is enough, and the
 * `wrong-item` / `over-scan` pair carries all three.
 */
export function soundsDistinguishable(a: ScanSoundKind, b: ScanSoundKind): boolean {
  if (a === b) return false;

  const left = SCAN_SOUND_PATTERNS[a];
  const right = SCAN_SOUND_PATTERNS[b];

  const audiblePulses = (tones: readonly ScanTone[]): number =>
    tones.filter((tone) => tone.hz > 0).length;
  if (audiblePulses(left) !== audiblePulses(right)) return true;

  // A musical fourth apart at the opening note — comfortably past what a cheap
  // bench speaker and a noisy room blur together.
  const opening = (tones: readonly ScanTone[]): number => tones[0]?.hz ?? 0;
  const ratio =
    Math.max(opening(left), opening(right)) / Math.max(1, Math.min(opening(left), opening(right)));
  if (ratio >= 1.33) return true;

  // A pattern half again as long as the other reads as a different signal even
  // at the same pitch and pulse count.
  const longer = Math.max(scanSoundDurationMs(a), scanSoundDurationMs(b));
  const shorter = Math.max(1, Math.min(scanSoundDurationMs(a), scanSoundDurationMs(b)));
  return longer / shorter >= 1.5;
}

// ── The player ──────────────────────────────────────────────────────────────

const MUTE_STORAGE_KEY = 'ol.bench.audioMuted';

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * ONE context for the life of the tab.
 *
 * A context per beep leaks them — browsers cap the number a page may hold, and
 * a packer makes hundreds of gestures a shift — so it is created lazily and
 * kept. Lazily rather than at module load because construction before any user
 * gesture is what leaves a context stuck `suspended`.
 */
let sharedContext: AudioContext | null = null;

function acquireContext(): AudioContext | null {
  if (sharedContext !== null) return sharedContext;
  const Ctor = resolveAudioContextCtor();
  if (Ctor === null) return null;
  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    // A locked-down terminal, or a browser refusing another context. Silence is
    // a supported outcome; the visible signal is the real one.
    return null;
  }
}

/** Is the bench audio switched off? Defaults to ON — a refusal should be heard. */
export function isBenchAudioMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    // Storage refused (private mode, a policy). Unmuted is the safe direction:
    // an operator who wanted silence can press the control again, whereas a
    // silent bench nobody asked for hides refusals.
    return false;
  }
}

/**
 * Switch the bench audio on or off.
 *
 * `localStorage`, not `sessionStorage`: this is a property of the ROOM, not of
 * one packer's tab — a bench next to a compressor should stay muted across a
 * reload and across a handover. It holds no credential, so the
 * no-token-in-storage rule is not in tension with it.
 */
export function setBenchAudioMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // The preference is lost on reload and nothing else changes.
  }
}

/**
 * Sound one refusal. Never throws, and never reports whether it was heard.
 *
 * A caller that branched on the return value would be a caller that could
 * decide not to render the visible signal, which is the one thing C4 forbids.
 */
export function playScanSound(kind: ScanSoundKind): void {
  if (isBenchAudioMuted()) return;

  const context = acquireContext();
  if (context === null) return;

  try {
    // Chrome starts a context suspended until it has seen user activation. A
    // scanner burst IS keystrokes and counts, but the very first one can still
    // arrive before the resume settles — so resume every time and ignore the
    // promise; a missed first beep is not worth a branch.
    void context.resume?.();

    let at = context.currentTime;
    for (const tone of SCAN_SOUND_PATTERNS[kind]) {
      const seconds = tone.ms / 1000;
      if (tone.hz > 0) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = tone.hz;
        // A short ramp at each end: a square wave started and stopped abruptly
        // clicks, and a click is another sound the packer has to interpret.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + seconds);
      }
      at += seconds;
    }
  } catch {
    // Silence.
  }
}

/** Test seam — drops the cached context so a spec can start from nothing. */
export function resetBenchAudioForTests(): void {
  sharedContext = null;
}
