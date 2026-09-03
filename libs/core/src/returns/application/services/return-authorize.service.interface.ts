/**
 * Return Authorize Service Interface (#2372, ADR-060 / ADR-044)
 *
 * The operator's authorization of a return OpenLinker itself authored.
 *
 * **The restriction IS the contract.** ADR-060's asymmetry: OL declines where the
 * platform allows it (#2333), but authorizes only `origin: 'operator_authored'`
 * returns — the model must not pretend OL decides what the marketplace already
 * decided. A `source_ingested` return is refused with a named error, never a
 * silent no-op.
 *
 * Types live here rather than in a domain `*.types.ts` for the reason the decline
 * pair records: `return-decline.types.ts` holds the neutral command/result crossing
 * the ADAPTER boundary, and this action crosses none — for a return OL authored
 * there is no source to ask, so OL is the authority and there is no adapter shape
 * to name.
 *
 * @module libs/core/src/returns/application/services
 */

export interface AuthorizeReturnInput {
  returnId: string;
  /** The operator. Nullable so a future non-interactive writer is expressible. */
  actorUserId: string | null;
}

/**
 * What one authorize call did.
 *
 * `already-authorized` is an idempotent success, not a refusal — a second click
 * costs one read and changes nothing. A refusal is an exception
 * (`ReturnAuthorizeRefusedError` / `ReturnNotAttributedError` /
 * `ReturnNotFoundError`), never an outcome value, so a caller cannot proceed past
 * one by omission.
 */
export const AuthorizeReturnOutcomeValues = ['authorized', 'already-authorized'] as const;

export type AuthorizeReturnOutcome = (typeof AuthorizeReturnOutcomeValues)[number];

export interface AuthorizeReturnResult {
  outcome: AuthorizeReturnOutcome;
  /**
   * The ADR-044 proposal row this act was recorded as.
   *
   * `null` is reachable only on `already-authorized`, and only where no proposal
   * row can be found for the target — a return stamped before this slice existed.
   * Reported honestly rather than typed non-null and then lied about at the one
   * call site that cannot satisfy it.
   */
  changeId: string | null;
  /** Always populated on both outcomes — the stamp is what `authorized` means. */
  authorizedAt: Date;
}

export interface IReturnAuthorizeService {
  /**
   * Authorize an operator-authored return.
   *
   * @throws {ReturnNotFoundError} the id resolves to no row.
   * @throws {ReturnNotAttributedError} the return is an orphan — raised through the
   *   ONE attribution seam (`assertAttributedForTrigger('authorize')`), never a
   *   local null check, so a caller's `instanceof` matches the same class every
   *   other trigger raises.
   * @throws {ReturnAuthorizeRefusedError} the return is `source_ingested`.
   */
  authorize(input: AuthorizeReturnInput): Promise<AuthorizeReturnResult>;
}
