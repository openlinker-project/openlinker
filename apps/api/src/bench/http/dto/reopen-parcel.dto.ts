/**
 * Reopen-a-parcel request (#2418, `W3b-5`, story E6)
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ReopenParcelDto {
  @ApiPropertyOptional({
    description:
      'The optimistic token from the parcel read. Optional so a client that has not held one can still correct a mistake, but supplying it is what stops a reopen issued against a view the work has since moved out from under — story D21’s scenario. A mismatch is refused with nothing written.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
