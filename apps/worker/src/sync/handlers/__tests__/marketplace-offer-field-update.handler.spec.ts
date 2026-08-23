/**
 * Marketplace Offer Field Update Handler - unit tests
 *
 * This handler is the FOURTH path that hands a description to a destination
 * (ADR-046) - the edit-offer drawer's `marketplace.offer.updateFields` job. It
 * calls the adapter directly, without passing through either builder, so it has
 * to apply the destination's declared format itself.
 *
 * That is the whole reason this spec exists: the handler had no coverage, the
 * adapter no longer sanitises, and a silent regression here would ship
 * unfiltered HTML to a marketplace with nothing failing.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOfferFieldUpdateHandler } from '../marketplace-offer-field-update.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';

const OFFER_ID = 'ol_offer_1';
const CONN_ID = 'conn-allegro';

/** Allegro-shaped: seven tags, no attributes, strong -> b, br -> paragraph. */
const ALLEGRO_LIKE = {
  shape: 'html' as const,
  allowedTags: ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'],
  allowedAttributes: {},
  contentModel: {
    root: ['h1', 'h2', 'p', 'ul', 'ol'],
    p: ['b'],
    ul: ['li'],
    ol: ['li'],
    li: ['b', 'p'],
    h1: [],
    h2: [],
  },
  rewrites: [
    { from: 'strong', action: 'rename' as const, to: 'b' },
    { from: 'br', action: 'split-block' as const },
  ],
  requiresBlockOpener: true,
  maxBytes: 40000,
};

interface SentCommand {
  externalOfferId: string;
  fields: Record<string, unknown>;
}

function makeJob(fields: Record<string, unknown>): SyncJob {
  return {
    id: 'job-1',
    jobType: 'marketplace.offer.updateFields',
    connectionId: CONN_ID,
    payload: { version: 1, offerId: OFFER_ID, fields },
  } as unknown as SyncJob;
}

const PRODUCT_ID = 'ol_product_1';

