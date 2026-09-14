/**
 * The bench's two refusal sounds (#2421, `W3b-8`, story C4)
 *
 * C4's requirement is not "there is a sound" — it is that **wrong-item and
 * over-scan are distinguishable by sound**, because the remedies differ. These
 * assert that against the pattern table, which is where the property lives; the
 * player is separately allowed to be silent, and silence is a supported state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isBenchAudioMuted,
  playScanSound,
  resetBenchAudioForTests,
  SCAN_SOUND_KIND_VALUES,
  SCAN_SOUND_PATTERNS,
  scanSoundDurationMs,
  setBenchAudioMuted,
  soundsDistinguishable,
} from './bench-scan-sound';

describe('bench scan sounds (#2421, C4)', () => {
  beforeEach(() => {
    resetBenchAudioForTests();
    window.localStorage.clear();
  });

  // ── The one requirement C4 states by name ────────────────────────────────
  it('should make wrong-item and over-scan distinguishable by ear', () => {
    expect(soundsDistinguishable('wrong-item', 'over-scan')).toBe(true);
  });

  it('should separate that pair on ALL THREE axes, not just one', () => {
    // A single separation is not enough on a floor: pitch alone is lost to a
    // cheap speaker and a forklift, pulse count alone is lost when two
    // refusals land close together.
    const wrong = SCAN_SOUND_PATTERNS['wrong-item'];
    const over = SCAN_SOUND_PATTERNS['over-scan'];

    const pulses = (tones: typeof wrong): number => tones.filter((t) => t.hz > 0).length;
    expect(pulses(wrong)).not.toBe(pulses(over));

    // Pitch: a musical fourth or more apart at the opening note.
    expect(over[0].hz / wrong[0].hz).toBeGreaterThanOrEqual(1.33);

    // Shape: one falls, the other is flat.
    expect(wrong.filter((t) => t.hz > 0).map((t) => t.hz)).toEqual([392, 262]);
    expect(over.filter((t) => t.hz > 0)).toHaveLength(1);
  });

  it('should make every declared kind distinguishable from every other', () => {
    // Not only the named pair: "the bench cannot reach OpenLinker" is a
    // different instruction from "wrong item", so it must not sound like one.
    for (const a of SCAN_SOUND_KIND_VALUES) {
      for (const b of SCAN_SOUND_KIND_VALUES) {
        if (a === b) continue;
        expect(soundsDistinguishable(a, b), `${a} vs ${b}`).toBe(true);
      }
    }
  });

  it('should report a sound as indistinguishable from itself', () => {
    // Guards the helper against a trivially-true implementation.
    for (const kind of SCAN_SOUND_KIND_VALUES) {
      expect(soundsDistinguishable(kind, kind)).toBe(false);
    }
  });

  it('should keep every refusal short enough to precede the next scan', () => {
    // A packer scans faster than a second. A sound that outlasts the next
    // gesture stops being a per-gesture signal.
    for (const kind of SCAN_SOUND_KIND_VALUES) {
      expect(scanSoundDurationMs(kind)).toBeLessThanOrEqual(500);
      expect(scanSoundDurationMs(kind)).toBeGreaterThan(0);
    }
  });

  // ── The player degrades rather than throwing ─────────────────────────────
  it('should stay silent and NOT throw where the browser has no audio', () => {
    // jsdom has no `AudioContext`, which is also the shape of a locked-down
    // terminal. Silence is supported because the visible signal is the real one.
    expect(() => {
      playScanSound('wrong-item');
    }).not.toThrow();
  });

  it('should not reach the audio engine at all while muted', () => {
    const construct = vi.fn();
    class FakeContext {
      currentTime = 0;
      constructor() {
        construct();
      }
      resume(): void {}
      createOscillator(): unknown {
        return {};
      }
      createGain(): unknown {
        return {};
      }
      destination = {};
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;

    setBenchAudioMuted(true);
    playScanSound('over-scan');

    expect(construct).not.toHaveBeenCalled();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  // ── The mute ─────────────────────────────────────────────────────────────
  it('should default to audible, so a refusal is heard on a bench nobody configured', () => {
    expect(isBenchAudioMuted()).toBe(false);
  });

  it('should round-trip the mute so a loud bench stays quiet across a reload', () => {
    setBenchAudioMuted(true);
    expect(isBenchAudioMuted()).toBe(true);
    setBenchAudioMuted(false);
    expect(isBenchAudioMuted()).toBe(false);
  });

  it('should read as audible when storage refuses, never as muted', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage disabled');
      });

    // Unmuted is the safe direction: an operator who wants silence can press
    // the control again, whereas a silent bench nobody asked for hides refusals.
    expect(isBenchAudioMuted()).toBe(false);

    getItem.mockRestore();
  });

  it('should not throw when storage refuses a write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => {
      setBenchAudioMuted(true);
    }).not.toThrow();

    setItem.mockRestore();
  });
});
