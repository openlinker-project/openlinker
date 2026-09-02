import {
  AUTHORITY_KIND_DESCRIPTORS,
  AuthorityKindValues,
  isAuthorityKind,
} from './authority-kind.types';

describe('AuthorityKind', () => {
  it('should enumerate exactly six authorities when read as the ADR-052 matrix rows A1-A6', () => {
    // Six, not seven: A7 (invoicing/fiscalization) is resolved by ADR-041 in
    // `sales-documents` and carries no member here. See the barrel docblock.
    expect(AuthorityKindValues).toHaveLength(6);
    expect([...AuthorityKindValues]).toEqual([
      'availability',
      'sourcing',
      'fulfillment-execution',
      'order-lifecycle',
      'returns-disposition',
      'refund-trigger',
    ]);
  });

  it('should carry no invoicing or fiscalization member when scanned for A7', () => {
    for (const kind of AuthorityKindValues) {
      expect(kind).not.toMatch(/invoic|fiscal/i);
    }
  });

  it('should describe every kind when the descriptor record is indexed', () => {
    expect(Object.keys(AUTHORITY_KIND_DESCRIPTORS).sort()).toEqual([...AuthorityKindValues].sort());

    for (const kind of AuthorityKindValues) {
      const descriptor = AUTHORITY_KIND_DESCRIPTORS[kind];
      expect(descriptor.capability.length).toBeGreaterThan(0);
      expect(descriptor.configKey.length).toBeGreaterThan(0);
      expect(descriptor.owningContext.length).toBeGreaterThan(0);
    }
  });

  it('should give each authority a distinct config key when the keys are collected', () => {
    const keys = AuthorityKindValues.map((kind) => AUTHORITY_KIND_DESCRIPTORS[kind].configKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should mark the never-assignable refund trigger config-only when A6 is read', () => {
    expect(AUTHORITY_KIND_DESCRIPTORS['refund-trigger']).toEqual({
      capability: 'config-only',
      configKey: 'refundTrigger',
      owningContext: 'orders',
    });
  });

  it('should reject an unknown string when the guard narrows it', () => {
    expect(isAuthorityKind('availability')).toBe(true);
    expect(isAuthorityKind('invoicing')).toBe(false);
    expect(isAuthorityKind('')).toBe(false);
    expect(isAuthorityKind(undefined)).toBe(false);
    expect(isAuthorityKind(1)).toBe(false);
  });
});
