/**
 * Preset Preview Response DTO (#2353)
 *
 * The server-computed before/after diff #2355 generates its confirm sentences
 * from. It is computed here, not in the browser, because a client-side diff
 * would have to reimplement resolution and would drift from it.
 *
 * @module apps/api/src/fulfillment-authority/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { AuthorityQuestionValues } from '@openlinker/core/fulfillment-authority';
import { AuthorityPresetIdValues } from '../application/authority-presets';
import {
  AuthorityAnswerRowDto,
  AuthorityAttentionItemDto,
} from './authority-status-response.dto';

export class AuthorityPresetChangeDto {
  @ApiProperty({ enum: AuthorityQuestionValues })
  question!: string;

  @ApiProperty({ type: AuthorityAnswerRowDto })
  before!: AuthorityAnswerRowDto;

  @ApiProperty({ type: AuthorityAnswerRowDto })
  after!: AuthorityAnswerRowDto;
}

export class PresetPreviewResponseDto {
  @ApiProperty({ enum: AuthorityPresetIdValues })
  presetId!: string;

  @ApiProperty({
    type: [AuthorityPresetChangeDto],
    description:
      'Exactly the rows whose answer changes. Empty is a legitimate answer and is card 1\'s ' +
      'entire content — "nothing changes when you pick this".',
  })
  changes!: AuthorityPresetChangeDto[];

  @ApiProperty({
    type: [AuthorityAttentionItemDto],
    description:
      'The ambiguities the RESULT would carry, each naming the connections to link to. Computed ' +
      'from the resulting resolution rather than from the delta, so an install that is ALREADY ' +
      'ambiguous is reported by every preset including the no-op (story S1-4).',
  })
  resultingAmbiguities!: AuthorityAttentionItemDto[];

  @ApiProperty({
    description:
      'Whether applying would be refused. Shipped rather than left to the client so the dialog ' +
      'and the server cannot disagree about what is savable.',
  })
  blocked!: boolean;
}
