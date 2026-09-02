/**
 * Decline Return DTOs (#2333)
 *
 * Request and response shapes for the one return write.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeclineReturnOutcomeValues } from '@openlinker/core/returns';
import { DeclineReturnOutcome } from '@openlinker/core/returns';

export class DeclineReturnDto {
  /**
   * The SOURCE's own rejection code, opaque to OpenLinker.
   *
   * Deliberately NOT validated against a list here: the vocabulary belongs to
   * the source (Allegro publishes seven values), and an api-layer allow-list
   * would be marketplace vocabulary in the host — the exact coupling the
   * CORE/Integration boundary exists to prevent. The ADAPTER validates it before
   * spending a network round trip, and reports an unrecognised code as a
   * refusal naming the codes it does accept.
   */
  @ApiProperty({
    description:
      "The source's own rejection code. Opaque to OpenLinker; the connection's adapter validates it and reports the accepted values on a miss.",
    example: 'REFUND_REJECTED',
  })
  @IsString()
  @IsNotEmpty()
  reasonCode!: string;

  /**
   * Operator free text. Some sources require it for some codes — that rule is
   * the adapter's, because only the adapter knows which codes those are.
   *
   * Capped generously here and truncated to the source's own limit by the
   * adapter, so a long comment shortens a decline rather than abandoning one.
   */
  @ApiPropertyOptional({
    description:
      'Operator comment. Some sources require one for some codes; the adapter enforces that and truncates to the source limit.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class DeclineReturnResponseDto {
  @ApiProperty({
    enum: DeclineReturnOutcomeValues,
    description:
      "How the attempt ended. `decline-sent` means the source accepted the request but has not yet reported the decline as a fact — a 2xx alone never means 'declined by the source'.",
  })
  outcome!: DeclineReturnOutcome;

  @ApiProperty({
    nullable: true,
    description: 'The ADR-044 change-proposal row this attempt resolved to.',
  })
  changeId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The SOURCE's own decline instant, ISO-8601. Null until the source reports it; never OpenLinker's clock.",
  })
  declinedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: "Present only for `refused` — the source's own words.",
  })
  refusalReason!: string | null;
}
