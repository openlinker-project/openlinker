/**
 * Mirakl Card Creation Pass
 *
 * Moves the product cards OpenLinker creates (#4278, part 2) from the queue to
 * a live offer. Runs inside `marketplace.offerQuantity.reconcile` (every 5
 * minutes per connection), after the stock and price files:
 *
 * 1. **Follow sent cards.** For each P41 import still open, read its status
 *    (P42). A failed import fails its cards. A card the transformation or the
 *    operator refused fails with Mirakl's reason, read from the import's
 *    reports (P47 transformation errors, P44 integration errors) and matched
 *    by the card's catalogue code. A report line that names no card cannot be
 *    told apart, so it fails every card of that import rather than leaving
 *    them waiting for ever.
 * 2. **Create the offers whose card arrived.** The cards still open are looked
 *    up by EAN (P31); for every card now in the catalogue, the queued OF24
 *    line is sent (one OF24 call for all of them) and recorded as an `offer`
 *    write, which the status read and the offer-writes pass follow from there.
 *    A card the operator has not accepted yet simply waits: Empik reviews
 *    cards by hand, and nothing here gives up on a slow review.
 * 3. **Send queued cards.** Mirakl asks for P41 at most every 15 minutes, so
 *    queued cards go out as ONE file, and only when the last card file of the
 *    connection is at least that old.
 *
 * A card that fails for good (refused file, import, card or offer) never
 * became an offer, so the offer mapping the create wrote is dropped with it:
 * otherwise the wizard reads the variant as already listed and it can never
 * be listed again. Dropping is best effort and never holds back the pass.
 *
 * Each step is guarded on its own; a failure is logged and the first one is
 * thrown at the end, so the job is retried without one step holding back the
 * others.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { CORE_ENTITY_TYPE, type IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { MiraklOfferWrite } from '../../domain/entities/mirakl-offer-write.entity';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { buildMiraklCardFile } from '../../domain/policies/mirakl-card.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklCardRequest } from '../../domain/types/mirakl-card.types';
import type { MiraklCardAttributeCodes } from '../../domain/types/mirakl-operator-profile.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import type { IMiraklImportTracker } from '../imports/mirakl-import-tracker.interface';
import type { MiraklCatalog } from './mirakl-catalog';
import { describeMiraklFailure } from './mirakl-order-reader';

const PRODUCT_IMPORT_PATH = '/api/products/imports';
const OF24_PATH = '/api/offers';
/** Mirakl's guidance for P41: one product import per shop every 15 minutes. */
export const CARD_IMPORT_INTERVAL_MS = 15 * 60 * 1000;
/** Cards followed or sent per pass. */
const MAX_CARDS_PER_PASS = 500;

export interface MiraklCardCreationPassDeps {
  readonly connectionId: string;
  readonly brand: string;
  readonly httpClient: IMiraklHttpClient;
  readonly importTracker: IMiraklImportTracker;
  readonly catalog: MiraklCatalog;
  readonly writes: MiraklOfferWriteRepositoryPort;
  readonly codes: MiraklCardAttributeCodes;
  /** Drops the offer mapping of a card that failed; absent leaves it. */
  readonly identifierMapping?: Pick<IdentifierMappingPort, 'deleteMapping'>;
  readonly now?: () => Date;
}

export interface MiraklCardCreationPassResult {
  /** Cards whose offer was sent, or that failed, in this pass. */
  readonly settled: number;
  /** Cards still queued or waiting for the operator. */
  readonly waiting: number;
}

export class MiraklCardCreationPass {
  private readonly logger = new Logger(MiraklCardCreationPass.name);
  private readonly now: () => Date;

  constructor(private readonly deps: MiraklCardCreationPassDeps) {
    this.now = deps.now ?? ((): Date => new Date());
  }

  async run(): Promise<MiraklCardCreationPassResult> {
    let settled = 0;
    let waiting = 0;
    let firstFailure: unknown;
    const guard = async (step: string, work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        firstFailure ??= error;
        this.logger.warn(
          `Card ${step} failed on connection ${this.deps.connectionId}: ${describeError(error)}`
        );
      }
    };

    await guard('follow-up', async () => {
      const outcome = await this.followSentCards();
      settled += outcome.settled;
      waiting += outcome.waiting;
    });
    await guard('import', async () => {
      waiting += await this.sendQueuedCards();
    });

