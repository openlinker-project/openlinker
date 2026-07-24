/**
 * Shipping field-error extractor
 *
 * Sniffs the FE `ApiError.details` shape a shipping-command 502 carries
 * (`shipment.controller.ts` maps `ShippingProviderRejectionException` to
 * `{ message, providerCode, details: { fieldErrors } }`, mirroring the
 * carrier-agnostic `providerDetails.fieldErrors: Record<string, string[]>`
 * convention documented on the exception). Returns the flattened
 * `StructuredError[]` for `StructuredErrorList` when present, `null`
 * otherwise so callers fall back to the bare mutation-error message (#1806).
 *
 * Provider-generic by construction: it reads whatever `fieldErrors` map the
 * 502 body carries — no InPost/ShipX field names are hardcoded here. Any
 * shipping adapter that populates `providerDetails.fieldErrors` renders the
 * same way.
 *
 * @module features/shipments/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type { StructuredError } from '../../../shared/types/structured-error.types';

interface FieldErrorsBody {
  providerCode?: string;
  details: {
    fieldErrors: Record<string, readonly string[]>;
  };
}

// Assumes a FLAT `fieldErrors: Record<string, string[]>` (dotted keys, e.g.
// `receiver.first_name`). If a nested ShipX body reaches the FE before #1816
// flattens it on the backend, `Object.values(fieldErrors)` are objects rather
// than string arrays, this guard returns false, and the Alert degrades to the
// bare generic message — no crash, just no per-field breakdown.
function isFieldErrorsBody(value: unknown): value is FieldErrorsBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { providerCode?: unknown; details?: unknown };
  if (candidate.providerCode !== undefined && typeof candidate.providerCode !== 'string') {
    return false;
  }
  if (typeof candidate.details !== 'object' || candidate.details === null) return false;
  const fieldErrors = (candidate.details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof fieldErrors !== 'object' || fieldErrors === null) return false;
  return Object.values(fieldErrors).every(
    (messages) => Array.isArray(messages) && messages.every((m) => typeof m === 'string'),
  );
}

/**
 * Extracts per-field validation errors from a shipping-command mutation
 * error. One `StructuredError` per (field, message) pair — a field with
 * multiple reasons renders as multiple rows rather than a joined string, so
 * `StructuredErrorList` can list each reason distinctly.
 */
export function extractShippingFieldErrors(err: unknown): StructuredError[] | null {
  if (!(err instanceof ApiError)) return null;
  if (!isFieldErrorsBody(err.details)) return null;

  const code = err.details.providerCode ?? 'validation_error';
  const errors: StructuredError[] = [];
  for (const [field, messages] of Object.entries(err.details.details.fieldErrors)) {
    for (const message of messages) {
      errors.push({ field, code, message });
    }
  }
  return errors.length > 0 ? errors : null;
}
