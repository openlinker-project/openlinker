/**
 * Count Product Variants Query DTO (#2944)
 *
 * Query parameters for the `/count` siblings of the two variant list routes.
 *
 * Derived from {@link ListProductVariantsQueryDto} with `OmitType` rather than
 * restated, for the same reason `CountProductsQueryDto` is: the count must
 * apply the identical filter surface to the list.
 *
 * @module apps/api/src/products/http/dto
 */
import { OmitType } from '@nestjs/swagger';
import { ListProductVariantsQueryDto } from './list-product-variants-query.dto';

export class CountProductVariantsQueryDto extends OmitType(ListProductVariantsQueryDto, [
  'limit',
  'offset',
  'withTotal',
] as const) {}
