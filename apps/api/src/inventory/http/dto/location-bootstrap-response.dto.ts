/**
 * Location Bootstrap Response DTO
 *
 * What a first-run bootstrap did (#2407). Reports what was minted and what was
 * already there, so a re-run is visibly a no-op rather than an indistinguishable
 * success.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { LocationResponseDto } from './location-response.dto';

export class LocationBootstrapResponseDto {
  @ApiProperty({
    type: [LocationResponseDto],
    description: 'Locations this call created. Empty on every run after the first.',
  })
  created!: LocationResponseDto[];

  @ApiProperty({
    type: [String],
    example: ['MAIN'],
    description:
      'Codes that already existed, so this call left them untouched. Codes rather than ' +
      'full rows: there is no code-keyed read, and the only prefix-matching substitute ' +
      'would resolve the wrong row for a code like MAIN when MAIN-2 also exists.',
  })
  existingCodes!: string[];
}
