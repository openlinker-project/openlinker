/**
 * Content State Response DTO
 *
 * Wire shape for `GET /products/:id/content`. Master + channels summary.
 * Channels are filtered by the controller to connections that are active,
 * implement the `OfferFieldUpdater` capability, and have ≥1 offer mapped for
 * the product.
 *
 * @module apps/api/src/content/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class ContentMasterStateDto {
  @ApiProperty({ nullable: true }) baseValue!: string | null;
  @ApiProperty({ nullable: true }) draftValue!: string | null;
  @ApiProperty() hasConflict!: boolean;
  @ApiProperty({ nullable: true }) updatedAt!: string | null;
  @ApiProperty({ nullable: true }) updatedBy!: string | null;
}

export class ContentChannelStateDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty() connectionName!: string;
  @ApiProperty() platformType!: string;
  @ApiProperty() connectionStatus!: string;
  @ApiProperty({ nullable: true }) baseValue!: string | null;
  @ApiProperty({ nullable: true }) draftValue!: string | null;
  @ApiProperty() hasConflict!: boolean;
  @ApiProperty({ nullable: true }) updatedAt!: string | null;
  @ApiProperty({ nullable: true }) updatedBy!: string | null;
  @ApiProperty() linkedOfferCount!: number;
}

export class ContentStateResponseDto {
  @ApiProperty() productId!: string;
  @ApiProperty({ type: ContentMasterStateDto }) master!: ContentMasterStateDto;
  @ApiProperty({ type: [ContentChannelStateDto] }) channels!: ContentChannelStateDto[];
}
