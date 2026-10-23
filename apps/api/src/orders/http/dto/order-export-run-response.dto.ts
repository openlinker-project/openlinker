/**
 * Order Export Run Response DTO (#3534, D35)
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderExportFormatValues,
  OrderExportScopeValues,
  OrderExportStatusValues,
  type OrderExportFormat,
  type OrderExportRun,
  type OrderExportScope,
  type OrderExportStatus,
} from '@openlinker/core/orders';

export class OrderExportRunResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: OrderExportStatusValues })
  status!: OrderExportStatus;

  @ApiProperty({ enum: OrderExportFormatValues })
  format!: OrderExportFormat;

  @ApiProperty({ enum: OrderExportScopeValues })
  scope!: OrderExportScope;

  @ApiPropertyOptional({ nullable: true, description: 'null until `ready`.' })
  rowCount!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Whether this run\'s rows carry personal data — resolved from OL_STORE_PII at generation time, null until `ready`.',
  })
  containsPii!: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  createdAt!: string;

  static fromDomain(run: OrderExportRun): OrderExportRunResponseDto {
    const dto = new OrderExportRunResponseDto();
    dto.id = run.id;
    dto.status = run.status;
    dto.format = run.format;
    dto.scope = run.scope;
    dto.rowCount = run.rowCount;
    dto.containsPii = run.containsPii;
    dto.errorMessage = run.errorMessage;
    dto.expiresAt = run.expiresAt.toISOString();
    dto.createdAt = run.createdAt.toISOString();
    return dto;
  }
}
