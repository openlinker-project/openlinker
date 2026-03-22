import { describe, expect, it } from 'vitest';
import { getEnvironmentMeta } from './environment-badge';

describe('getEnvironmentMeta', () => {
  it('normalizes common environment labels', () => {
    expect(getEnvironmentMeta('development')).toEqual({
      label: 'Development',
      shortLabel: 'Dev',
      tone: 'info',
    });

    expect(getEnvironmentMeta('production')).toEqual({
      label: 'Production',
      shortLabel: 'Prod',
      tone: 'success',
    });
  });

  it('humanizes custom environments', () => {
    expect(getEnvironmentMeta('integration_lab')).toEqual({
      label: 'Integration Lab',
      shortLabel: 'Inte',
      tone: 'neutral',
    });
  });
});
