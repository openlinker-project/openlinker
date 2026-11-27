import { describe, expect, it } from 'vitest';
import { isOutsideBox } from './use-backdrop-dismiss';

const box = { left: 8, right: 288, top: 8, bottom: 792 };

describe('isOutsideBox', () => {
  it('should report a point inside the box as inside', () => {
    expect(isOutsideBox(box, 100, 400)).toBe(false);
  });

  it('should count the box edge as inside', () => {
    expect(isOutsideBox(box, 288, 792)).toBe(false);
  });

  it('should report a point right of the box as outside', () => {
    expect(isOutsideBox(box, 300, 400)).toBe(true);
  });

  it('should report a point above the box as outside', () => {
    expect(isOutsideBox(box, 100, 4)).toBe(true);
  });
});
