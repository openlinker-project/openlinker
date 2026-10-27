/**
 * Order Handled-In-OpenLinker DTO (#3482)
 *
 * The packing position of an order OpenLinker handles itself — an order the
 * OMS router sent to the pack bench instead of mirroring it to a product
 * master. Derived from the order's live fulfilment work, never stored on the
 * order and never a member of the health partition.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { OrderWorkStageValues, type OrderWorkStage } from '@openlinker/core/fulfillment';

export class OrderHandledInOpenLinkerDto {
  @ApiProperty({
    enum: OrderWorkStageValues,
    description:
      'Where the packing has got, in time order: to-pack -> packing -> packed. A split order ' +
      'reports the EARLIEST stage across its works, since it is only as far along as its ' +
      'least-advanced parcel.',
  })
  stage!: OrderWorkStage;

  @ApiProperty({ description: 'How many live work objects cover the order. Always >= 1.' })
  workCount!: number;

  @ApiProperty({
    enum: ['single', 'mixed'],
    description:
      'single: every live work agrees on its packer (assignedToUserId is that packer, or null for ' +
      'Unassigned). mixed: a split order whose works are assigned to different people; no single ' +
      'name is true, so assignedToUserId is null.',
  })
  assignment!: 'single' | 'mixed';

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The packer (user id) when assignment is single and someone is assigned, else null.',
  })
  assignedToUserId!: string | null;
}
