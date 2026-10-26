import { describe, expect, it } from 'vitest';

import { ROUTING_DRY_RUN_COPY as COPY } from './routing-dry-run.copy';

describe('ROUTING_DRY_RUN_COPY', () => {
  it('should pluralise how many lines would move', () => {
    expect(COPY.compareChanged(1)).toBe('1 line would move');
    expect(COPY.compareChanged(3)).toBe('3 lines would move');
  });

  it('should state that a dry run commits nothing', () => {
    expect(COPY.banner).toMatch(/nothing is committed/i);
  });

  it('should say a failed test changed nothing', () => {
    expect(COPY.errorNothingChanged).toBe('Nothing was changed.');
  });
});
