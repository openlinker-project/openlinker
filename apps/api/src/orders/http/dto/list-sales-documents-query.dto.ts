/**
 * List Sales Documents Query DTO (#3306)
 *
 * Query parameters for `GET /sales-documents` - the merged, keyset-paginated
 * cross-order list. Mirrors `ListInvoicesQueryDto`'s filter shape where the
 * two overlap; `cursor` replaces `offset` (see
 * `sales-document-list-cursor.codec.ts`), and there is no `total` - a keyset
 * list reports "is there a next page" via `nextCursor`, never a page count.
 *
 * `status` is intentionally a bare string, not `@IsIn` against either
 * `InvoiceStatusValues` or `FiscalRegistrationStatusValues` alone: with
 * `kind` unset it must accept EITHER vocabulary, and validating against their
 * union would let an invoice-only value silently match nothing on a
 * fiscal-receipt row (and vice versa) - exactly the documented, accepted
 * behaviour `SalesDocumentListFilters` already states. A caller combining
 * `kind` with a mismatched `status` gets an empty result, not a 400.
 *
 * @module apps/api/src/orders/http/dto
 */
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CoreSalesDocumentKindValues } from '@openlinker/core/sales-documents';

export class ListSalesDocumentsQueryDto {
  @ApiPropertyOptional({
    enum: CoreSalesDocumentKindValues,
    description:
      'Restrict to one kind. Omitted fetches both; there is no "routing not set" value here - a ' +
      'record-driven list cannot show an order with neither an invoice nor a fiscal-registration record.',
  })
  @IsOptional()
  @IsIn(CoreSalesDocumentKindValues)
  kind?: 'invoice' | 'fiscal-receipt';

  @ApiPropertyOptional({ description: "Matched against whichever source(s) `kind` selects." })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by connection id (either an invoicing or a fiscalization connection).' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on the issued/registered instant (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  issuedFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on the issued/registered instant (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  issuedTo?: string;

  @ApiPropertyOptional({
    description:
      'Buyer-tax-id presence (invoice side only - a fiscal-registration record carries none): ' +
      '"with" / "without".',
    enum: ['with', 'without'],
  })
  @IsOptional()
  @IsIn(['with', 'without'])
  taxId?: 'with' | 'without';

  @ApiPropertyOptional({ description: 'Free-text match against order id / document reference / invoice number.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous page\'s `nextCursor`. Omit for the first page.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
