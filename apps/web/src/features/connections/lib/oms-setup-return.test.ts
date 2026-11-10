import { describe, expect, it } from 'vitest';
import {
  createdConnectionLandingPath,
  isFromOmsSetup,
  withOmsSetupReturn,
} from './oms-setup-return';

describe('oms-setup-return', () => {
  it('recognises only the literal oms-setup marker', () => {
    expect(isFromOmsSetup(new URLSearchParams('from=oms-setup'))).toBe(true);
    expect(isFromOmsSetup(new URLSearchParams('from=/settings/packing'))).toBe(false);
    expect(isFromOmsSetup(new URLSearchParams(''))).toBe(false);
  });

  it('appends the marker with the right separator, and only when the trip started there', () => {
    expect(withOmsSetupReturn('/connections/new/inpost', true)).toBe(
      '/connections/new/inpost?from=oms-setup'
    );
    expect(withOmsSetupReturn('/x?a=1', true)).toBe('/x?a=1&from=oms-setup');
    expect(withOmsSetupReturn('/connections/new/inpost', false)).toBe('/connections/new/inpost');
  });

  it('lands a new carrier on its detail page flagged as just created', () => {
    expect(createdConnectionLandingPath('c1', false)).toBe('/connections/c1?created=1');
    expect(createdConnectionLandingPath('c1', true)).toBe(
      '/connections/c1?created=1&from=oms-setup'
    );
  });
});
