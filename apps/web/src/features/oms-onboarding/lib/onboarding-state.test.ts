import { describe, expect, it } from 'vitest';

import type { Connection } from '../../connections';
import type { AuthorityAnswerRow } from '../../fulfillment-authority';
import type { InventoryLocation } from '../../inventory';
import {
  deriveDataState,
  findConflictingMasters,
  initialPosition,
  isPackingLive,
  isPackingPaused,
  isStep1Done,
  readSourcingStanding,
  resolveDataSource,
  TOTAL_STEPS,
  TURN_ON_STEP,
  WIZARD_STEP_KEYS,
  WIZARD_STEPS,
  wizardStepFromKey,
  wizardStepKey,
  type DataStateInput,
  type OnboardingDataState,
} from './onboarding-state';

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: 'c1',
    name: 'Shop',
    platformType: 'prestashop',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const MAIN: InventoryLocation = {
  id: 'loc-main',
  code: 'MAIN',
  name: 'Main warehouse',
  kind: 'warehouse',
  ownerConnectionId: null,
  externalRef: null,
  status: 'active',
  countryIso2: null,
  postcode: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PACKING = connection({ id: 'pack', platformType: 'openlinker', enabledCapabilities: ['FulfillmentExecutor'] });
const MASTER = connection({ id: 'm1', config: { stockLocationOverride: 'loc-main' } });

function row(answer: AuthorityAnswerRow['answer']): AuthorityAnswerRow {
  return {
    question: 'sourcing',
    state: 'resolved',
    answer,
    why: { kind: 'default', code: 'a2-claimed-by-connection' },
    source: 'operator-config',
    inactiveClaimantConnectionIds: [],
  };
}

describe('deriveDataState', () => {
  const base: DataStateInput = {
    view: 'wizard',
    live: false,
    step: 1,
    masterCount: 1,
    step1Done: false,
    stockComplete: false,
    packerCount: 0,
  };

  const table: Array<[Partial<DataStateInput>, OnboardingDataState]> = [
    [{ masterCount: 0 }, 'step-1-no-product-master'],
    [{}, 'step-1-product-master'],
    [{ masterCount: 2 }, 'step-1-two-product-masters'],
    [{ step1Done: true }, 'step-1-stock-syncing'],
    [{ step1Done: true, stockComplete: true }, 'step-1-stock-complete'],
    [{ step: 2 }, 'step-2-sales-documents'],
    [{ step: 3 }, 'step-3-packers-empty'],
    [{ step: 3, packerCount: 1 }, 'step-3-packer-added'],
    [{ step: 4 }, 'step-4-shipping'],
    [{ step: 5 }, 'step-5-what-changes'],
    [{ step: 6 }, 'step-6-automations'],
    [{ step: 7 }, 'step-7-who-decides'],
    [{ step: 8 }, 'step-8-turn-on'],
    [{ view: 'waiting' }, 'waiting-first-order'],
    [{ view: 'first' }, 'first-order-arrived'],
    [{ view: 'status', live: true }, 'status-on'],
    [{ view: 'status', live: false }, 'status-off'],
  ];

  it.each(table)('should derive %o as %s', (overrides, expected) => {
    expect(deriveDataState({ ...base, ...overrides })).toBe(expected);
  });
});

describe('resolveDataSource', () => {
  it('should name none, two, the mockup platforms and anything else', () => {
    expect(resolveDataSource([])).toBe('none');
    expect(resolveDataSource([MASTER, MASTER])).toBe('two');
    expect(resolveDataSource([connection({ platformType: 'woocommerce' })])).toBe('woocommerce');
    expect(resolveDataSource([connection({ platformType: 'shopify' })])).toBe('other');
  });
});

describe('isStep1Done', () => {
  it('should be done when every Confirm write is in place', () => {
    expect(isStep1Done({ masters: [MASTER], packingConnection: PACKING, mainLocation: MAIN })).toBe(true);
  });

  it('should not be done while a master still points nowhere', () => {
    const unpointed = connection({ id: 'm2' });
    expect(isStep1Done({ masters: [MASTER, unpointed], packingConnection: PACKING, mainLocation: MAIN })).toBe(false);
  });

  it('should not be done when the packing connection cannot take work', () => {
    const noExecutor = connection({ id: 'pack', enabledCapabilities: [] });
    expect(isStep1Done({ masters: [MASTER], packingConnection: noExecutor, mainLocation: MAIN })).toBe(false);
  });

  it('should not be done when the packing connection is disabled or the warehouse inactive', () => {
    expect(
      isStep1Done({ masters: [MASTER], packingConnection: { ...PACKING, status: 'disabled' }, mainLocation: MAIN })
    ).toBe(false);
    expect(
      isStep1Done({ masters: [MASTER], packingConnection: PACKING, mainLocation: { ...MAIN, status: 'inactive' } })
    ).toBe(false);
  });

  it('should not be done with more than two masters (v1 limit)', () => {
    expect(
      isStep1Done({ masters: [MASTER, MASTER, MASTER], packingConnection: PACKING, mainLocation: MAIN })
    ).toBe(false);
  });
});

describe('findConflictingMasters', () => {
  it('should report a master pointing at another location, and not one pointing at MAIN or nowhere', () => {
    const elsewhere = connection({ id: 'x', config: { stockLocationOverride: 'loc-other' } });
    const nowhere = connection({ id: 'y' });
    expect(findConflictingMasters([MASTER, elsewhere, nowhere], MAIN)).toEqual([elsewhere]);
  });
});

describe('readSourcingStanding', () => {
  it('should read ours, other, none and unknown', () => {
    expect(readSourcingStanding(row({ kind: 'holders', parties: [{ connectionId: 'pack', scopeKind: 'global' }] }), 'pack')).toBe('ours');
    expect(readSourcingStanding(row({ kind: 'holders', parties: [{ connectionId: 'x', scopeKind: 'global' }] }), 'pack')).toBe('other');
    expect(
      readSourcingStanding(row({ kind: 'cannot-tell', reason: 'no-primary', candidateConnectionIds: ['pack', 'x'] }), 'pack')
    ).toBe('other');
    expect(readSourcingStanding(row({ kind: 'default-today' }), 'pack')).toBe('none');
    expect(readSourcingStanding(undefined, 'pack')).toBe('unknown');
  });
});

describe('isPackingLive / isPackingPaused', () => {
  it('should trust the server answer, and read the claim only when it is unknown', () => {
    const on = { ...PACKING, config: { sourcingAuthority: { enabled: true } } };
    expect(isPackingLive('ours', PACKING)).toBe(true);
    expect(isPackingLive('none', on)).toBe(false);
    expect(isPackingLive('unknown', on)).toBe(true);
  });

  it('should be paused only when a stop left the claim key off', () => {
    expect(isPackingPaused({ ...PACKING, config: { sourcingAuthority: { enabled: false } } }, false)).toBe(true);
    expect(isPackingPaused(PACKING, false)).toBe(false);
    expect(isPackingPaused(null, false)).toBe(false);
  });
});

describe('initialPosition', () => {
  it('should land on status once packing was ever turned on, else the first undone step', () => {
    expect(initialPosition(true, false, true)).toEqual({ view: 'status', step: TURN_ON_STEP });
    expect(initialPosition(false, true, true)).toEqual({ view: 'status', step: TURN_ON_STEP });
    expect(initialPosition(false, false, true)).toEqual({ view: 'wizard', step: 2 });
    expect(initialPosition(false, false, false)).toEqual({ view: 'wizard', step: 1 });
  });
});

describe('wizard step numbers', () => {
  it('should put Shipping at step 4 of 8, after the packers and before what changes', () => {
    expect(TOTAL_STEPS).toBe(8);
    expect(WIZARD_STEPS.packers).toBe(3);
    expect(WIZARD_STEPS.shipping).toBe(4);
    expect(WIZARD_STEPS.whatChanges).toBe(5);
    expect(TURN_ON_STEP).toBe(8);
  });

  it('should number the steps 1 to 8 with no gap or repeat', () => {
    expect(WIZARD_STEP_KEYS.map((key) => WIZARD_STEPS[key])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('wizardStepFromKey / wizardStepKey', () => {
  it('should round-trip every step through its URL value', () => {
    for (const key of WIZARD_STEP_KEYS) {
      expect(wizardStepKey(wizardStepFromKey(key) ?? 0)).toBe(key);
    }
  });

  it('should read an absent or unknown value as no step', () => {
    expect(wizardStepFromKey(null)).toBeNull();
    expect(wizardStepFromKey('')).toBeNull();
    expect(wizardStepFromKey('/connections')).toBeNull();
    expect(wizardStepFromKey('constructor')).toBeNull();
  });
});

describe('initialPosition with a step in the URL', () => {
  it('should reopen the requested step once step 1 is done', () => {
    expect(initialPosition(false, false, true, WIZARD_STEPS.shipping)).toEqual({
      view: 'wizard',
      step: WIZARD_STEPS.shipping,
    });
    expect(initialPosition(true, false, true, WIZARD_STEPS.shipping)).toEqual({
      view: 'wizard',
      step: WIZARD_STEPS.shipping,
    });
  });

  it('should not skip past step 1 while it is not done', () => {
    expect(initialPosition(false, false, false, WIZARD_STEPS.shipping)).toEqual({ view: 'wizard', step: 1 });
  });

  it('should not reopen Turn it on for packing that is on or paused', () => {
    expect(initialPosition(true, false, true, TURN_ON_STEP)).toEqual({ view: 'status', step: TURN_ON_STEP });
    expect(initialPosition(false, true, true, TURN_ON_STEP)).toEqual({ view: 'status', step: TURN_ON_STEP });
  });
});