    if (firstFailure !== undefined) {
      throw firstFailure;
    }
    return { settled, waiting };
  }

  private async followSentCards(): Promise<MiraklCardCreationPassResult> {
    const sent = await this.deps.writes.findSubmitted(
      this.deps.connectionId,
      'card',
      MAX_CARDS_PER_PASS
    );
    let settled = 0;
    const open: MiraklOfferWrite[] = [];
    const byImport = new Map<string, MiraklOfferWrite[]>();
    for (const write of sent) {
      const key = write.importId ?? '';
      byImport.set(key, [...(byImport.get(key) ?? []), write]);
    }
    for (const [importId, writes] of byImport) {
      const outcome = await this.settleImport(importId, writes);
      settled += outcome.settled;
      open.push(...outcome.open);
    }
    const created = await this.createOffersForArrivedCards(open);
    return { settled: settled + created, waiting: open.length - created };
  }

  /** Fails the cards the import refused; returns the rest, still waiting. */
  private async settleImport(
    importId: string,
    writes: MiraklOfferWrite[]
  ): Promise<{ settled: number; open: MiraklOfferWrite[] }> {
    if (!importId) {
      return { settled: 0, open: writes };
    }
    const status = await this.deps.importTracker.getStatus('products', importId);
    if (status.state === 'pending') {
      return { settled: 0, open: writes };
    }
    if (status.state === 'failed') {
      const reason = `The product card import ended as ${status.rawStatus ?? 'failed'}`;
      return { settled: await this.failCards(writes, reason), open: [] };
    }
    const hasErrors =
      (status.linesInError ?? 0) > 0 ||
      status.hasErrorReport ||
      status.hasTransformationErrorReport === true;
    if (!hasErrors) {
      return { settled: 0, open: writes };
    }
    const lines = await this.deps.importTracker.getProductErrorReports(importId, status, [
      this.deps.codes.catalogCode,
    ]);
    if (lines.length === 0) {
      return { settled: 0, open: writes };
    }
    if (lines.some((line) => !line.sku)) {
      const reason = lines[0].reason;
      this.logger.warn(
        `${this.deps.brand} reported a card error without naming the card in import ${importId}; ` +
          `failing its ${writes.length} card(s) [connectionId=${this.deps.connectionId}]`
      );
      return { settled: await this.failCards(writes, reason), open: [] };
    }
    const reasons = new Map(lines.map((line) => [line.sku as string, line.reason]));
    let settled = 0;
    const open: MiraklOfferWrite[] = [];
    for (const write of writes) {
      // The report names a card by its product code, which may be shorter
      // than the offer SKU (an operator caps it); a card sent before the cap
      // carried the SKU itself.
      const catalogCode = readRequest(write)?.card[this.deps.codes.catalogCode] ?? write.offerSku;
      const reason = reasons.get(catalogCode);
      if (reason === undefined) {
        open.push(write);
      } else {
        settled += await this.failCards([write], reason);
      }
    }
    return { settled, open };
  }

  /** Sends the offers of the cards now in the catalogue; returns how many. */
  private async createOffersForArrivedCards(open: readonly MiraklOfferWrite[]): Promise<number> {
    const requests = open
      .map((write) => ({ write, request: readRequest(write) }))
      .filter((entry): entry is { write: MiraklOfferWrite; request: MiraklCardRequest } => {
        if (entry.request === null) {
          this.logger.warn(
            `Card request ${entry.write.id} could not be read; it is left as it is [connectionId=${this.deps.connectionId}]`
          );
          return false;
        }
        return true;
      });
    if (requests.length === 0) {
      return 0;
    }
    const cards = await this.deps.catalog.readCards(requests.map(({ request }) => request.ean));
    const arrived = requests.filter(({ request }) => (cards.get(request.ean) ?? []).length > 0);
    if (arrived.length === 0) {
      return 0;
    }

    let importId: string;
    try {
      const { data } = await this.deps.httpClient.post<{ import_id?: string | number }>(OF24_PATH, {
        offers: arrived.map(({ request }) => request.offer),
      });
      if (data?.import_id === undefined || data.import_id === null || data.import_id === '') {
        // The offers may have gone in; the cards stay open and are sent again
        // next pass, which is safe because OF24 upserts by shop SKU.
        this.logger.warn(
          `${this.deps.brand} answered the offer import without an import_id; ${arrived.length} card(s) stay open [connectionId=${this.deps.connectionId}]`
        );
        return 0;
      }
      importId = String(data.import_id);
    } catch (error) {
      if (error instanceof MiraklApiException && isDefiniteRefusal(error)) {
        const reason = `${this.deps.brand} refused the offer: ${describeMiraklFailure(error.statusCode, error.miraklCode)}`;
        return this.failCards(
          arrived.map(({ write }) => write),
          reason
        );
      }
      throw error;
    }

    await this.deps.writes.recordSubmitted(
      this.deps.connectionId,
      'offer',
      arrived.map(({ write, request }) => ({
        offerSku: write.offerSku,
        value: request.offer.price,
      })),
      importId
    );
    const settled = await this.deps.writes.settleWrites(
      arrived.map(({ write }) => write),
      'applied'
    );
    this.logger.log(
      `${arrived.length} ${this.deps.brand} card(s) arrived in the catalogue; offers sent as import ${importId} [connectionId=${this.deps.connectionId}]`
    );
    return settled;
  }

  /** Sends queued cards as one P41 file when the last one is old enough. */
  private async sendQueuedCards(): Promise<number> {
    const queued = await this.deps.writes.findPending(
      this.deps.connectionId,
      'card',
      MAX_CARDS_PER_PASS
    );
    if (queued.length === 0) {
      return 0;
    }
    const last = await this.deps.writes.latestImportAt(this.deps.connectionId, 'card');
    if (last !== null && this.now().getTime() - last.getTime() < CARD_IMPORT_INTERVAL_MS) {
      return queued.length;
    }

    const readable = queued
      .map((write) => ({ write, request: readRequest(write) }))
      .filter(
        (entry): entry is { write: MiraklOfferWrite; request: MiraklCardRequest } =>
          entry.request !== null
      );
    const unreadable = queued.filter((write) => readRequest(write) === null);
    if (unreadable.length > 0) {
      await this.deps.writes.failPending(unreadable, 'The queued card could not be read');
      await this.dropOfferMappings(unreadable);
    }
    if (readable.length === 0) {
      return 0;
    }

    const content = buildMiraklCardFile(
      readable.map(({ request }) => request.card),
      this.deps.codes
    );
    let importId: string;
    try {
      const { data } = await this.deps.httpClient.postFile<{ import_id?: string | number }>(
        PRODUCT_IMPORT_PATH,
        {
          fieldName: 'file',
          fileName: `cards-${this.now().toISOString().replace(/[:.]/g, '-')}.csv`,
          contentType: 'text/csv',
          content,
        }
      );
      if (data?.import_id === undefined || data.import_id === null || data.import_id === '') {
        this.logger.warn(
          `${this.deps.brand} answered the card import without an import_id; ${readable.length} card(s) stay queued [connectionId=${this.deps.connectionId}]`
        );
        return readable.length;
      }
      importId = String(data.import_id);
    } catch (error) {
      if (error instanceof MiraklApiException && isDefiniteRefusal(error)) {
        const reason = `${this.deps.brand} refused the card file: ${describeMiraklFailure(error.statusCode, error.miraklCode)}`;
        await this.deps.writes.failPending(
          readable.map(({ write }) => write),
          reason
        );
        await this.dropOfferMappings(readable.map(({ write }) => write));
        this.logger.warn(`${reason} [connectionId=${this.deps.connectionId}]`);
        return 0;
      }
      throw error;
    }

    const submitted = await this.deps.writes.markSubmitted(
      readable.map(({ write }) => write),
      importId
    );
    this.logger.log(
      `Sent ${submitted} ${this.deps.brand} product card(s) as import ${importId} [connectionId=${this.deps.connectionId}]`
    );
    return submitted;
  }

  /** Fails sent cards and drops their offer mappings; returns how many failed. */
  private async failCards(writes: readonly MiraklOfferWrite[], reason: string): Promise<number> {
    const failed = await this.deps.writes.settleWrites(writes, 'failed', reason);
    await this.dropOfferMappings(writes);
    return failed;
  }

  /**
   * The offer behind a failed card was never created on Mirakl, so its
   * mapping only blocks listing the variant again. A failure to drop one is
   * logged; the next listing attempt then reports the variant as listed.
   */
  private async dropOfferMappings(writes: readonly MiraklOfferWrite[]): Promise<void> {
    const mappings = this.deps.identifierMapping;
    if (!mappings) return;
    for (const write of writes) {
      try {
        await mappings.deleteMapping(CORE_ENTITY_TYPE.Offer, write.offerSku, this.deps.connectionId);
      } catch (error) {
        this.logger.warn(
          `Could not drop the offer mapping of failed card ${write.offerSku}: ` +
            `${error instanceof Error ? error.message : String(error)} [connectionId=${this.deps.connectionId}]`
        );
      }
    }
  }
}

/** The queued request, or null when its JSON is unreadable. */
export function readRequest(write: MiraklOfferWrite): MiraklCardRequest | null {
  try {
    const parsed: unknown = JSON.parse(write.value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as MiraklCardRequest).ean === 'string' &&
      typeof (parsed as MiraklCardRequest).card === 'object' &&
      typeof (parsed as MiraklCardRequest).offer === 'object'
    ) {
      return parsed as MiraklCardRequest;
    }
  } catch {
    // Fall through: an unreadable value is reported by the caller.
  }
  return null;
}

/**
 * A refusal Mirakl answered about the request itself. 401/403 never get here
 * (`MiraklAuthenticationException`), and 429 / 5xx are worth another pass.
 */
function isDefiniteRefusal(error: MiraklApiException): boolean {
  const status = error.statusCode;
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

function describeError(error: unknown): string {
  if (error instanceof MiraklApiException) {
    return describeMiraklFailure(error.statusCode, error.miraklCode);
  }
  return error instanceof Error ? error.name : 'error';
}
