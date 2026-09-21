import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './app-version';

describe('APP_VERSION', () => {
  it('resolves to the string injected by the Vite/Vitest define, not left unset', () => {
    // The Vitest config injects the same `__APP_VERSION__` define as the
    // build, so this exercises the module-level `typeof` guard's live
    // branch rather than only the component's rendering of a passed-in prop.
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});
