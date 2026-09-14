/**
 * Connection Diagnostics Types
 *
 * The composed per-connection activity read behind `GET
 * /connections/:id/diagnostics` (#3179): the connection itself plus the three
 * independently-fallible activity sources the response folds together, and
 * the closed vocabulary naming any of them that could not be read.
 *
 * Declared here rather than beside the response DTO because the app-layer
 * `ConnectionDiagnosticsService` produces this shape and the interface layer
 * consumes it — an application type imported from `http/dto` would invert the
 * layer direction `docs/engineering-standards.md` § Layer Dependencies fixes.
 *
 * @module apps/api/src/integrations/application/types
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import type { InvoiceRecord } from '@openlinker/core/invoicing';

/**
 * The three independently-read activity sources the diagnostics response
 * folds together. Named here (rather than left as ad hoc strings) so
 * `unreadableSources` carries a closed, FE-narrowable vocabulary.
 */
export const ConnectionDiagnosticsSourceValues = [
  'syncJobs',
  'fiscalRegistrations',
  'invoices',
] as const;
export type ConnectionDiagnosticsSource = (typeof ConnectionDiagnosticsSourceValues)[number];

/**
 * One connection's diagnostics reads, already degraded.
 *
 * A source that could not be read contributes an EMPTY list and is named in
 * `unreadableSources` — never a rejection, and never a silently healthy-looking
 * zero. Every consumer must therefore treat a `null` timestamp derived from
 * these lists as a confirmed absence ONLY while `unreadableSources` is empty.
 */
export interface ConnectionDiagnosticsReads {
  connection: Connection;
  recentJobs: SyncJob[];
  recentFiscalRegistrations: FiscalRegistrationRecord[];
  recentInvoices: InvoiceRecord[];
  unreadableSources: ConnectionDiagnosticsSource[];
}
