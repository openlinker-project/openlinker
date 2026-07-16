/**
 * Invoice Numbering Series — Domain Entity
 *
 * The numbering-series aggregate (#1575): a connection-assignable source of
 * legal, sequential document numbers OpenLinker supplies to a
 * `DocumentNumberConsumer` provider. Country-agnostic (ADR-026): a pattern of
 * positional variables, a monotonic sequence, and a reset cadence — no
 * provider/country vocabulary. Anemic by ADR-011: readonly fields plus pure
 * derivations; state changes (allocation, edits) go through the repository.
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import type { ResetPolicy } from '../types/invoice-numbering.types';

export class InvoiceNumberingSeries {
  constructor(
    public readonly id: string,
    public readonly name: string,
    /** Pattern of positional variables (`{seq}`, `{YYYY}`, …); see the pattern renderer. */
    public readonly pattern: string,
    /** The NEXT sequence number to allocate. */
    public readonly nextSeq: number,
    /** Zero-pad width applied to `{seq}` at render time (0 = no padding). */
    public readonly seqPadding: number,
    public readonly resetPolicy: ResetPolicy,
    /** Opaque marker of the period `nextSeq` belongs to; empty for `none`. */
    public readonly periodKey: string,
    /** Neutral document type this series numbers (#9): `invoice` / `corrected` / … */
    public readonly documentType: string,
    /** Optional neutral register/entity scope (#10); `null` = the type's register-less default. */
    public readonly register: string | null,
    /** Fiscal-year start month (1–12) governing `{FY}` (#1692); `1` = calendar year. */
    public readonly fiscalYearStartMonth: number,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
