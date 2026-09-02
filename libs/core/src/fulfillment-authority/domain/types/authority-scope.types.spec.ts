import {
  type AuthorityScope,
  authorityScopeKey,
  AuthorityScopeKindValues,
  isAuthorityScope,
} from './authority-scope.types';

describe('AuthorityScope', () => {
  const scopes: readonly AuthorityScope[] = [
    { kind: 'global' },
    { kind: 'location', locationId: 'loc-1' },
    { kind: 'channel', connectionId: 'conn-1' },
    { kind: 'order', orderId: 'ol_order_1' },
    { kind: 'work', workId: 'work-1' },
  ];

  it('should cover every declared scope kind in the fixture set', () => {
    expect(scopes.map((scope) => scope.kind).sort()).toEqual([...AuthorityScopeKindValues].sort());
  });

  it('should produce a distinct key per scope when ids collide across kinds', () => {
    const keys = [
      authorityScopeKey({ kind: 'location', locationId: 'x' }),
      authorityScopeKey({ kind: 'order', orderId: 'x' }),
      authorityScopeKey({ kind: 'work', workId: 'x' }),
      authorityScopeKey({ kind: 'channel', connectionId: 'x' }),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it('should produce a stable key when the same scope is serialised twice', () => {
    for (const scope of scopes) {
      expect(authorityScopeKey(scope)).toBe(authorityScopeKey({ ...scope }));
    }
  });

  it('should accept every well-formed scope when the guard narrows it', () => {
    for (const scope of scopes) {
      expect(isAuthorityScope(scope)).toBe(true);
    }
  });

  it.each([
    null,
    undefined,
    'global',
    42,
    [],
    {},
    { kind: 'nonsense' },
    { kind: 'location' },
    { kind: 'location', locationId: '' },
    { kind: 'location', locationId: 7 },
    { kind: 'channel', connectionId: null },
  ])('should reject the malformed scope %p', (value) => {
    expect(isAuthorityScope(value)).toBe(false);
  });
});
