/**
 * Mirakl Fake Offer API (#4277)
 *
 * An in-memory stand-in for the Mirakl offer endpoints behind the REAL
 * `MiraklOfferManagerAdapter`, `MiraklOfferWriteReconciler` and
 * `MiraklImportTracker`. It answers:
 *
 * - `GET /api/offers` (OF21): `sku`, `max`, `offset`.
 * - `POST /api/offers/stock/imports` (STO01) and
 *   `POST /api/offers/pricing/imports` (PRI01): keep the file, answer an
 *   `import_id`.
 * - The STO01 status (`.../{id}/status`), the PRI02 list
 *   (`/api/offers/pricing/imports?import_id=`) and both error reports, from
 *   an outcome a test sets per import.
 *
 * Everything else rejects, so an unexpected call (an OF24 above all) fails the
 * test loudly.
 *
 * @module apps/api/test/integration/helpers
 */
import { MiraklApiException } from '@openlinker/integrations-mirakl';
import type { MiraklOffer } from '@openlinker/integrations-mirakl/domain/types/mirakl-offer.types';
import type { IMiraklHttpClient } from '@openlinker/integrations-mirakl/infrastructure/http/mirakl-http-client.interface';
import type {
  MiraklFileUpload,
  MiraklHttpResponse,
  MiraklRequestOptions,
} from '@openlinker/integrations-mirakl/infrastructure/http/mirakl-http-client.types';

export interface SubmittedImport {
  readonly importId: string;
  readonly path: string;
  readonly content: string;
}

interface ImportOutcome {
  status: string;
  linesInError: number;
  errorReport?: string;
}

const STOCK_STATUS = /^\/api\/offers\/stock\/imports\/([^/]+)\/status$/;
const ERROR_REPORT = /^\/api\/offers\/(?:stock|pricing)\/imports\/([^/]+)\/error_report$/;

export class MiraklFakeOfferApi implements IMiraklHttpClient {
  readonly imports: SubmittedImport[] = [];
  private readonly offers: MiraklOffer[] = [];
  private readonly outcomes = new Map<string, ImportOutcome>();
  private nextImport = 1;

  putOffer(offer: MiraklOffer): void {
    this.offers.push(offer);
  }

  /** What Mirakl reports for an import; absent means still running. */
  setOutcome(importId: string, outcome: ImportOutcome): void {
    this.outcomes.set(importId, outcome);
  }

  reset(): void {
    this.imports.length = 0;
    this.offers.length = 0;
    this.outcomes.clear();
    this.nextImport = 1;
  }

  get<T>(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>> {
    const query = options?.queryParams ?? {};
    if (path === '/api/offers') {
      const matching = this.offers.filter(
        (offer) => typeof query.sku !== 'string' || offer.shop_sku === query.sku
      );
      const offset = Number(query.offset ?? 0);
      const max = Number(query.max ?? 10);
      return ok({ offers: matching.slice(offset, offset + max), total_count: matching.length });
    }
    const stock = STOCK_STATUS.exec(path);
    if (stock) {
      return ok(this.rawStatus(decodeURIComponent(stock[1])));
    }
    if (path === '/api/offers/pricing/imports') {
      const id = String(query.import_id ?? '');
      return ok({ data: [{ import_id: id, ...this.rawStatus(id) }] });
    }
    return Promise.reject(new MiraklApiException(`Mirakl fake: no GET ${path}`, 404));
  }

  getText(path: string): Promise<MiraklHttpResponse<string>> {
    const match = ERROR_REPORT.exec(path);
    const report = match ? this.outcomes.get(decodeURIComponent(match[1]))?.errorReport : undefined;
    if (report === undefined) {
      return Promise.reject(new MiraklApiException(`Mirakl fake: no report at ${path}`, 404));
    }
    return Promise.resolve({ status: 200, data: report });
  }

  postFile<T>(path: string, file: MiraklFileUpload): Promise<MiraklHttpResponse<T>> {
    if (path !== '/api/offers/stock/imports' && path !== '/api/offers/pricing/imports') {
      return Promise.reject(new MiraklApiException(`Mirakl fake: no POST ${path}`, 404));
    }
    const importId = `imp-${this.nextImport++}`;
    this.imports.push({ importId, path, content: String(file.content) });
    return ok({ import_id: importId });
  }

  post<T>(path: string): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException(`Mirakl fake: no POST ${path}`, 404));
  }

  put<T>(path: string): Promise<MiraklHttpResponse<T>> {
    return Promise.reject(new MiraklApiException(`Mirakl fake: no PUT ${path}`, 404));
  }

  private rawStatus(importId: string): Record<string, unknown> {
    const outcome = this.outcomes.get(importId);
    if (!outcome) {
      return { status: 'RUNNING', has_error_report: false };
    }
    return {
      status: outcome.status,
      lines_in_error: outcome.linesInError,
      has_error_report: outcome.errorReport !== undefined,
    };
  }
}

function ok<T>(data: unknown): Promise<MiraklHttpResponse<T>> {
  return Promise.resolve({ status: 200, data: data as T });
}
