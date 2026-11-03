/**
 * Dead Failed-Creation Offer Integration Test (E2E-25)
 *
 * Allegro accepts an inline-product create with `202`, mints the offer, and
 * then refuses the product asynchronously (`GtinNotExistsInGtinParameter`).
 * The offer stays `inactive` for good and can be neither ended nor deleted,
 * while its Offer mapping survives. Before E2E-25 the duplicate guard counted
 * that mapping, so the variant could never be listed again.
 *
 * The rule lives in one hand-written SQL predicate shared by
 * `OfferMappingRepository.countByConnectionAndVariants` (read by the bulk
 * submit guard AND the FE "already on {destination}" chip) and
 * `findDeadFailedCreationOfferIds` (read when a replacement offer retires the
 * dead mapping). The services' unit specs mock the repository, so only a real
 * Postgres shows the predicate is right - in particular that a mapping with NO
 * snapshot row still counts (the predicate is negated over a LEFT join, where
 * a NULL would silently drop it).
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  type OfferMappingRepositoryPort,
} from '@openlinker/core/listings';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const CONNECTION = '33333333-3333-4333-8333-333333333333';
const OTHER_CONNECTION = '44444444-4444-4444-8444-444444444444';

type PublicationStatus = 'active' | 'activating' | 'inactivating' | 'inactive' | 'ended';
type RecordStatus = 'pending' | 'draft' | 'validating' | 'active' | 'reused' | 'failed';

interface CreationRecordSeed {
  status: RecordStatus;
  errors?: Array<{ code: string; message: string }> | null;
  createdAt: string;
}

const GTIN_REFUSAL = [
  {
    code: 'GtinNotExistsInGtinParameter',
    message: 'The GTIN given in the parameter does not exist in the GS1 database.',
  },
];

async function seedOffer(
  dataSource: DataSource,
  options: {
    variantId: string;
    externalOfferId: string;
    connectionId?: string;
    publicationStatus?: PublicationStatus;
    records?: CreationRecordSeed[];
  }
): Promise<void> {
  const connectionId = options.connectionId ?? CONNECTION;

  await dataSource.query(
    `INSERT INTO identifier_mappings
       ("entityType", "internalId", "externalId", "platformType", "connectionId")
     VALUES ('Offer', $1, $2, 'allegro', $3)`,
    [options.variantId, options.externalOfferId, connectionId]
  );

  if (options.publicationStatus !== undefined) {
    await dataSource.query(
      `INSERT INTO offer_status_snapshots
         ("connectionId", "externalOfferId", "internalVariantId", "publicationStatus",
          "statusDetails", "lastStatusSyncedAt")
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [
        connectionId,
        options.externalOfferId,
        options.variantId,
        options.publicationStatus,
        '2026-10-26T10:00:00.000Z',
      ]
    );
  }

  for (const record of options.records ?? []) {
    await dataSource.query(
      `INSERT INTO offer_creation_records
         ("internalVariantId", "connectionId", "externalOfferId", "status", "errors",
          "publishImmediately", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, false, $6, $6)`,
      [
        options.variantId,
        connectionId,
        options.externalOfferId,
        record.status,
        record.errors === undefined || record.errors === null
          ? null
          : JSON.stringify(record.errors),
        record.createdAt,
      ]
    );
  }
}

describe('Dead failed-creation offers (E2E-25)', () => {
  let harness: IntegrationTestHarness;
  let repository: OfferMappingRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OfferMappingRepositoryPort>(OFFER_MAPPING_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await harness
      .getDataSource()
      .query(`DELETE FROM offer_creation_records WHERE "connectionId" IN ($1, $2)`, [
        CONNECTION,
        OTHER_CONNECTION,
      ]);
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should not count an inactive offer whose creation the marketplace refused', async () => {
    await seedOffer(harness.getDataSource(), {
      variantId: 'ol_variant_dead',
      externalOfferId: 'offer-dead',
      publicationStatus: 'inactive',
      records: [{ status: 'failed', errors: GTIN_REFUSAL, createdAt: '2026-10-26T09:00:00Z' }],
    });

    const counts = await repository.countByConnectionAndVariants(CONNECTION, ['ol_variant_dead']);
    const deadIds = await repository.findDeadFailedCreationOfferIds(CONNECTION, 'ol_variant_dead');

    expect(counts.has('ol_variant_dead')).toBe(false);
    expect(deadIds).toEqual(['offer-dead']);
  });

  it('should keep counting every offer that is or could become live', async () => {
    const dataSource = harness.getDataSource();
    // Inactive, but the creation ended as a clean draft the operator may activate.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_draft',
      externalOfferId: 'offer-draft',
      publicationStatus: 'inactive',
      records: [{ status: 'draft', createdAt: '2026-10-26T09:00:00Z' }],
    });
    // OpenLinker stopped watching; the marketplace may still activate it.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_timeout',
      externalOfferId: 'offer-timeout',
      publicationStatus: 'inactive',
      records: [
        {
          status: 'failed',
          errors: [{ code: 'POLL_TIMEOUT', message: 'POLL_TIMEOUT after 10 attempts' }],
          createdAt: '2026-10-26T09:00:00Z',
        },
      ],
    });
    // The job died mid-create; the outcome is unknown.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_job_dead',
      externalOfferId: 'offer-job-dead',
      publicationStatus: 'inactive',
      records: [
        {
          status: 'failed',
          errors: [{ code: 'OFFER_CREATION_JOB_DEAD', message: 'Offer creation job died' }],
          createdAt: '2026-10-26T09:00:00Z',
        },
      ],
    });
    // The product details were removed with no reason on record; the seller
    // may still activate the offer.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_product_removed',
      externalOfferId: 'offer-product-removed',
      publicationStatus: 'inactive',
      records: [
        {
          status: 'failed',
          errors: [{ code: 'PRODUCT_REMOVED', message: 'Allegro removed the product details' }],
          createdAt: '2026-10-26T09:00:00Z',
        },
      ],
    });
    // A failed record with no reason recorded proves nothing.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_no_reason',
      externalOfferId: 'offer-no-reason',
      publicationStatus: 'inactive',
      records: [{ status: 'failed', errors: null, createdAt: '2026-10-26T09:00:00Z' }],
    });
    // Refused at creation, then activated late: it is live now.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_late_active',
      externalOfferId: 'offer-late-active',
      publicationStatus: 'active',
      records: [{ status: 'failed', errors: GTIN_REFUSAL, createdAt: '2026-10-26T09:00:00Z' }],
    });
    // Moving towards live.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_activating',
      externalOfferId: 'offer-activating',
      publicationStatus: 'activating',
      records: [{ status: 'failed', errors: GTIN_REFUSAL, createdAt: '2026-10-26T09:00:00Z' }],
    });
    // No status read at all: absence is not evidence (LEFT join NULL path).
    await seedOffer(dataSource, {
      variantId: 'ol_variant_no_snapshot',
      externalOfferId: 'offer-no-snapshot',
      records: [{ status: 'failed', errors: GTIN_REFUSAL, createdAt: '2026-10-26T09:00:00Z' }],
    });
    // A mapping with neither a snapshot nor a creation record (e.g. offer sync).
    await seedOffer(dataSource, {
      variantId: 'ol_variant_synced',
      externalOfferId: 'offer-synced',
    });
    // Failed once, but the LATEST record for the same offer is a draft.
    await seedOffer(dataSource, {
      variantId: 'ol_variant_superseded',
      externalOfferId: 'offer-superseded',
      publicationStatus: 'inactive',
      records: [
        { status: 'failed', errors: GTIN_REFUSAL, createdAt: '2026-10-26T08:00:00Z' },
        { status: 'draft', createdAt: '2026-10-26T09:00:00Z' },
      ],
    });

    const variantIds = [
      'ol_variant_draft',
      'ol_variant_timeout',
      'ol_variant_job_dead',
      'ol_variant_product_removed',
      'ol_variant_no_reason',
      'ol_variant_late_active',
      'ol_variant_activating',
      'ol_variant_no_snapshot',
      'ol_variant_synced',
      'ol_variant_superseded',
    ];
    const counts = await repository.countByConnectionAndVariants(CONNECTION, variantIds);

    for (const variantId of variantIds) {
      expect({ variantId, count: counts.get(variantId) }).toEqual({ variantId, count: 1 });
      expect(await repository.findDeadFailedCreationOfferIds(CONNECTION, variantId)).toEqual([]);
    }
  });

  it('should count only the replacement offer once a dead offer was re-listed', async () => {
    const dataSource = harness.getDataSource();
    await seedOffer(dataSource, {
      variantId: 'ol_variant_relisted',
      externalOfferId: 'offer-relisted-dead',
      publicationStatus: 'inactive',
      records: [{ status: 'failed', errors: GTIN_REFUSAL, createdAt: '2026-10-26T08:00:00Z' }],
    });
    await seedOffer(dataSource, {
      variantId: 'ol_variant_relisted',
      externalOfferId: 'offer-relisted-new',
      publicationStatus: 'active',
      records: [{ status: 'active', createdAt: '2026-10-26T09:00:00Z' }],
    });

    const counts = await repository.countByConnectionAndVariants(CONNECTION, [
      'ol_variant_relisted',
    ]);
    const deadIds = await repository.findDeadFailedCreationOfferIds(
      CONNECTION,
      'ol_variant_relisted'
    );

    expect(counts.get('ol_variant_relisted')).toBe(1);
    expect(deadIds).toEqual(['offer-relisted-dead']);
  });

  it('should not read a creation record from another connection', async () => {
    // Same offer id on two connections: only the record on THIS connection
    // decides, so the other connection's refusal does not free this mapping.
    await seedOffer(harness.getDataSource(), {
      variantId: 'ol_variant_cross',
      externalOfferId: 'offer-cross',
      publicationStatus: 'inactive',
      records: [{ status: 'draft', createdAt: '2026-10-26T09:00:00Z' }],
    });
    await harness.getDataSource().query(
      `INSERT INTO offer_creation_records
         ("internalVariantId", "connectionId", "externalOfferId", "status", "errors",
          "publishImmediately", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'failed', $4, false, $5, $5)`,
      [
        'ol_variant_cross',
        OTHER_CONNECTION,
        'offer-cross',
        JSON.stringify(GTIN_REFUSAL),
        '2026-10-26T10:00:00Z',
      ]
    );

    const counts = await repository.countByConnectionAndVariants(CONNECTION, ['ol_variant_cross']);

    expect(counts.get('ol_variant_cross')).toBe(1);
  });
});
