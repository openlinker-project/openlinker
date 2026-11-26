/**
 * Mirakl Card Creation Pass: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklOfferWrite } from '../../../domain/entities/mirakl-offer-write.entity';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklCardRequest } from '../../../domain/types/mirakl-card.types';
import type { MiraklImportStatus } from '../../../domain/types/mirakl-import.types';
import type { MiraklOfferWriteStatus } from '../../../domain/types/mirakl-offer-write.types';
import { empikOperatorProfile } from '../../../operators/empik.profile';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { IMiraklImportTracker } from '../../imports/mirakl-import-tracker.interface';
import { CARD_IMPORT_INTERVAL_MS, MiraklCardCreationPass } from '../mirakl-card-creation-pass';
import type { MiraklCatalog } from '../mirakl-catalog';

const NOW = new Date('2026-11-26T12:00:00.000Z');

function request(sku: string, ean: string): MiraklCardRequest {
  return {
    ean,
    card: { CATALOG_CODE: sku, STR_GOLD: 'CAT', EAN: ean },
    offer: {
      shop_sku: sku,
      product_id: ean,
      product_id_type: 'EAN',
      price: '10.00',
      quantity: 3,
      state_code: '11',
      update_delete: 'update',
      offer_additional_fields: [],
    },
  };
}

function card(
  sku: string,
  ean: string,
  status: MiraklOfferWriteStatus,
  importId: string | null = null
): MiraklOfferWrite {
  return new MiraklOfferWrite(
    `id-${sku}`,
    'conn-1',
    'card',
    sku,
    JSON.stringify(request(sku, ean)),
    null,
    status,
    importId,
    1,
    null,
    NOW,
    NOW
  );
}

function status(overrides: Partial<MiraklImportStatus> = {}): MiraklImportStatus {
  return {
    kind: 'products',
    importId: '30532',
    state: 'awaiting-operator',
    rawStatus: 'SENT',
    hasErrorReport: false,
    ...overrides,
  };
}

interface Harness {
  pass: MiraklCardCreationPass;
  writes: jest.Mocked<MiraklOfferWriteRepositoryPort>;
  tracker: jest.Mocked<IMiraklImportTracker>;
  post: jest.Mock;
  postFile: jest.Mock;
  readCards: jest.Mock;
  deleteMapping: jest.Mock;
}

function setup(options: {
  queued?: MiraklOfferWrite[];
  sent?: MiraklOfferWrite[];
  lastImportAt?: Date | null;
  cards?: string[];
}): Harness {
  const writes = {
    findPending: jest.fn().mockResolvedValue(options.queued ?? []),
    findSubmitted: jest.fn().mockResolvedValue(options.sent ?? []),
    latestImportAt: jest.fn().mockResolvedValue(options.lastImportAt ?? null),
    markSubmitted: jest.fn((rows: readonly MiraklOfferWrite[]) => Promise.resolve(rows.length)),
    failPending: jest.fn().mockResolvedValue(0),
    settleWrites: jest.fn((rows: readonly MiraklOfferWrite[]) => Promise.resolve(rows.length)),
    recordSubmitted: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MiraklOfferWriteRepositoryPort>;
  const tracker = {
    getStatus: jest.fn().mockResolvedValue(status()),
    getErrorReport: jest.fn(),
    getProductErrorReports: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<IMiraklImportTracker>;
  const post = jest.fn().mockResolvedValue({ status: 201, data: { import_id: 999 } });
  const postFile = jest.fn().mockResolvedValue({ status: 201, data: { import_id: 30533 } });
  const readCards = jest.fn((eans: string[]) =>
    Promise.resolve(
      new Map(
        eans.map((ean) => [ean, (options.cards ?? []).includes(ean) ? [{ product_sku: 'P' }] : []])
      )
    )
  );
  const deleteMapping = jest.fn().mockResolvedValue(undefined);
  const pass = new MiraklCardCreationPass({
    connectionId: 'conn-1',
    brand: 'Empik',
    httpClient: { post, postFile } as unknown as IMiraklHttpClient,
    importTracker: tracker,
    catalog: { readCards } as unknown as MiraklCatalog,
    writes,
    codes: empikOperatorProfile.cardAttributes,
    identifierMapping: { deleteMapping },
    now: () => NOW,
  });
  return { pass, writes, tracker, post, postFile, readCards, deleteMapping };
}

describe('MiraklCardCreationPass sending cards', () => {
  it('should send queued cards as one P41 file and mark them sent', async () => {
    const queued = [card('OL-1', '111', 'pending'), card('OL-2', '222', 'pending')];
    const { pass, writes, postFile } = setup({ queued });

    await pass.run();

    expect(postFile).toHaveBeenCalledTimes(1);
    expect(postFile).toHaveBeenCalledWith(
      '/api/products/imports',
      expect.objectContaining({
        fieldName: 'file',
        content: 'CATALOG_CODE;STR_GOLD;EAN\nOL-1;CAT;111\nOL-2;CAT;222\n',
      })
    );
    expect(writes.markSubmitted).toHaveBeenCalledWith(queued, '30533');
  });

  it('should wait while the last card file is younger than 15 minutes', async () => {
    const { pass, postFile } = setup({
      queued: [card('OL-1', '111', 'pending')],
      lastImportAt: new Date(NOW.getTime() - CARD_IMPORT_INTERVAL_MS + 1000),
    });

    expect(await pass.run()).toEqual({ settled: 0, waiting: 1 });
    expect(postFile).not.toHaveBeenCalled();
  });

  it('should fail the cards of a file Mirakl refuses outright', async () => {
    const queued = [card('OL-1', '111', 'pending')];
    const { pass, writes, postFile } = setup({ queued });
    postFile.mockRejectedValueOnce(new MiraklApiException('bad', 400, 'IMPORT_INVALID'));

    await pass.run();

    expect(writes.failPending).toHaveBeenCalledWith(
      queued,
      expect.stringContaining('IMPORT_INVALID')
    );
    expect(writes.markSubmitted).not.toHaveBeenCalled();
  });
});

describe('MiraklCardCreationPass following sent cards', () => {
  it('should send the offer of a card that arrived in the catalogue and settle the card', async () => {
    const sent = [
      card('OL-1', '111', 'submitted', '30532'),
      card('OL-2', '222', 'submitted', '30532'),
    ];
    const { pass, writes, post } = setup({ sent, cards: ['111'] });

    const result = await pass.run();

    expect(post).toHaveBeenCalledWith('/api/offers', {
      offers: [expect.objectContaining({ shop_sku: 'OL-1', product_id: '111' })],
    });
    expect(writes.recordSubmitted).toHaveBeenCalledWith(
      'conn-1',
      'offer',
      [{ offerSku: 'OL-1', value: '10.00' }],
      '999'
    );
    expect(writes.settleWrites).toHaveBeenCalledWith([sent[0]], 'applied');
    expect(result).toEqual({ settled: 1, waiting: 1 });
  });

  it('should keep waiting while the operator has not accepted the card', async () => {
    const { pass, post, writes } = setup({ sent: [card('OL-1', '111', 'submitted', '30532')] });

    expect(await pass.run()).toEqual({ settled: 0, waiting: 1 });
    expect(post).not.toHaveBeenCalled();
    expect(writes.settleWrites).not.toHaveBeenCalled();
  });

  it('should fail a card the report names, with Mirakl reason, and keep the others', async () => {
    const sent = [
      card('OL-1', '111', 'submitted', '30532'),
      card('OL-2', '222', 'submitted', '30532'),
    ];
    const { pass, writes, tracker } = setup({ sent });
    tracker.getStatus.mockResolvedValue(status({ hasTransformationErrorReport: true }));
    tracker.getProductErrorReports.mockResolvedValue([{ sku: 'OL-2', reason: 'Brak zdjęcia' }]);

    await pass.run();

    expect(tracker.getProductErrorReports).toHaveBeenCalledWith('30532', expect.anything(), [
      'CATALOG_CODE',
    ]);
    expect(writes.settleWrites).toHaveBeenCalledWith([sent[1]], 'failed', 'Brak zdjęcia');
    expect(writes.settleWrites).toHaveBeenCalledTimes(1);
  });

  it('should drop the offer mapping of a failed card so the variant can be listed again', async () => {
    const sent = [
      card('OL-1', '111', 'submitted', '30532'),
      card('OL-2', '222', 'submitted', '30532'),
    ];
    const { pass, tracker, deleteMapping } = setup({ sent });
    tracker.getStatus.mockResolvedValue(status({ hasTransformationErrorReport: true }));
    tracker.getProductErrorReports.mockResolvedValue([{ sku: 'OL-2', reason: 'Brak zdjęcia' }]);

    await pass.run();

    expect(deleteMapping).toHaveBeenCalledTimes(1);
    expect(deleteMapping).toHaveBeenCalledWith('Offer', 'OL-2', 'conn-1');
  });

  it('should match a report line by the card product code when it is shorter than the SKU', async () => {
    const long = card('OL-e4b98e91340a44edb4892905db8810b1', '111', 'submitted', '30532');
    const request = JSON.parse(long.value) as MiraklCardRequest;
    const shortened = new MiraklOfferWrite(
      long.id,
      long.connectionId,
      'card',
      long.offerSku,
      JSON.stringify({
        ...request,
        card: { ...request.card, CATALOG_CODE: 'OL-e4b98e91340a44edb48929' },
      }),
      null,
      'submitted',
      '30532',
      1,
      null,
      NOW,
      NOW
    );
    const { pass, writes, tracker } = setup({ sent: [shortened] });
    tracker.getStatus.mockResolvedValue(status({ hasTransformationErrorReport: true }));
    tracker.getProductErrorReports.mockResolvedValue([
      { sku: 'OL-e4b98e91340a44edb48929', reason: 'Brak producenta' },
    ]);

    await pass.run();

    expect(writes.settleWrites).toHaveBeenCalledWith([shortened], 'failed', 'Brak producenta');
  });

  it('should fail every card of an import whose report names no card', async () => {
    const sent = [card('OL-1', '111', 'submitted', '30532')];
    const { pass, writes, tracker } = setup({ sent });
    tracker.getStatus.mockResolvedValue(
      status({ state: 'done', rawStatus: 'COMPLETE', hasErrorReport: true })
    );
    tracker.getProductErrorReports.mockResolvedValue([{ reason: 'Plik niepoprawny' }]);

    await pass.run();

    expect(writes.settleWrites).toHaveBeenCalledWith(sent, 'failed', 'Plik niepoprawny');
  });

  it('should fail the cards of a failed import', async () => {
    const sent = [card('OL-1', '111', 'submitted', '30532')];
    const { pass, writes, tracker } = setup({ sent });
    tracker.getStatus.mockResolvedValue(status({ state: 'failed', rawStatus: 'FAILED' }));

    await pass.run();

    expect(writes.settleWrites).toHaveBeenCalledWith(
      sent,
      'failed',
      expect.stringContaining('FAILED')
    );
  });

  it('should still send queued cards when following a sent one fails, then throw', async () => {
    const { pass, tracker, postFile } = setup({
      sent: [card('OL-1', '111', 'submitted', '30532')],
      queued: [card('OL-2', '222', 'pending')],
    });
    const failure = new Error('socket hang up');
    tracker.getStatus.mockRejectedValue(failure);

    await expect(pass.run()).rejects.toBe(failure);
    expect(postFile).toHaveBeenCalledTimes(1);
  });
});
