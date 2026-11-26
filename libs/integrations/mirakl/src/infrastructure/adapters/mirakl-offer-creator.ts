/**
 * Mirakl Offer Creator
 *
 * `OfferCreator` for an offer on an EXISTING catalogue card (#4278, part 1).
 * On a Mirakl operator an offer must point to a card; the card is found by
 * EAN (P31), and the offer is created with OF24 carrying the full field set a
 * create needs, because OF24 resets every field it does not receive:
 *
 * - `shop_sku` (from the OL variant id), `product_id` (the EAN) and
 *   `product_id_type: EAN`, `state_code` 11 (new);
 * - price and quantity from the command;
 * - lead time and logistic class from the batch's `platformParams`, else the
 *   connection's `offerDefaults` (both required by the operator);
 * - the `gpsr-*` offer fields from `Product.gpsr`.
 *
 * OF24 is an asynchronous import. The create answers `validating` and records
 * the import (`mirakl_offer_writes`, kind `offer`), so the creation poller's
 * status read can tell "still importing" from "gone", and the reconciler
 * settles it with the line's error if the import refused it.
 *
 * Only a definite answer refuses the offer: no card in a P31 answer, or a 4xx
 * (other than 429) on OF24. A failed P31 read, a 429 or a 5xx is thrown on, so
 * the job retries; a repeated OF24 is safe, because `update_delete: update`
 * upserts by `shop_sku` and never creates a second offer.
 *
 * A product with no card is refused (`MIRAKL_PRODUCT_CARD_MISSING`): creating
 * cards (P41) waits on how the operator reviews them; on Empik staging a card
 * import stayed waiting indefinitely.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type CreateOfferResult,
  type CreateOfferValidationError,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { readMiraklOfferDefaults } from '../../domain/policies/mirakl-connection-config.policy';
import { buildMiraklGpsrFields } from '../../domain/policies/mirakl-gpsr.policy';
import {
  formatMiraklPrice,
  formatMiraklQuantity,
} from '../../domain/policies/mirakl-offer-file.policy';
import { deriveMiraklShopSku } from '../../domain/policies/mirakl-shop-sku.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklOfferDefaults } from '../../domain/types/mirakl-connection.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import type { MiraklCatalog } from './mirakl-catalog';
import { describeMiraklFailure } from './mirakl-order-reader';

const OF24_PATH = '/api/offers';
/** Mirakl's offer state for a new item. */
const STATE_NEW = '11';

export interface MiraklOfferCreatorDeps {
  readonly connectionId: string;
  readonly adapterKey: string;
  readonly brand: string;
  readonly httpClient: IMiraklHttpClient;
  readonly catalog: MiraklCatalog;
  readonly writes: () => MiraklOfferWriteRepositoryPort;
  readonly offerDefaults: MiraklOfferDefaults;
}

/**
 * A refusal Mirakl answered about the request itself; anything else may pass.
 * A 401 / 403 never gets here: the client throws `MiraklAuthenticationException`
 * for those, which passes through so the connection is flagged for re-auth.
 */
