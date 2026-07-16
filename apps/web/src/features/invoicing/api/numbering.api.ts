/**
 * Invoice numbering API client (binds the numbering-series HTTP surface)
 *
 * Thin API module for the numbering module: series CRUD + filter, the orphaned
 * (unrouted) series list, per-document-type routing, and the gap-audit read
 * model. Contributed to the client as a plugin namespace (`invoiceNumbering`) by
 * the KSeF plugin — the endpoints are core-invoicing, but numbering is only
 * reachable today from a KSeF connection, so the namespace rides the KSeF
 * plugin's build slot (mirrors the Allegro pattern: feature owns the factory,
 * plugin declares the namespace).
 *
 * @module apps/web/src/features/invoicing/api
 */
import type {
  CreateNumberingSeriesInput,
  DeleteNumberingRouteInput,
  ListNumberingSeriesFilter,
  NumberingGapNote,
  NumberingRoute,
  NumberingSeries,
  RecordGapNoteInput,
  SeriesAudit,
  UnassignedNumberingSeries,
  UpdateNumberingSeriesInput,
  UpsertNumberingRouteInput,
} from './numbering.types';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function seriesListPath(filter?: ListNumberingSeriesFilter): string {
  const params = new URLSearchParams();
  if (filter?.documentType) params.set('documentType', filter.documentType);
  if (filter?.register) params.set('register', filter.register);
  const query = params.toString();
  return query ? `/invoicing/numbering-series?${query}` : '/invoicing/numbering-series';
}

export interface NumberingApi {
  /** `GET /invoicing/numbering-series` — series, newest first, optionally filtered. */
  listSeries: (filter?: ListNumberingSeriesFilter) => Promise<NumberingSeries[]>;
  /** `GET /invoicing/numbering-series/unassigned` — orphaned series + last-issued number. */
  listUnassigned: () => Promise<UnassignedNumberingSeries[]>;
  /** `GET /invoicing/numbering-series/:seriesId` — one series (404 → throws). */
  getSeries: (seriesId: string) => Promise<NumberingSeries>;
  /** `POST /invoicing/numbering-series` — create a series (admin). */
  createSeries: (input: CreateNumberingSeriesInput) => Promise<NumberingSeries>;
  /** `PATCH /invoicing/numbering-series/:seriesId` — partial update (admin). */
  updateSeries: (seriesId: string, input: UpdateNumberingSeriesInput) => Promise<NumberingSeries>;
  /** `GET /invoicing/numbering-series/:seriesId/audit` — gap-audit read model. */
  getSeriesAudit: (seriesId: string, options?: { onlyGaps?: boolean }) => Promise<SeriesAudit>;
  /** `POST /invoicing/numbering-series/:seriesId/gap-notes` — record a gap explanation (admin). */
  recordGapNote: (seriesId: string, input: RecordGapNoteInput) => Promise<NumberingGapNote>;
  /** `GET /invoicing/connections/:connectionId/numbering-routes` — the connection's routes. */
  listRoutes: (connectionId: string) => Promise<NumberingRoute[]>;
  /** `PUT /invoicing/connections/:connectionId/numbering-routes` — create/replace a route (admin). */
  upsertRoute: (connectionId: string, input: UpsertNumberingRouteInput) => Promise<NumberingRoute>;
  /** `DELETE /invoicing/connections/:connectionId/numbering-routes` — detach a route (admin). */
  deleteRoute: (connectionId: string, input: DeleteNumberingRouteInput) => Promise<void>;
}

export function createNumberingApi(request: ApiRequest): NumberingApi {
  return {
    listSeries(filter): Promise<NumberingSeries[]> {
      return request<NumberingSeries[]>(seriesListPath(filter));
    },
    listUnassigned(): Promise<UnassignedNumberingSeries[]> {
      return request<UnassignedNumberingSeries[]>('/invoicing/numbering-series/unassigned');
    },
    getSeries(seriesId): Promise<NumberingSeries> {
      return request<NumberingSeries>(
        `/invoicing/numbering-series/${encodeURIComponent(seriesId)}`,
      );
    },
    createSeries(input): Promise<NumberingSeries> {
      return request<NumberingSeries>('/invoicing/numbering-series', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    updateSeries(seriesId, input): Promise<NumberingSeries> {
      return request<NumberingSeries>(
        `/invoicing/numbering-series/${encodeURIComponent(seriesId)}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) },
      );
    },
    getSeriesAudit(seriesId, options): Promise<SeriesAudit> {
      const query = options?.onlyGaps ? '?onlyGaps=true' : '';
      return request<SeriesAudit>(
        `/invoicing/numbering-series/${encodeURIComponent(seriesId)}/audit${query}`,
      );
    },
    recordGapNote(seriesId, input): Promise<NumberingGapNote> {
      return request<NumberingGapNote>(
        `/invoicing/numbering-series/${encodeURIComponent(seriesId)}/gap-notes`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
      );
    },
    listRoutes(connectionId): Promise<NumberingRoute[]> {
      return request<NumberingRoute[]>(
        `/invoicing/connections/${encodeURIComponent(connectionId)}/numbering-routes`,
      );
    },
    upsertRoute(connectionId, input): Promise<NumberingRoute> {
      return request<NumberingRoute>(
        `/invoicing/connections/${encodeURIComponent(connectionId)}/numbering-routes`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) },
      );
    },
    deleteRoute(connectionId, input): Promise<void> {
      return request<void>(
        `/invoicing/connections/${encodeURIComponent(connectionId)}/numbering-routes`,
        { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify(input) },
      );
    },
  };
}
