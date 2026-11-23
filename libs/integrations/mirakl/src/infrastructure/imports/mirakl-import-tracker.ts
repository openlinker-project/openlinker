/**
 * Mirakl Import Tracker
 *
 * Reads where an asynchronous Mirakl import stands, for all four import kinds,
 * and normalises the answer to `MiraklImportStatus`. The kinds differ in every
 * detail, all measured on Empik staging (SPIKE-4268 § 2.2):
 *
 * | Kind       | Id      | Status read                                   | Status field    |
 * |------------|---------|-----------------------------------------------|-----------------|
 * | `offers`   | numeric | OF02 `/api/offers/imports/{id}`                | `status`        |
 * | `stock`    | UUID    | STO02 `/api/offers/stock/imports/{id}/status`  | `status`        |
 * | `prices`   | UUID    | PRI02 `/api/offers/pricing/imports?import_id=` | `data[0].status`|
 * | `products` | numeric | P42 `/api/products/imports/{id}`               | `import_status` |
 *
 * Two rules keep a caller from reporting success that did not happen:
 *
 * 1. `COMPLETE` means Mirakl finished reading the file, not that every line
 *    applied. Error lines are reported through `linesInError` and
 *    `hasErrorReport`, and an import with errors still ends `done`.
 * 2. A status this build does not recognise is `pending`, never `done`, and is
 *    logged, so a new Mirakl status cannot be read as finished.
 *
 * @module libs/integrations/mirakl/src/infrastructure/imports
 * @implements {IMiraklImportTracker}
 */
import { Logger } from '@openlinker/shared/logging';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';
import type {
  MiraklImportKind,
  MiraklImportLineError,
  MiraklImportState,
  MiraklImportStatus,
} from '../../domain/types/mirakl-import.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { parseMiraklErrorReport } from './mirakl-error-report.parser';
import type { IMiraklImportTracker } from './mirakl-import-tracker.interface';

/** Ids are numeric (offers, products) or UUIDs (stock, prices). */
const IMPORT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

const DONE_STATUSES = new Set(['COMPLETE']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELLED', 'REJECTED']);
const PENDING_STATUSES = new Set([
  'WAITING',
  'QUEUED',
  'RUNNING',
  'TRANSFORMATION_WAITING',
  'TRANSFORMATION_RUNNING',
]);
/**
 * Product-import statuses after Mirakl hands the transformed file to the
 * operator. Import 30532 sat in `SENT` with the card shown as "not
 * synchronised" for as long as it was watched.
 */
const AWAITING_OPERATOR_STATUSES = new Set(['SENT', 'WAITING_SYNCHRONIZATION_PRODUCT']);

/** The fields the four status bodies share, under their per-kind names. */
interface RawImportStatus {
  status?: unknown;
  import_status?: unknown;
  has_error_report?: unknown;
  lines_in_error?: unknown;
  lines_in_success?: unknown;
  lines_read?: unknown;
  transform_lines_in_error?: unknown;
  transform_lines_in_success?: unknown;
  transform_lines_read?: unknown;
}

interface RawPriceImportList {
  data?: RawImportStatus[];
}

export class MiraklImportTracker implements IMiraklImportTracker {
  private readonly logger = new Logger(MiraklImportTracker.name);

  constructor(
    private readonly client: IMiraklHttpClient,
    private readonly connectionId: string,
  ) {}

  async getStatus(kind: MiraklImportKind, importId: string): Promise<MiraklImportStatus> {
    const id = this.checkedId(importId);
    const raw = await this.readStatus(kind, id);
    if (raw === undefined) {
      // PRI02 lists imports, and a just-submitted one may not be listed yet.
      return { kind, importId, state: 'pending', rawStatus: null, hasErrorReport: false };
    }
    const rawStatus = readString(kind === 'products' ? raw.import_status : raw.status);
    const products = kind === 'products';
    return {
      kind,
      importId,
      state: this.toState(kind, importId, rawStatus),
      rawStatus,
      hasErrorReport: raw.has_error_report === true,
      ...definedCount('linesInError', products ? raw.transform_lines_in_error : raw.lines_in_error),
      ...definedCount('linesInSuccess', products ? raw.transform_lines_in_success : raw.lines_in_success),
      ...definedCount('linesRead', products ? raw.transform_lines_read : raw.lines_read),
    };
  }

  async getErrorReport(kind: MiraklImportKind, importId: string): Promise<MiraklImportLineError[]> {
    const id = this.checkedId(importId);
    const { data } = await this.client.getText(`${this.importBasePath(kind)}/${id}/error_report`);
    return parseMiraklErrorReport(data ?? '');
  }

  private async readStatus(
    kind: MiraklImportKind,
    id: string,
  ): Promise<RawImportStatus | undefined> {
    switch (kind) {
      case 'offers':
        return (await this.client.get<RawImportStatus>(`/api/offers/imports/${id}`)).data;
      case 'stock':
        return (await this.client.get<RawImportStatus>(`/api/offers/stock/imports/${id}/status`)).data;
      case 'products':
        return (await this.client.get<RawImportStatus>(`/api/products/imports/${id}`)).data;
      case 'prices': {
        const { data } = await this.client.get<RawPriceImportList>('/api/offers/pricing/imports', {
          queryParams: { import_id: id },
        });
        return data?.data?.[0];
      }
    }
  }

  private importBasePath(kind: MiraklImportKind): string {
    switch (kind) {
      case 'offers':
        return '/api/offers/imports';
      case 'stock':
        return '/api/offers/stock/imports';
      case 'prices':
        return '/api/offers/pricing/imports';
      case 'products':
        return '/api/products/imports';
    }
  }

  private toState(
    kind: MiraklImportKind,
    importId: string,
    rawStatus: string | null,
  ): MiraklImportState {
    if (rawStatus !== null) {
      if (DONE_STATUSES.has(rawStatus)) return 'done';
      if (FAILED_STATUSES.has(rawStatus)) return 'failed';
      if (PENDING_STATUSES.has(rawStatus)) return 'pending';
      if (kind === 'products' && AWAITING_OPERATOR_STATUSES.has(rawStatus)) {
        return 'awaiting-operator';
      }
    }
    this.logger.warn(
      `Unrecognised Mirakl ${kind} import status "${rawStatus ?? '<none>'}" for import ${importId}; reported as pending [connectionId=${this.connectionId}]`,
    );
    return 'pending';
  }

  private checkedId(importId: string): string {
    if (!IMPORT_ID_PATTERN.test(importId)) {
      throw new MiraklConfigException(
        `Mirakl import id must be alphanumeric (with dashes), got "${importId.slice(0, 80)}"`,
        this.connectionId,
      );
    }
    return encodeURIComponent(importId);
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function definedCount<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  return typeof value === 'number' && Number.isFinite(value)
    ? ({ [key]: value } as Partial<Record<K, number>>)
    : {};
}
