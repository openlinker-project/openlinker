/**
 * FulfillmentRoutingRepository unit tests - parcel profile mapping (#3651).
 *
 * @module libs/core/src/mappings/infrastructure/persistence/repositories/__tests__
 */
import type { DataSource, Repository } from 'typeorm';
import { FulfillmentRoutingRepository } from '../fulfillment-routing.repository';
import type { FulfillmentRoutingRuleOrmEntity } from '../../entities/fulfillment-routing-rule.orm-entity';

function ormRow(partial: Partial<FulfillmentRoutingRuleOrmEntity> = {}): FulfillmentRoutingRuleOrmEntity {
  return {
    id: 'rule-1',
    sourceConnectionId: 'src',
    sourceDeliveryMethodId: 'method-1',
    processorKind: 'source_brokered',
    processorConnectionId: 'proc',
    parcelTemplate: null,
    parcelLengthMm: null,
    parcelWidthMm: null,
    parcelHeightMm: null,
    parcelDefaultWeightGrams: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as FulfillmentRoutingRuleOrmEntity;
}

describe('FulfillmentRoutingRepository parcel profile', () => {
  let repo: jest.Mocked<Pick<Repository<FulfillmentRoutingRuleOrmEntity>, 'find' | 'findOne'>>;
  let saved: FulfillmentRoutingRuleOrmEntity[];
  let sut: FulfillmentRoutingRepository;

  beforeEach(() => {
    repo = { find: jest.fn(), findOne: jest.fn() };
    saved = [];
    const manager = {
      delete: jest.fn(),
      save: jest.fn((_e: unknown, entities: FulfillmentRoutingRuleOrmEntity[]) => {
        saved = entities.map((e) => ({ ...e, id: 'new', createdAt: new Date(), updatedAt: new Date() }));
        return Promise.resolve(saved);
      }),
    };
    const dataSource = {
      transaction: (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
    } as unknown as DataSource;
    sut = new FulfillmentRoutingRepository(
      repo as unknown as Repository<FulfillmentRoutingRuleOrmEntity>,
      dataSource,
    );
  });

  it('should map a row without profile columns to a null profile', async () => {
    repo.findOne.mockResolvedValue(ormRow());

    const rule = await sut.findRule('src', 'method-1');

    expect(rule?.parcelProfile).toBeNull();
  });

  it('should map profile columns to a parcel profile', async () => {
    repo.findOne.mockResolvedValue(
      ormRow({ parcelTemplate: 'large', parcelLengthMm: 300, parcelWidthMm: 200, parcelHeightMm: 100, parcelDefaultWeightGrams: 250 }),
    );

    const rule = await sut.findRule('src', 'method-1');

    expect(rule?.parcelProfile).toEqual({
      parcelTemplate: 'large',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      defaultWeightGrams: 250,
    });
  });

  it('should persist an absent or all-null profile as all-null columns', async () => {
    await sut.replaceForConnection('src', [
      { sourceDeliveryMethodId: 'a', processorKind: 'source_brokered', processorConnectionId: 'p' },
      { sourceDeliveryMethodId: 'b', processorKind: 'source_brokered', processorConnectionId: 'p', parcelProfile: {} },
    ]);

    for (const row of saved) {
      expect(row.parcelTemplate).toBeNull();
      expect(row.parcelLengthMm).toBeNull();
      expect(row.parcelDefaultWeightGrams).toBeNull();
    }
  });

  it('should persist the profile columns of a rule that carries one', async () => {
    const [rule] = await sut.replaceForConnection('src', [
      {
        sourceDeliveryMethodId: 'a',
        processorKind: 'source_brokered',
        processorConnectionId: 'p',
        parcelProfile: { lengthMm: 300, widthMm: 200, heightMm: 100, defaultWeightGrams: 250 },
      },
    ]);

    expect(saved[0].parcelLengthMm).toBe(300);
    expect(rule.parcelProfile?.defaultWeightGrams).toBe(250);
  });
});
