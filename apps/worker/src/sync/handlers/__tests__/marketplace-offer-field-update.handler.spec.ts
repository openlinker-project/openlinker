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

describe('MarketplaceOfferFieldUpdateHandler', () => {
  let updateOfferFields: jest.Mock;
  let identifierMapping: { getExternalIds: jest.Mock };
  let integrationsService: { getCapabilityAdapter: jest.Mock };
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
    handler = new MarketplaceOfferFieldUpdateHandler(
      identifierMapping as never,
      integrationsService as never,
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
});
