import { describe, expect, it } from 'vitest';
import type { Connection, ConnectionStatus } from '../../features/connections';
import { formatPlural, loadMessages, messagesIn, type PluralFn } from '../../shared/i18n';
import {
  bucketOf,
  describeConnectionHealth,
  sortConnectionHealthRows,
  summarizeConnectionHealth,
  type ConnectionHealthRow,
} from './connection-health';

function row(
  name: string,
  deadJobCount: number,
  status: ConnectionStatus = 'active'
): ConnectionHealthRow {
  const connection = {
    id: `conn_${name}`,
    name,
    platformType: 'prestashop',
    status,
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Connection;
  return { connection, deadJobCount };
}

const copy = messagesIn('analytics', 'en').insightsPage.connectionHealth;
const plural: PluralFn = (count, forms, params) => formatPlural(count, forms, 'en', params);

describe('connection health (#4016)', () => {
  it('should put the most failed jobs first, then broken connections, then by name', () => {
    const sorted = sortConnectionHealthRows([
      row('Zeta', 0),
      row('Alpha', 1),
      row('Beta', 4),
      row('Off', 0, 'disabled'),
      row('Broken', 0, 'needs_reauth'),
      row('Gamma', 4),
    ]);
    expect(sorted.map((r) => r.connection.name)).toEqual([
      'Beta',
      'Gamma',
      'Alpha',
      'Broken',
      'Zeta',
      'Off',
    ]);
  });

  it('should bucket a connection with dead jobs as attention even when its status is active', () => {
    expect(bucketOf(row('A', 2))).toBe('attention');
    expect(bucketOf(row('B', 0, 'error'))).toBe('attention');
    expect(bucketOf(row('C', 0, 'disabled'))).toBe('off');
    expect(bucketOf(row('D', 0))).toBe('healthy');
  });

  it('should count the buckets and describe the failed-job share', () => {
    const summary = summarizeConnectionHealth([
      row('A', 4),
      row('B', 1),
      row('C', 0),
      row('D', 0, 'disabled'),
    ]);
    expect(summary).toEqual({ total: 4, withFailedJobs: 2, attention: 2, healthy: 1, off: 1 });
    expect(describeConnectionHealth(summary, copy, plural)).toBe(
      '2 of 4 connections have jobs that stopped retrying.'
    );
  });

  it('should say so when no connection has failed jobs', () => {
    expect(
      describeConnectionHealth(summarizeConnectionHealth([row('A', 0), row('B', 0)]), copy, plural)
    ).toBe('No failed jobs on any of your 2 connections.');
  });

  it('should name the unreachable share when no connection has failed jobs', () => {
    expect(
      describeConnectionHealth(
        summarizeConnectionHealth([row('A', 0), row('B', 0, 'needs_reauth')]),
        copy,
        plural
      )
    ).toBe('No failed jobs, but 1 of 2 connections cannot reach their platform.');
  });

  it('should read naturally when the only connection has failed jobs', () => {
    expect(describeConnectionHealth(summarizeConnectionHealth([row('A', 3)]), copy, plural)).toBe(
      'Your only connection has jobs that stopped retrying.'
    );
  });

  it('should write the summary in Polish with the right plural form', async () => {
    await loadMessages('pl');
    const plCopy = messagesIn('analytics', 'pl').insightsPage.connectionHealth;
    const plPlural: PluralFn = (count, forms, params) => formatPlural(count, forms, 'pl', params);
    const summary = summarizeConnectionHealth([row('A', 4), row('B', 1), row('C', 0), row('D', 0)]);
    expect(describeConnectionHealth(summary, plCopy, plPlural)).toBe(
      '2 z 4 połączeń mają zadania w tle, które przestały być ponawiane.'
    );
  });
});
