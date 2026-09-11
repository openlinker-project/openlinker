/**
 * Paginated Total Response DTO (#2944)
 *
 * What every `/count` sibling of an expensive list route answers with.
 *
 * One shape across `/orders/count`, `/listings/count`, `/products/count`,
 * `/products/:productId/variants/count`, `/variants/search/count` and
 * `/customers/count`, so a client learns the convention once. Deliberately
 * carries the total and nothing else: it takes no pagination, so there is no
 * `limit` or `offset` to echo, and the answer is a pure function of the
 * filters - which is what makes it cacheable per filter combination.
 *
 * @module apps/api/src/common/dto
 * @see PaginatedReadQueryDto for the `?withTotal=false` opt-out on the list route
 */
import { ApiProperty } from '@nestjs/swagger';

export class PaginatedTotalResponseDto {
  @ApiProperty({ description: 'Total number of rows matching the filters, ignoring pagination' })
  total!: number;
}
