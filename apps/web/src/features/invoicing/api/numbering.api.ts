/**
 * Invoice numbering API client (#1577, binds C2 #1576)
 *
 * Thin API module for the numbering-series surface. Contributed to the client
 * as a plugin namespace (`invoiceNumbering`) by the KSeF plugin — the endpoints
 * are core-invoicing, but numbering is only reachable today from the KSeF
 * connection's Actions, so the namespace rides the KSeF plugin's build slot
 * rather than the always-present core client (mirrors the Allegro pattern:
 * feature owns the factory, plugin declares the namespace).
 *
 * @module apps/web/src/features/invoicing/api
 */
import type {
  CreateNumberingSeriesInput,
  NumberingAssignment,
  NumberingSeries,
  SetNumberingAssignmentInput,
  UnassignedNumberingSeries,
  UpdateNumberingSeriesInput,
} from './numbering.types';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface NumberingApi {
  /** `GET /invoicing/numbering-series` — all series, newest first. */
  listSeries: () => Promise<NumberingSeries[]>;
  /** `GET /invoicing/numbering-series/unassigned` — orphaned series + last-issued number. */
  listUnassigned: () => Promise<UnassignedNumberingSeries[]>;
  /** `GET /invoicing/numbering-series/:seriesId` — one series (404 → throws). */
  getSeries: (seriesId: string) => Promise<NumberingSeries>;
  /** `POST /invoicing/numbering-series` — create a series (admin). */
  createSeries: (input: CreateNumberingSeriesInput) => Promise<NumberingSeries>;
  /** `PATCH /invoicing/numbering-series/:seriesId` — partial update (admin). */
  updateSeries: (seriesId: string, input: UpdateNumberingSeriesInput) => Promise<NumberingSeries>;
  /** `GET /invoicing/connections/:connectionId/numbering-assignment` — 404 when none. */
  getAssignment: (connectionId: string) => Promise<NumberingAssignment>;
  /** `PUT /invoicing/connections/:connectionId/numbering-assignment` — attach/replace (admin). */
  setAssignment: (
    connectionId: string,
    input: SetNumberingAssignmentInput,
  ) => Promise<NumberingAssignment>;
  /** `DELETE /invoicing/connections/:connectionId/numbering-assignment` — detach (admin). */
  deleteAssignment: (connectionId: string) => Promise<void>;
}

export function createNumberingApi(request: ApiRequest): NumberingApi {
  return {
    listSeries(): Promise<NumberingSeries[]> {
      return request<NumberingSeries[]>('/invoicing/numbering-series');
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
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
      );
    },
    getAssignment(connectionId): Promise<NumberingAssignment> {
      return request<NumberingAssignment>(
        `/invoicing/connections/${encodeURIComponent(connectionId)}/numbering-assignment`,
      );
    },
    setAssignment(connectionId, input): Promise<NumberingAssignment> {
      return request<NumberingAssignment>(
        `/invoicing/connections/${encodeURIComponent(connectionId)}/numbering-assignment`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        },
      );
    },
    deleteAssignment(connectionId): Promise<void> {
      return request<void>(
        `/invoicing/connections/${encodeURIComponent(connectionId)}/numbering-assignment`,
        { method: 'DELETE' },
      );
    },
  };
}
