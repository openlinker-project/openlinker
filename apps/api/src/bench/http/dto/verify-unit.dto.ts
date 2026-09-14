/**
 * Verify-one-unit request (#2418, `W3b-5`, spec § 2.5)
 *
 * ## This body is decision D20
 *
 * It names a LINE, and there is no field for a barcode, a source, or how the
 * unit was confirmed. A scan and a hand-confirm therefore send the IDENTICAL
 * request — recording them differently is not something the server declines to
 * do, it is something the wire cannot express.
 *
 * The scanned value is resolved to a line in the browser, against the barcodes
 * this parcel's own read already returned, and never sent. That is also why a
 * wrong item (story E2) needs no request at all: nothing was scanned that
 * belongs in this box, so there is nothing to record and no round trip to make.
 * What the request DOES differ in between the two paths is nothing, and no
 * access log or audit records which control the packer touched — stated so the
 * next reader does not assume the boundary is covered by the same guard the
 * column list is.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyUnitDto {
  @ApiProperty({ description: 'Which line of this parcel the unit belongs to' })
  @IsString()
  @IsNotEmpty()
  workLineId!: string;

  @ApiProperty({
    description:
      'One physical gesture, identified by the browser and made durable before the request is sent. A retry carries the SAME id and is a no-op; a genuinely second unit carries a different one and is recorded as a second unit.',
  })
  @IsString()
  @IsNotEmpty()
  // Bounded because it reaches a `text` column and an unbounded client-supplied
  // string on a write path is a write path with no upper size.
  @MaxLength(128)
  gestureId!: string;
}
