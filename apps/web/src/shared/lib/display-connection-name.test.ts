import { describe, expect, it } from 'vitest';

import { displayConnectionName } from './display-connection-name';

describe('displayConnectionName', () => {
  it('should strip a trailing ISO timestamp when the name carries one', () => {
    expect(displayConnectionName('Allegro sandbox (2026-11-21T23:23:24.209Z)')).toBe('Allegro sandbox');
  });

  it('should keep an ordinary name untouched', () => {
    expect(displayConnectionName('Subiekt GT (test)')).toBe('Subiekt GT (test)');
  });
});
