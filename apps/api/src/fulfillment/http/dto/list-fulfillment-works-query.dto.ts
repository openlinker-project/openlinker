/**
 * Worklist query DTO (#2406)
 *
 * Validated at the boundary. The page ceiling is `FULFILLMENT_WORKLIST_MAX_LIMIT`
 * — read from the domain constant rather than restated, so the documented bound
 * and the enforced one cannot drift. The repository clamps to the same constant,
 * because the browser is not a trust boundary and a worker or MCP caller never
 * passes through this DTO at all.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  FulfillmentRequestStatusValues,
  FulfillmentWorkStatusValues,
  FULFILLMENT_WORKLIST_DEFAULT_LIMIT,
  FULFILLMENT_WORKLIST_MAX_LIMIT,
  type FulfillmentRequestStatus,
  type FulfillmentWorkStatus,
} from '@openlinker/core/fulfillment';

/**
 * Accept both `?status=open&status=scheduled` and `?status=open,scheduled`.
 *
 * A single repeated key arrives as a string, several as an array — normalising
 * here keeps every downstream consumer facing one shape.
 */
const toStringArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  // `Array.isArray` narrows an `unknown` to `any[]`, not `unknown[]`, so the
  // annotation is what keeps every downstream element `unknown` and the
  // no-unsafe-return rule satisfied. A non-string element is passed through
  // untouched for `@IsIn` to reject — coercing it here would turn a client's
  // type error into a silently different value.
  const raw: readonly unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  const cleaned = raw
    .flatMap((entry): unknown[] => (typeof entry === 'string' ? entry.split(',') : [entry]))
    .map((entry): unknown => (typeof entry === 'string' ? entry.trim() : entry))
    .filter((entry) => entry !== '');
  return cleaned.length > 0 ? cleaned : undefined;
};

export class ListFulfillmentWorksQueryDto {
  @ApiPropertyOptional({ enum: FulfillmentWorkStatusValues, isArray: true })
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsIn(FulfillmentWorkStatusValues, { each: true })
  status?: FulfillmentWorkStatus[];

  @ApiPropertyOptional({ enum: FulfillmentRequestStatusValues, isArray: true })
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsIn(FulfillmentRequestStatusValues, { each: true })
  requestStatus?: FulfillmentRequestStatus[];

  @ApiPropertyOptional({ description: 'Restrict to work sourced from one location' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Restrict to work covering one order' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: FULFILLMENT_WORKLIST_MAX_LIMIT,
    default: FULFILLMENT_WORKLIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(FULFILLMENT_WORKLIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number;
}
