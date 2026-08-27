/**
 * Return Custody DTOs (#2376, `W2-39`)
 *
 * Request and response shapes for the three per-line custody writes — receive,
 * dispose and the stock attestation.
 *
 * Two things here are acceptance criteria rather than style. Quantities are
 * validated `@IsInt() @Min(1)` at the boundary, which is what makes the domain's
 * `non-positive-quantity` refusal a genuine STATE conflict by the time it can be
 * reached (see `ReturnsExceptionFilter`'s header). And `restockBlocked` is a
 * field of a **2xx** body, never an error: the disposition succeeded and was
 * recorded; it is the inventory-master write that did not.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  ReturnCustodyStateValues,
  ReturnDispositionValues,
  ReturnMoneyStateValues,
  ReturnRestockBlockReasonValues,
  ReturnRestockStateValues,
  type ReturnCustodyState,
  type ReturnDisposition,
  type ReturnMoneyState,
  type ReturnRestockBlockReason,
  type ReturnRestockState,
} from '@openlinker/core/returns';

const NOTE_MAX_LENGTH = 500;

export class ReceiveReturnLineDto {
  @ApiProperty({
    description: 'How many more units arrived. Whole units, at least one.',
    minimum: 1,
    example: 2,
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Operator note.', maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

export class DisposeReturnLineDto {
  @ApiProperty({
    description: 'How many received units are being disposed of. Whole units, at least one.',
    minimum: 1,
    example: 2,
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    enum: ReturnDispositionValues,
    description:
      '`restock` writes the inventory master; `scrap` writes the units off and changes no stock.',
  })
  @IsIn(ReturnDispositionValues)
  disposition!: ReturnDisposition;

  @ApiPropertyOptional({ description: 'Operator note.', maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

export class AttestReturnLineStockDto {
  @ApiPropertyOptional({ description: 'Operator note.', maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}

/**
 * The counters and the two per-line machines, after a write.
 *
 * A projection, not the entity: the read API's `ReturnLineResponseDto` is
 * #2334's and carries fields a write response has no business restating.
 */
export class ReturnLineCountersDto {
  @ApiProperty() id!: string;
  @ApiProperty() quantityAdvised!: number;
  @ApiProperty() quantityReceived!: number;
  @ApiProperty() quantityRestocked!: number;
  @ApiProperty() quantityScrapped!: number;

  @ApiProperty({ enum: ReturnCustodyStateValues })
  custodyState!: ReturnCustodyState;

  @ApiProperty({ enum: ReturnMoneyStateValues })
  moneyState!: ReturnMoneyState;

  @ApiProperty({ enum: ReturnDispositionValues, nullable: true })
  disposition!: ReturnDisposition | null;

  @ApiProperty({ nullable: true, description: 'ISO-8601.' })
  receivedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO-8601.' })
  disposedAt!: string | null;
}

/**
 * What the operator must be told when the inventory master refused.
 *
 * Carries `quantity`, `sku` and `connectionName` verbatim because the
 * remediation copy names all three — *"Add {n} x {sku} in {connection name}
 * yourself"* — and a UI that had to fetch them separately would render the alarm
 * a beat late.
 */
export class RestockBlockedResponseDto {
  @ApiProperty({ description: 'The disposition act to attest to.' })
  eventId!: string;

  @ApiProperty() quantity!: number;

  @ApiProperty({ nullable: true }) sku!: string | null;

  @ApiProperty({ enum: ReturnRestockBlockReasonValues })
  reason!: ReturnRestockBlockReason;

  @ApiProperty({
    nullable: true,
    description: "The adapter's own sentence — what an operator quotes in a support ticket.",
  })
  detail!: string | null;

  @ApiProperty({ nullable: true }) connectionId!: string | null;
  @ApiProperty({ nullable: true }) connectionName!: string | null;

  @ApiProperty({
    enum: ReturnRestockStateValues,
    description: '`blocked` (refused) or `in_doubt` (crossed the boundary, outcome unobserved).',
  })
  state!: ReturnRestockState;
}

export class ReceiveReturnLineResponseDto {
  @ApiProperty({ type: ReturnLineCountersDto })
  line!: ReturnLineCountersDto;

  @ApiProperty({ description: 'The act recorded for this arrival.' })
  eventId!: string;
}

export class DisposeReturnLineResponseDto {
  @ApiProperty({ type: ReturnLineCountersDto })
  line!: ReturnLineCountersDto;

  @ApiProperty({ description: 'The act recorded for this disposition.' })
  eventId!: string;

  @ApiProperty({
    type: RestockBlockedResponseDto,
    nullable: true,
    description:
      'Present ONLY when the inventory-master write did not land. Never an error: the disposition ' +
      'succeeded and is recorded — the units simply stay in `quantityReceived` until an operator ' +
      'attests. `null` on every scrap and every applied restock.',
  })
  restockBlocked!: RestockBlockedResponseDto | null;
}

export class AttestReturnLineStockResponseDto {
  @ApiProperty({ type: ReturnLineCountersDto })
  line!: ReturnLineCountersDto;

  @ApiProperty({
    type: [String],
    description: 'One attestation act per outstanding act it resolved.',
  })
  eventIds!: string[];
}
