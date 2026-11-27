import { describe, expect, it } from 'vitest';
import { readScrollEdges } from './use-scroll-edges';

describe('readScrollEdges', () => {
  it('should report no edges when the content fits', () => {
    expect(readScrollEdges({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toEqual({
      up: false,
      down: false,
    });
  });

  it('should report only down when at the top of overflowing content', () => {
    expect(readScrollEdges({ scrollTop: 0, scrollHeight: 900, clientHeight: 400 })).toEqual({
      up: false,
      down: true,
    });
  });

  it('should report both when scrolled to the middle', () => {
    expect(readScrollEdges({ scrollTop: 200, scrollHeight: 900, clientHeight: 400 })).toEqual({
      up: true,
      down: true,
    });
  });

  it('should report only up when a sub-pixel remainder is left at the bottom', () => {
    expect(readScrollEdges({ scrollTop: 499, scrollHeight: 900, clientHeight: 400 })).toEqual({
      up: true,
      down: false,
    });
  });
});
