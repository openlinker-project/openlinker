/**
 * Order Note Timeline Response DTO (#3531)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderNoteTimelineEventKindValues,
  type OrderNoteTimelineEventKind,
} from '@openlinker/core/orders';

export class OrderNoteTimelineEntryResponseDto {
  @ApiProperty()
  noteId!: string;

  @ApiProperty({ enum: OrderNoteTimelineEventKindValues })
  kind!: OrderNoteTimelineEventKind;

  @ApiProperty()
  occurredAt!: string;

  @ApiProperty()
  actorUsername!: string;

  @ApiPropertyOptional({ nullable: true })
  body!: string | null;

  @ApiPropertyOptional({ nullable: true })
  showToPacker!: boolean | null;
}