describe('MarketplaceOfferFieldUpdateHandler', () => {
  let updateOfferFields: jest.Mock;
  let identifierMapping: { getExternalIds: jest.Mock };
  let integrationsService: { getCapabilityAdapter: jest.Mock };
  let productsService: { getVariant: jest.Mock };
  let taxRateJournal: { record: jest.Mock; getLatestPerConnection: jest.Mock };
  let handler: MarketplaceOfferFieldUpdateHandler;

  /**
   * `jest.Mock.calls` is `any[]`, so read the command through a cast on the
   * whole tuple rather than indexing into `any` - the pattern the Allegro
   * adapter spec already uses.
   */
  function firstCommand(): SentCommand {
    return (updateOfferFields.mock.calls[0] as [SentCommand])[0];
  }

  function wireAdapter(extra: Record<string, unknown> = {}): void {
    integrationsService.getCapabilityAdapter.mockResolvedValue({
      updateOfferQuantity: jest.fn(),
      updateOfferFields,
      ...extra,
    });
  }

  beforeEach(() => {
    updateOfferFields = jest.fn().mockResolvedValue(undefined);
    identifierMapping = {
      getExternalIds: jest
        .fn()
        .mockResolvedValue([{ connectionId: CONN_ID, externalId: 'allegro-offer-9' }]),
    };
    integrationsService = { getCapabilityAdapter: jest.fn() };
    productsService = {
      getVariant: jest
        .fn()
        .mockResolvedValue({ id: OFFER_ID, productId: PRODUCT_ID, sku: 'SKU-1', attributes: {} }),
    };
    taxRateJournal = {
      record: jest.fn().mockResolvedValue(null),
      getLatestPerConnection: jest.fn().mockResolvedValue([]),
    };
    handler = new MarketplaceOfferFieldUpdateHandler(
      identifierMapping as never,
      integrationsService as never,
      productsService as never,
      taxRateJournal as never,
    );
  });

  it('should shape the description with the format the destination declares', async () => {
    wireAdapter({ getDescriptionFormat: () => ALLEGRO_LIKE });

    await handler.execute(
      makeJob({
        description: {
          sections: [
            {
              items: [
                {
                  type: 'TEXT',
                  content: '<p style="color:#c00">a<br><strong>b</strong></p>',
                },
              ],
            },
          ],
        },
      }),
    );

    expect(updateOfferFields).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOfferId: 'allegro-offer-9',
        fields: {
          description: {
            sections: [{ items: [{ type: 'TEXT', content: '<p>a</p><p><b>b</b></p>' }] }],
          },
        },
      }),
    );
  });

  it('should pass non-description fields through untouched', async () => {
    wireAdapter({ getDescriptionFormat: () => ALLEGRO_LIKE });

    await handler.execute(makeJob({ title: '<b>Title</b>', price: { amount: '9.99', currency: 'PLN' } }));

    const cmd = firstCommand();
    expect(cmd.fields).toEqual({
      title: '<b>Title</b>',
      price: { amount: '9.99', currency: 'PLN' },
    });
  });

  it('should omit the description when nothing survives the format', async () => {
    wireAdapter({ getDescriptionFormat: () => ALLEGRO_LIKE });

    await handler.execute(
      makeJob({
        title: 'kept',
        description: { sections: [{ items: [{ type: 'TEXT', content: '<div>  </div>' }] }] },
      }),
    );

    const cmd = firstCommand();
    expect(cmd.fields).not.toHaveProperty('description');
    expect(cmd.fields.title).toBe('kept');
  });

  it('should fall back to the conservative format when the adapter declares none', async () => {
    // An out-of-tree plugin predating `getDescriptionFormat` must degrade, not
    // take the job down.
    wireAdapter();

    await handler.execute(
      makeJob({
        description: { sections: [{ items: [{ type: 'TEXT', content: 'plain' }] }] },
      }),
    );

    const description = firstCommand().fields.description as {
      sections: { items: { content: string }[] }[];
    };
    expect(description.sections[0].items[0].content).toBe('<p>plain</p>');
  });

  it('should throw when no external mapping exists for the connection', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([]);
    wireAdapter({ getDescriptionFormat: () => ALLEGRO_LIKE });

    await expect(handler.execute(makeJob({ title: 'x' }))).rejects.toThrow(SyncJobExecutionError);
    expect(updateOfferFields).not.toHaveBeenCalled();
  });

  it('should throw when the adapter does not support field updates', async () => {
    integrationsService.getCapabilityAdapter.mockResolvedValue({ updateOfferQuantity: jest.fn() });

    await expect(handler.execute(makeJob({ title: 'x' }))).rejects.toThrow(SyncJobExecutionError);
  });

  describe('tax-rate journal (#2250, ADR-052 § 4)', () => {
    beforeEach(() => {
      wireAdapter({ getDescriptionFormat: () => ALLEGRO_LIKE });
    });

    it('should record a written-by-us entry when the update carried a rate', async () => {
      const result = await handler.execute(makeJob({ taxRate: '23' }));

      expect(result).toEqual({ outcome: 'ok' });
      expect(updateOfferFields).toHaveBeenCalledTimes(1);
      expect(productsService.getVariant).toHaveBeenCalledWith(OFFER_ID);
      expect(taxRateJournal.record).toHaveBeenCalledWith({
        productId: PRODUCT_ID,
        variantId: OFFER_ID,
        connectionId: CONN_ID,
        origin: 'written-by-us',
        taxRate: '23',
      });
    });

    it('should record nothing when the update touched no rate', async () => {
      await handler.execute(makeJob({ title: 'x' }));

      expect(updateOfferFields).toHaveBeenCalledTimes(1);
      expect(taxRateJournal.record).not.toHaveBeenCalled();
      expect(productsService.getVariant).not.toHaveBeenCalled();
    });

    it('should record nothing when the marketplace write failed', async () => {
      // The entry claims a write HAPPENED, so a failed write must leave none.
      updateOfferFields.mockRejectedValue(new Error('422 rate not allowed in category'));

      await expect(handler.execute(makeJob({ taxRate: '5' }))).rejects.toThrow(
        SyncJobExecutionError,
      );
      expect(taxRateJournal.record).not.toHaveBeenCalled();
    });

    it('should never fail the job when the journal write throws', async () => {
      taxRateJournal.record.mockRejectedValue(new Error('journal down'));

      await expect(handler.execute(makeJob({ taxRate: '23' }))).resolves.toEqual({
        outcome: 'ok',
      });
    });

    it('should skip the entry when the variant cannot be read', async () => {
      productsService.getVariant.mockResolvedValue(null);

      await expect(handler.execute(makeJob({ taxRate: '23' }))).resolves.toEqual({
        outcome: 'ok',
      });
      expect(taxRateJournal.record).not.toHaveBeenCalled();
    });
  });
});
