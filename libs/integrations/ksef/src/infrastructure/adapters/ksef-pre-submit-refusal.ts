/**
 * KSeF Pre-Submit Refusal Stamp
 *
 * Marks a throwable raised BEFORE the invoice was handed to KSeF as the
 * neutral terminal `failureMode: 'rejected'` the core `InvoiceService` reads
 * STRUCTURALLY (#1200). Without it every such refusal fell to the fiscal-safe
 * `in-doubt` default (DEF-01): the operator saw "the request timed out", the
 * record could not be re-attempted, and it blocked issuance on every other
 * connection - for a document that provably never existed.
 *
 * "Before submit" is the whole argument: until `submitInvoice` is called no
 * document can exist at KSeF, so a re-attempt is always safe. The same 403 AFTER
 * a submit stays in-doubt (the invoice may have landed), which is why the
 * permission exception is stamped here, per call site, and never class-wide.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import type { CONNECTION_SETUP_FAILURE_CAUSE } from '@openlinker/core/invoicing';
import { KsefPermissionDeniedException } from '../../domain/exceptions/ksef-permission-denied.exception';

/** Operator-facing remedy for a token without the issuance grant; config-only text (#3772). */
export const KSEF_PERMISSION_DENIED_REASON =
  "The KSeF token on this connection is not allowed to issue invoices. Generate a token with the 'wystawianie faktur' " +
  'permission in the KSeF portal, save it in the connection credentials and re-issue.';

// Type-only: the literal is restated so this plugin never value-requires the
// core barrel; `satisfies` keeps the two spellings from drifting.
const CONNECTION_SETUP = 'connection-setup' satisfies typeof CONNECTION_SETUP_FAILURE_CAUSE;

/** Mutable progress marker the adapter flips the moment it starts the submit. */
export interface KsefSubmitProgress {
  submitStarted: boolean;
}

/**
 * Stamp `error` as a pre-submit refusal. Leaves an error that already declares
 * its own `failureMode` untouched, and cannot stamp a non-object throwable,
 * which then keeps the in-doubt default.
 */
export function stampPreSubmitRefusal(error: unknown): void {
  if (typeof error !== 'object' || error === null) {
    return;
  }
  const carrier = error as { failureMode?: unknown };
  if (carrier.failureMode !== undefined) {
    return;
  }
  define(error, 'failureMode', 'rejected');
  if (error instanceof KsefPermissionDeniedException) {
    define(error, 'failureCause', CONNECTION_SETUP);
    define(error, 'reason', KSEF_PERMISSION_DENIED_REASON);
  }
}

function define(target: object, key: string, value: string): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
}
