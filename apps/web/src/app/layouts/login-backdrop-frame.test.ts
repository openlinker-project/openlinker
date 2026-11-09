/**
 * backdropFrame tests (#4029)
 *
 * @module app/layouts
 */
import { describe, expect, it } from 'vitest';
import { backdropFrame } from './login-backdrop';

describe('backdropFrame', () => {
  it('should lay out the base panel and scale it up a little on an ordinary screen', () => {
    expect(backdropFrame(1500, 960)).toEqual({ width: 1280, height: 800, scale: 1.2, offset: 0 });
  });

  it('should widen the panel instead of blowing it up on an ultra-wide screen', () => {
    const frame = backdropFrame(3400, 1500);
    expect(frame.scale).toBe(1.5);
    expect(frame.width * frame.scale).toBeGreaterThanOrEqual(3400);
    expect(frame.height * frame.scale).toBeGreaterThanOrEqual(1500);
  });

  it('should never lay out a desktop panel smaller than the base size', () => {
    expect(backdropFrame(1100, 700)).toEqual({ width: 1280, height: 800, scale: 0.875, offset: 0 });
  });

  it('should show the phone panel at real size, inside the bleed, below the shell breakpoint', () => {
    expect(backdropFrame(450, 1460)).toEqual({ width: 390, height: 1400, scale: 1, offset: 30 });
  });

  it('should switch to the desktop panel exactly where the app shell does', () => {
    expect(backdropFrame(1083, 900).scale).toBe(1);
    expect(backdropFrame(1083, 900).offset).toBe(30);
    expect(backdropFrame(1084, 900).offset).toBe(0);
  });
});