function isDefiniteRefusal(error: MiraklApiException): boolean {
  const status = error.statusCode;
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

export class MiraklOfferCreator {
  private readonly logger = new Logger(MiraklOfferCreator.name);

  constructor(private readonly deps: MiraklOfferCreatorDeps) {}

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    const ean = (cmd.overrides?.ean ?? cmd.variantBarcode ?? '').trim();
    const shopSku = deriveMiraklShopSku(cmd.internalVariantId);
    const settings = this.resolveSettings(cmd);
    const errors: CreateOfferValidationError[] = [...settings.errors];
    if (!ean) {
      errors.push({
        field: 'variantBarcode',
        code: 'EAN_REQUIRED',
        message: `${this.deps.brand} offers point to a catalogue card found by EAN; this variant has none.`,
      });
    }
    const price = formatMiraklPrice(String(cmd.price.amount));
    if (price === null) {
      errors.push({ field: 'price', code: 'PRICE_INVALID', message: 'The price is not a number.' });
    }
    if (errors.length > 0) {
      throw new OfferCreateRejectedException(this.deps.adapterKey, 0, errors);
    }

    const cards = (await this.deps.catalog.readCards([ean])).get(ean) ?? [];
    if (cards.length === 0) {
      throw new OfferCreateRejectedException(this.deps.adapterKey, 0, [
        {
          field: 'variantBarcode',
          code: 'MIRAKL_PRODUCT_CARD_MISSING',
          message:
            `${this.deps.brand} has no catalogue card for EAN ${ean}. Creating cards from OpenLinker ` +
            `is not available yet; add the product in the ${this.deps.brand} seller panel first.`,
        },
      ]);
    }

    if (cards.length > 1) {
      this.logger.warn(
        `${this.deps.brand} has ${cards.length} catalogue cards for EAN ${ean}; the offer is sent ` +
          `by EAN and ${this.deps.brand} picks the card (connection: ${this.deps.connectionId})`
      );
    }

    const body = {
      offers: [
        {
          shop_sku: shopSku,
          product_id: ean,
          product_id_type: 'EAN',
          price,
          quantity: Number(formatMiraklQuantity(cmd.stock)),
          state_code: STATE_NEW,
          update_delete: 'update',
          leadtime_to_ship: settings.leadTimeToShip,
          logistic_class: settings.logisticClass,
          offer_additional_fields: buildMiraklGpsrFields(cmd.gpsr),
        },
      ],
    };
    let importId: string;
    try {
      const { data } = await this.deps.httpClient.post<{ import_id?: string | number }>(
        OF24_PATH,
        body
      );
      if (data?.import_id === undefined || data.import_id === null || data.import_id === '') {
        throw new MiraklApiException(
          `${this.deps.brand} answered the offer import without an import_id`
        );
      }
      importId = String(data.import_id);
    } catch (error) {
      if (error instanceof MiraklApiException && isDefiniteRefusal(error)) {
        throw new OfferCreateRejectedException(this.deps.adapterKey, error.statusCode ?? 0, [
          {
            code: error.miraklCode ?? 'MIRAKL_OFFER_IMPORT_REFUSED',
            message: `${this.deps.brand} refused the offer: ${describeMiraklFailure(error.statusCode, error.miraklCode)}`,
          },
        ]);
      }
      throw error;
    }

    await this.deps
      .writes()
      .recordSubmitted(
        this.deps.connectionId,
        'offer',
        [{ offerSku: shopSku, value: price as string }],
        importId
      );
    return { externalOfferId: shopSku, status: 'validating' };
  }

  private resolveSettings(cmd: CreateOfferCommand): {
    leadTimeToShip?: number;
    logisticClass?: string;
    errors: CreateOfferValidationError[];
  } {
    const batch = readMiraklOfferDefaults(cmd.overrides?.platformParams);
    const errors: CreateOfferValidationError[] = [];
    if (batch.kind === 'invalid') {
      errors.push({
        field: 'overrides.platformParams',
        code: 'OFFER_SETTINGS_INVALID',
        message: 'Lead time must be 0-30 days and the logistic class a code.',
      });
    }
    const fromBatch: MiraklOfferDefaults = batch.kind === 'valid' ? batch : {};
    const leadTimeToShip = fromBatch.leadTimeToShip ?? this.deps.offerDefaults.leadTimeToShip;
    const logisticClass = fromBatch.logisticClass ?? this.deps.offerDefaults.logisticClass;
    if (leadTimeToShip === undefined) {
      errors.push({
        field: 'overrides.platformParams.leadTimeToShip',
        code: 'LEAD_TIME_REQUIRED',
        message: `Set the lead time (days to ship) for ${this.deps.brand} offers.`,
      });
    }
    if (logisticClass === undefined) {
      errors.push({
        field: 'overrides.platformParams.logisticClass',
        code: 'LOGISTIC_CLASS_REQUIRED',
        message: `Set the logistic class for ${this.deps.brand} offers.`,
      });
    }
    return { leadTimeToShip, logisticClass, errors };
  }
}
