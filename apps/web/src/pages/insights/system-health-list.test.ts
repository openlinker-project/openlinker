import { describe, expect, it } from 'vitest';
import type { ConnectionHealthEntry } from '../../features/health/api/health.types';
import { formatPlural, messagesIn, type PluralFn } from '../../shared/i18n';
import { describeSystemHealth, sortConnectedSystems } from './system-health-list';

const copy = messagesIn('analytics', 'en').insightsPage.systemHealth;
const plural: PluralFn = (count, forms, params) => formatPlural(count, forms, 'en', params);

function entry(name: string, status: ConnectionHealthEntry['status']): ConnectionHealthEntry {
  return { connectionId: `conn_${name}`, name, platformType: 'prestashop', status };
}

describe('system health (#4016)', () => {
  it('should put failing connected systems first, then warnings, then by name', () => {
    const sorted = sortConnectedSystems([
      entry('Zeta', 'ok'),
      entry('Beta', 'warning'),
      entry('Alpha', 'ok'),
      entry('Gamma', 'error'),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(['Gamma', 'Beta', 'Alpha', 'Zeta']);
  });

  it('should describe the share of failing and warning checks', () => {
    expect(describeSystemHealth(['ok', 'ok'], copy, plural)).toBe('All 2 checks passing.');
    expect(describeSystemHealth(['ok', 'error', 'error', 'ok', 'ok', 'ok'], copy, plural)).toBe(
      '2 of 6 checks failing.'
    );
    expect(describeSystemHealth(['ok', 'error', 'warning'], copy, plural)).toBe(
      '1 of 3 checks failing, 1 with a warning.'
    );
    expect(describeSystemHealth(['ok', 'warning'], copy, plural)).toBe(
      '1 of 2 checks with a warning.'
    );
  });
});
