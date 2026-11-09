/**
 * Sales-document block params DTO (#3866)
 *
 * The values behind a block's English `detail` (ids, counts and codes only),
 * so the frontend can phrase the reason in the operator's language. Which
 * fields are set depends on the reason; see `SalesDocumentBlockParams`.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MissingTaxRateScope,
  MissingTaxRateScopeValues,
  RoutedConnectionState,
  RoutedConnectionStateValues,
  SalesDocumentPoolKind,
  SalesDocumentPoolKindValues,
} from '@openlinker/core/sales-documents';
import type { SalesDocumentBlockParams } from '@openlinker/core/sales-documents';

export class SalesDocumentBlockParamsDto {
  @ApiPropertyOptional() candidateCount?: number;
  @ApiPropertyOptional() eligibleCount?: number;
  @ApiPropertyOptional() primaryCount?: number;
  @ApiPropertyOptional({ enum: SalesDocumentPoolKindValues }) poolKind?: SalesDocumentPoolKind;
  @ApiPropertyOptional() connectionId?: string;
  @ApiPropertyOptional() ruleId?: string;
  @ApiPropertyOptional() documentKind?: string;
  @ApiPropertyOptional({ enum: RoutedConnectionStateValues })
  connectionState?: RoutedConnectionState;
  @ApiPropertyOptional({ type: [String] }) missingCapabilities?: string[];
  @ApiPropertyOptional({ enum: MissingTaxRateScopeValues }) taxRateScope?: MissingTaxRateScope;
  @ApiPropertyOptional() lineCount?: number;
  @ApiPropertyOptional() totalLines?: number;
  @ApiPropertyOptional() firstLineRef?: string;
}

export function toSalesDocumentBlockParamsDto(
  params: SalesDocumentBlockParams | null,
): SalesDocumentBlockParamsDto | null {
  if (params === null) return null;
  const { missingCapabilities, ...rest } = params;
  return missingCapabilities ? { ...rest, missingCapabilities: [...missingCapabilities] } : rest;
}
