/**
 * Reorder Sourcing Rules DTO (#2953)
 *
 * Request body for PUT /connections/:connectionId/sourcing-rules/order.
 *
 * The list is EXHAUSTIVE over the connection's non-retired rules — a body naming
 * a subset is refused (409) rather than partially applied, because a partial
 * reorder leaves the un-named rules at stale positions while the operator
 * believes they ordered the whole list. `@ArrayUnique` catches a repeated id
 * here; the set comparison against the database is the service's.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderSourcingRulesDto {
  @ApiProperty({
    type: [String],
    description:
      'Every non-retired rule on the connection, exactly once, in the order they should be ' +
      'evaluated. Rules are renumbered to a dense 1..N.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ruleIds!: string[];
}
