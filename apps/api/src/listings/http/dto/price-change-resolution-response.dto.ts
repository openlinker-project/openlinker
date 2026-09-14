/**
 * Price Change Resolution Response DTO (#3162 re-review, IMPORTANT —
 * "the optInAutomatic result is discarded")
 *
 * `accept`/`edit` used to answer a bare `204 No Content` even when the
 * caller requested `optInAutomatic` — so an operator ticking "always accept
 * from this source" had no way to learn that a lock miss or a #2610
 * validation failure meant the connection was never actually flipped into
 * automatic mode. This mirrors the repo's own answer to the same class of
 * silent decline (#2376's `refundRecordWritten: false`, #2341's
 * discriminated `enqueued | skipped | failed`).
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PriceChangeResolutionResponseDto {
  @ApiPropertyOptional({
    description:
      'Present only when `optInAutomatic` was requested on this call. `true` when the (source, connection) pair was actually flipped into automatic mode; `false` when a lock miss or a validation failure meant it was not — the price itself was still published either way.',
    nullable: true,
  })
  optInApplied?: boolean;

  static from(optInApplied: boolean | undefined): PriceChangeResolutionResponseDto {
    const dto = new PriceChangeResolutionResponseDto();
    dto.optInApplied = optInApplied;
    return dto;
  }
}
