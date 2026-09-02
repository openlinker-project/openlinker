/**
 * Release Order Hold Request DTO (#2341)
 *
 * Request body for `POST /orders/:internalOrderId/holds/:holdId/release`.
 *
 * `note` is OPTIONAL here and conditionally MANDATORY in the domain: DESIGN
 * §6.4 requires one when a USER releases a SERVICE-placed hold. That rule
 * depends on who placed the hold, which the request body cannot know, so
 * `OrderHoldService.assertReleaseAllowed` owns it and raises
 * `HoldReleaseNoteRequiredError` — mapped to 400 by the controller. Declaring it
 * required here would instead refuse a perfectly valid note-less release of a
 * user-placed hold.
 *
 * Empty/whitespace normalises to null in the service and therefore does NOT
 * satisfy the mandatory case.
 *
 * @module apps/api/src/orders/http/dto
 */
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReleaseOrderHoldRequestDto {
  @ApiPropertyOptional({
    example: 'Buyer confirmed the address; releasing.',
    description:
      'Operator free text. Never buyer data. Required by the domain when a user ' +
      'releases a service-placed hold — a 400 names that case when it is missing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
