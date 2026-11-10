/**
 * Gift attention DTOs (#3935)
 *
 * What an order page needs to say why a gift that should be there is not: one
 * entry per promotion application that did not give its gift. Deliberately narrow, no
 * step detail, no report text, no cost or buyer data: the reason travels as a
 * code and the page owns the sentence.
 *
 * @module apps/api/src/promotions/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class GiftAttentionItemDto {
  @ApiProperty({ description: 'The firing; the id a skip is recorded against.' })
  runId!: string;
  @ApiProperty() ruleId!: string;
  @ApiProperty({ description: 'Frozen at write time.' }) ruleName!: string;
  @ApiProperty({ enum: ['failed', 'not-applied'] })
  outcome!: 'failed' | 'not-applied';
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Why no gift was added, as a code. Null when the run recorded none.',
  })
  reasonCode!: string | null;
  @ApiProperty({ description: 'A person already handled this firing.' }) dismissed!: boolean;
  @ApiProperty() firedAt!: string;
}

export class GiftAttentionResponseDto {
  @ApiProperty({ type: [GiftAttentionItemDto] }) items!: GiftAttentionItemDto[];
  @ApiProperty({
    description: 'False while firings are not persisted: an empty list then says nothing.',
  })
  recordingAvailable!: boolean;
}
