/**
 * Source Change Taken Out DTO (#3961)
 *
 * "Done, I took it out": names the parcel line whose extra units the packer
 * took back out of a box the shop lowered.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SourceChangeTakenOutDto {
  @ApiProperty({ description: 'Which line of this parcel the extra units belonged to' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  workLineId!: string;
}
