/**
 * Packing setup error (#3457)
 *
 * Confirm in step 1 makes several independent writes. When one fails the
 * operator is told WHICH, and — because every write is idempotent — that
 * confirming again continues from there rather than starting over.
 *
 * @module features/oms-onboarding/lib
 */

export type OmsSetupStep = 'connection' | 'location' | 'location-inactive' | 'override' | 'conflict';

export class OmsSetupError extends Error {
  readonly step: OmsSetupStep;
  /** The product master the failing write was for, when there is one. */
  readonly connectionName: string | null;
  readonly failure: unknown;

  constructor(step: OmsSetupStep, cause: unknown, connectionName: string | null = null) {
    super(cause instanceof Error ? cause.message : `Packing setup failed at ${step}`);
    this.name = 'OmsSetupError';
    this.step = step;
    this.connectionName = connectionName;
    this.failure = cause;
  }
}
