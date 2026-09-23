/**
 * Assignment PATCH request DTO (#3337, ADR-074; `expectedVersion` #3340
 * second follow-up)
 *
 * `assignedToUserId` and `selfServeEligible` are optional and independently
 * applied — `undefined` means "leave alone". `assignedToUserId` additionally
 * distinguishes `null` (clear) from a UUID (set/reassign): `@ValidateIf`
 * skips `@IsUUID` when the value is `null`, so a caller may send either
 * without one shape failing the other (the `pricing-sync-setting.dto.ts`
 * precedent for a nullable-but-typed field).
 *
 * The core service refuses a body naming NEITHER of those two fields
 * (`EmptyFulfillmentWorkAssignmentUpdateError`) — this DTO does not, because
 * "both absent" and "both explicitly omitted by a client that sent `{}`" are
 * indistinguishable at the transport layer, and the service's refusal already
 * covers it with a name a client can act on.
 *
 * `expectedVersion` is a THIRD, independently optional field: a lost-update
 * guard, not a staffing field, so its absence is never a reason to refuse the
 * body — omitting it keeps a pre-existing caller's unconditional write
 * unchanged.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';

export class UpdateFulfillmentWorkAssignmentDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'A packer to pre-assign this parcel to, or null to clear an existing assignment. Omit to ' +
      'leave the current assignment untouched. NOT VALIDATED against the users table today — ' +
      'a UUID naming no real user, or one with no bench access (e.g. a viewer), is accepted and ' +
      'locks the parcel to a principal that can never open it. See #3361 review; closing this ' +
      'needs a users-context read this endpoint does not have yet.',
  })
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  assignedToUserId?: string | null;

  @ApiPropertyOptional({
    description:
      'Whether a packer other than assignedToUserId may still work this parcel. Omit to leave ' +
      'unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  selfServeEligible?: boolean;

  @ApiPropertyOptional({
    description:
      'The version this caller read the parcel at (#3340 second follow-up). When supplied, ' +
      "every write this PATCH performs is guarded against it and a peer's write that moved " +
      'the version first answers 409 rather than being silently overwritten. Omit to keep the ' +
      'pre-existing unconditional behaviour.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
