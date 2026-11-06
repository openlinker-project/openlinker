/**
 * backdropFrame tests (#4029)
 *
 * @module app/layouts
 */
import { describe, expect, it } from 'vitest';
import { backdropFrame } from './login-backdrop';

describe('backdropFrame', () => {
  it('should lay out the base panel and scale it up a little on an ordinary screen', () => {
    expect(backdropFrame(1500, 960)).toEqual({ width: 1280, height: 800, scale: 1.2 });
  });

  it('should widen the panel instead of blowing it up on an ultra-wide screen', () => {
    const frame = backdropFrame(3400, 1500);
    expect(frame.scale).toBe(1.5);
    expect(frame.width * frame.scale).toBeGreaterThanOrEqual(3400);
    expect(frame.height * frame.scale).toBeGreaterThanOrEqual(1500);
  });

  it('should never lay out a panel smaller than the base size', () => {
    expect(backdropFrame(390, 844)).toEqual({ width: 1280, height: 800, scale: 1.055 });
  });
});
