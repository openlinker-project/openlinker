/**
 * Complete-a-parcel request (pack-bench completion)
 *
 * `expectedVersion` is REQUIRED, unlike `ReopenParcelDto`'s optional one — a
 * completion is the terminal act on this parcel, and there is no unguarded path
 * to it: a client always holds a version from the parcel it is looking at.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CompleteParcelDto {
  @ApiProperty({
    description:
      'The optimistic token from the parcel read. A mismatch answers a version-conflict refusal ' +
      'with nothing written, so a client re-reads the parcel and retries against the fresh state.',
  })
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
