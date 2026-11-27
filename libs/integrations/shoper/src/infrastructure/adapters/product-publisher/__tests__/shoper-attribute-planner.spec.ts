import type { OfferParameter } from '@openlinker/core/listings';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperAttribute, ShoperAttributeGroup } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import { ShoperAttributePlanner } from '../shoper-attribute-planner';

const COLOUR: ShoperAttribute = {
  attribute_id: '28',
  attribute_group_id: '8',
  name: 'Kolor',
  type: '2',
  options: [
    { option_id: '112', value: 'Czerwony' },
    { option_id: '113', value: 'Serenity' },
  ],
};
const SIZE: ShoperAttribute = {
  attribute_id: '29',
  attribute_group_id: '8',
  name: 'Rozmiar',
  type: '2',
  options: [{ option_id: '120', value: 'M' }],
};
const MATERIAL_UNBOUND: ShoperAttribute = {
  attribute_id: '33',
  attribute_group_id: '9',
  name: 'Materiał',
  type: '2',
  options: [{ option_id: '130', value: 'Bawełna' }],
};
const GROUPS: ShoperAttributeGroup[] = [
  { attribute_group_id: '8', name: 'Wygląd', categories: [45, 38] },
  { attribute_group_id: '9', name: 'Skład', categories: [12] },
];
const DETAILS: Record<string, ShoperAttribute> = { '28': COLOUR, '29': SIZE, '33': MATERIAL_UNBOUND };

function envelope<T>(list: T[]): { status: number; data: { list: T[]; count: string; pages: number; page: number } } {
  return { status: 200, data: { list, count: String(list.length), pages: 1, page: 1 } };
}

function setup(): { planner: ShoperAttributePlanner; get: jest.Mock } {
  const get = jest.fn((path: string) => {
    if (path === '/attributes') {
      return Promise.resolve(envelope([COLOUR, SIZE, MATERIAL_UNBOUND]));
    }
    if (path === '/attribute-groups') {
      return Promise.resolve(envelope(GROUPS));
    }
    const id = /^\/attributes\/(\d+)$/.exec(path)?.[1];
    const detail = id === undefined ? undefined : DETAILS[id];
    if (detail !== undefined) {
      return Promise.resolve({ status: 200, data: detail });
    }
    return Promise.reject(new ShoperApiError(404, 'invalid_request', 'Resource not found'));
  });
  return { planner: new ShoperAttributePlanner({ get } as unknown as ShoperHttpClient), get };
}

function param(overrides: Partial<OfferParameter>): OfferParameter {
  return { id: '28', section: 'product', ...overrides };
}

function callsTo(get: jest.Mock, path: string): number {
  return (get.mock.calls as [string][]).filter(([p]) => p === path).length;
}

describe('ShoperAttributePlanner', () => {
  it('should build the FLAT attribute-id to option-text map Shoper writes, never the grouped read shape', async () => {
    const { planner } = setup();

    const plan = await planner.plan(
      [param({ id: '28', valuesIds: ['113'], values: ['Serenity'] }), param({ id: '29', valuesIds: ['120'] })],
      38,
    );

    expect(plan).toEqual({ attributes: { '28': 'Serenity', '29': 'M' }, warnings: [] });
  });

  it('should match a free-text parameter to an attribute by its name', async () => {
    const { planner } = setup();

    const plan = await planner.plan([param({ id: ' kolor ', values: ['czerwony'] })], 38);

    expect(plan).toEqual({ attributes: { '28': 'Czerwony' }, warnings: [] });
  });

  it('should warn, not fail, when no attribute carries the name', async () => {
    const { planner } = setup();

    const plan = await planner.plan([param({ id: 'Wzór', values: ['kropki'] })], 38);

    expect(plan.attributes).toEqual({});
    expect(plan.warnings).toEqual([expect.stringContaining('No Shoper attribute is named "Wzór"')]);
  });

  it('should not send an attribute whose group is not bound to the category, since Shoper would drop it silently', async () => {
    const { planner } = setup();

    const plan = await planner.plan([param({ id: '33', valuesIds: ['130'] })], 38);

    expect(plan.attributes).toEqual({});
    expect(plan.warnings).toEqual([
      expect.stringMatching(/"Materiał" \(attribute 33\).*group 9 is not bound to category 38/),
    ]);
  });

  it('should leave out an option the attribute does not have and still send the rest', async () => {
    const { planner } = setup();

    const plan = await planner.plan(
      [param({ id: '28', values: ['Fioletowy'] }), param({ id: '29', valuesIds: ['120'] })],
      38,
    );

    expect(plan.attributes).toEqual({ '29': 'M' });
    expect(plan.warnings).toEqual([expect.stringContaining('"Fioletowy" is not one of its options')]);
  });

  it('should warn about an attribute id the shop does not have', async () => {
    const { planner } = setup();

    const plan = await planner.plan([param({ id: '404', values: ['x'] })], 38);

    expect(plan).toEqual({
      attributes: {},
      warnings: [expect.stringContaining('Attribute 404 does not exist')],
    });
  });

  it('should send nothing, and say why, when the category is not known', async () => {
    const { planner, get } = setup();

    const plan = await planner.plan([param({ valuesIds: ['113'] })], null);

    expect(plan.attributes).toEqual({});
    expect(plan.warnings).toEqual([expect.stringContaining('category is not known')]);
    expect(get).not.toHaveBeenCalled();
  });

  it('should read each attribute, the attribute list and the groups once per instance', async () => {
    const { planner, get } = setup();

    await planner.plan([param({ id: '28', valuesIds: ['113'] }), param({ id: 'Kolor', values: ['Czerwony'] })], 38);
    await planner.plan([param({ id: '28', valuesIds: ['112'] })], 38);

    expect(callsTo(get, '/attributes/28')).toBe(1);
    expect(callsTo(get, '/attribute-groups')).toBe(1);
    expect(callsTo(get, '/attributes')).toBe(1);
  });

  it('should send an attribute once when two parameters set it, and say so', async () => {
    const { planner } = setup();

    const plan = await planner.plan([param({ valuesIds: ['113'] }), param({ id: 'Kolor', values: ['Czerwony'] })], 38);

    expect(plan.attributes).toEqual({ '28': 'Serenity' });
    expect(plan.warnings).toEqual([expect.stringContaining('more than one parameter')]);
  });

  it('should retry a read that failed instead of replaying the failure', async () => {
    const { planner, get } = setup();
    get.mockImplementationOnce(() => Promise.reject(new ShoperApiError(503)));

    await expect(planner.plan([param({ valuesIds: ['113'] })], 38)).rejects.toBeInstanceOf(ShoperApiError);
    const plan = await planner.plan([param({ valuesIds: ['113'] })], 38);

    expect(plan.attributes).toEqual({ '28': 'Serenity' });
  });
});
