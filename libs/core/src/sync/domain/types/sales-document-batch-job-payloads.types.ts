/**
 * Batch issuing job payloads (#3583, epic #3515)
 *
 * `salesDocument.batch.tick` carries nothing: it reads the schedules from the
 * connections each time, so a schedule edit applies on the next tick.
 *
 * `salesDocument.batch.run` names one run of one connection's queue. Kinds and
 * segment are plain strings here (the sync context does not import the
 * sales-documents vocabulary); the run handler narrows them.
 *
 * @module libs/core/src/sync/domain/types
 */

export interface SalesDocumentBatchTickPayloadV1 {
  readonly schemaVersion: 1;
}

export interface SalesDocumentBatchRunPayloadV1 {
  readonly schemaVersion: 1;
  readonly trigger: 'schedule' | 'manual';
  /** Concrete kinds this run issues (`invoice`, `fiscal-receipt`). */
  readonly documentKinds: readonly string[];
  /** `all`, or `b2b` / `b2c` for a month-end schedule (D42). */
  readonly segment: string;
  /** ISO instant of the schedule slot; absent for "Run now". */
  readonly slotAt?: string;
  readonly startedByUserId?: string;
}
