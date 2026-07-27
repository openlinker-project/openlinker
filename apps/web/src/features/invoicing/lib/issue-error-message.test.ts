/**
 * resolveIssueErrorMessage — unit tests (#757)
 *
 * Pure mapper from a `POST /invoices` failure to operator-friendly copy. The
 * load-bearing invariant under test: the capability-disabled branch and the
 * fallback emit FIXED strings and NEVER echo `error.message` (which carries the
 * internal connectionId + adapterKey); only the 422 / generic-400 branches
 * surface the server message verbatim.
 */
import { describe, it, expect } from 'vitest';
import { resolveIssueErrorMessage, isCapabilityDisabledError } from './issue-error-message';
import { ApiError } from '../../../shared/api/api-error';

/** Identity `t` — returns the EN fallback so assertions read against real copy. */
const t = (_key: string, fallback: string): string => fallback;

/** A message carrying the internal identifiers the capability branch must hide. */
const LEAKY_MESSAGE =
  "Capability 'Invoicing' not enabled for connection conn_abc123 (adapter subiekt-gt)";

describe('resolveIssueErrorMessage', () => {
  it('capability 400 (CapabilityNotEnabledException) ⇒ fixed friendly copy, no connectionId/adapterKey', () => {
    const error = new ApiError(LEAKY_MESSAGE, 400, {
      error: 'CapabilityNotEnabledException',
      message: LEAKY_MESSAGE,
    });
    const result = resolveIssueErrorMessage(error, t);
    expect(result).toBe('Invoicing is not enabled for this connection.');
    expect(result).not.toContain('conn_abc123');
    expect(result).not.toContain('subiekt-gt');
  });

  it('capability 400 (CapabilityNotSupportedException) ⇒ fixed friendly copy', () => {
    const error = new ApiError(LEAKY_MESSAGE, 400, {
      error: 'CapabilityNotSupportedException',
      message: LEAKY_MESSAGE,
    });
    expect(resolveIssueErrorMessage(error, t)).toBe('Invoicing is not enabled for this connection.');
  });

  it('422 ⇒ surfaces error.message (correlationId string)', () => {
    const msg = 'Provider rejected the invoice (correlationId: c-7f3a)';
    expect(resolveIssueErrorMessage(new ApiError(msg, 422, { message: msg }), t)).toBe(msg);
  });

  it('non-capability 400 (buyer profile) ⇒ surfaces error.message', () => {
    const msg = 'Buyer profile is missing a tax id';
    const error = new ApiError(msg, 400, { error: 'BadRequestException', message: msg });
    expect(resolveIssueErrorMessage(error, t)).toBe(msg);
  });

  it('403 ⇒ permission-specific fixed copy (#1613), no error.message echo', () => {
    const error = new ApiError('Forbidden resource', 403, { message: 'Forbidden resource' });
    const result = resolveIssueErrorMessage(error, t);
    expect(result).toBe(
      "You don't have permission to issue invoices - this action requires an administrator account.",
    );
    expect(result).not.toContain('Forbidden resource');
  });

  it('409 ⇒ already-issued fixed copy', () => {
    const error = new ApiError('Invoice already issued for order: o1', 409, {});
    expect(resolveIssueErrorMessage(error, t)).toBe('This order already has an issued invoice.');
  });

  it('network / non-ApiError ⇒ generic fixed copy (no message echo)', () => {
    const result = resolveIssueErrorMessage(new Error('socket hang up'), t);
    expect(result).toBe('Could not issue the invoice. Please try again.');
    expect(result).not.toContain('socket hang up');
  });
});

describe('isCapabilityDisabledError', () => {
  it('true only for a 400 with a known capability exception name', () => {
    expect(
      isCapabilityDisabledError(new ApiError('x', 400, { error: 'CapabilityNotEnabledException' })),
    ).toBe(true);
  });

  it('false for a 400 with a non-capability exception name', () => {
    expect(isCapabilityDisabledError(new ApiError('x', 400, { error: 'BadRequestException' }))).toBe(
      false,
    );
  });

  it('false for a non-400 status and for non-ApiError values', () => {
    expect(isCapabilityDisabledError(new ApiError('x', 422, { error: 'CapabilityNotEnabledException' }))).toBe(false);
    expect(isCapabilityDisabledError(new Error('x'))).toBe(false);
  });
});
