/**
 * Sourcing-rules api client (#3056)
 *
 * The load-bearing cases are the URLs. Every consumer of this slice mocks the
 * client, so a path that drifts — onto the ADR-012 `routing-rules` namespace,
 * or past an unencoded connection id — breaks nothing in any other test and
 * only ever fails against a real server.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildSourcingRulesPath, createSourcingRulesApi } from './sourcing-rules.api';

function rule(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'rule_1',
    connectionId: 'conn_1',
    position: 1,
    kind: 'filter',
    name: 'country-served',
    afterAction: 'continue',
    priorityLocationIds: [],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    recognised: true,
    ...overrides,
  };
}

describe('sourcing-rules api', () => {
  it('targets the sourcing-rules namespace, never the ADR-012 routing-rules one', () => {
    // `connections/:id/routing-rules` is the dispatch surface and a different
    // controller entirely; hitting it would answer 200 with the wrong rules.
    expect(buildSourcingRulesPath('conn_1')).toBe('/connections/conn_1/sourcing-rules');
  });

  it('emits includeSuperseded only when it was asked for, in both states', () => {
    expect(buildSourcingRulesPath('conn_1', {})).toBe('/connections/conn_1/sourcing-rules');
    // `false` is sent explicitly: the query DTO coerces only 'true'/'1', so an
    // omitted param relies on a server default rather than stating the request.
    expect(buildSourcingRulesPath('conn_1', { includeSuperseded: false })).toBe(
      '/connections/conn_1/sourcing-rules?includeSuperseded=false'
    );
    expect(buildSourcingRulesPath('conn_1', { includeSuperseded: true })).toBe(
      '/connections/conn_1/sourcing-rules?includeSuperseded=true'
    );
  });

  it('never stringifies undefined into the query', () => {
    expect(buildSourcingRulesPath('conn_1', { includeSuperseded: undefined })).toBe(
      '/connections/conn_1/sourcing-rules'
    );
  });

  it('encodes a connection id that needs escaping', () => {
    // The id reaches this client from a route param, i.e. from the address bar.
    expect(buildSourcingRulesPath('a/b c')).toBe('/connections/a%2Fb%20c/sourcing-rules');
  });

  it('lists rules through the boundary schema', async () => {
    const request = vi.fn().mockResolvedValue([rule()]);
    const rules = await createSourcingRulesApi(request).list('conn_1');

    expect(request).toHaveBeenCalledWith('/connections/conn_1/sourcing-rules');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('country-served');
  });

  it('gets one rule by id, with the rule id encoded too', async () => {
    const request = vi.fn().mockResolvedValue(rule({ id: 'a b' }));
    await createSourcingRulesApi(request).get('conn_1', 'a b');

    expect(request).toHaveBeenCalledWith('/connections/conn_1/sourcing-rules/a%20b');
  });

  it('posts a create body to the collection path', async () => {
    const request = vi.fn().mockResolvedValue(rule());
    await createSourcingRulesApi(request).create('conn_1', {
      position: 1,
      kind: 'filter',
      name: 'country-served',
      afterAction: 'continue',
    });

    expect(request).toHaveBeenCalledWith('/connections/conn_1/sourcing-rules', {
      method: 'POST',
      body: JSON.stringify({
        position: 1,
        kind: 'filter',
        name: 'country-served',
        afterAction: 'continue',
      }),
    });
  });

  it('patches, and sends an explicit null so a bound can be CLEARED', async () => {
    const request = vi.fn().mockResolvedValue(rule());
    await createSourcingRulesApi(request).update('conn_1', 'rule_1', { effectiveTo: null });

    // `null` clears the bound; omitting the key leaves it alone. Both states
    // have to survive JSON.stringify, and only an explicit null does.
    expect(request).toHaveBeenCalledWith('/connections/conn_1/sourcing-rules/rule_1', {
      method: 'PATCH',
      body: JSON.stringify({ effectiveTo: null }),
    });
  });

  it('puts the full id list to /order', async () => {
    const request = vi.fn().mockResolvedValue([rule()]);
    await createSourcingRulesApi(request).reorder('conn_1', { ruleIds: ['b', 'a'] });

    expect(request).toHaveBeenCalledWith('/connections/conn_1/sourcing-rules/order', {
      method: 'PUT',
      body: JSON.stringify({ ruleIds: ['b', 'a'] }),
    });
  });

  it('deletes without parsing a body', async () => {
    // 204, no body. Parsing here would throw on a successful delete.
    const request = vi.fn().mockResolvedValue(undefined);
    await expect(createSourcingRulesApi(request).remove('conn_1', 'rule_1')).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledWith('/connections/conn_1/sourcing-rules/rule_1', {
      method: 'DELETE',
    });
  });
});
