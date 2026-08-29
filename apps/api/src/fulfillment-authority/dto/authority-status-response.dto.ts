/**
 * Authority Status Response DTOs (#2353)
 *
 * The wire shape of the "Who decides what" page. Every field is a CODE, never
 * operator-facing English — copy is owned by #2357 and must pass
 * `check-ui-vocabulary`, which a backend string can never enter.
 *
 * @module apps/api/src/fulfillment-authority/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  AuthorityAttentionBadgeValues,
  AuthorityAttentionOriginValues,
  AuthorityAttentionReasonValues,
  AuthorityAttentionSurfaceValues,
  AuthorityQuestionValues,
  AuthoritySourceValues,
  AuthorityStateValues,
} from '@openlinker/core/fulfillment-authority';
import { AuthorityPresetIdValues } from '../application/authority-presets';

export class AuthorityAnswerRowDto {
  @ApiProperty({ enum: AuthorityQuestionValues })
  question!: string;

  @ApiProperty({
    enum: AuthorityStateValues,
    description:
      'How well resolved the row is. Derived from (source, answer.kind) by one producer — a ' +
      'consumer must render this rather than re-derive it, the #2100 blocksIssuanceElsewhere rule.',
  })
  state!: string;

  @ApiProperty({
    enum: AuthoritySourceValues,
    description:
      'By what authority the answer was reached. This — not a question literal — is what a ' +
      'surface tests to render the "always" (A6) and "elsewhere" (A7) treatments.',
  })
  source!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Discriminated on `kind`: openlinker | holders | manual | default-today | nobody-to-route ' +
      '| cannot-tell | configured-elsewhere. Several holders is a COMPOUND and is routine; only ' +
      '`cannot-tell` is attention-worthy.',
  })
  answer!: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Two arms: { kind: "default", code } carries a why-CODE, { kind: "ambiguous", reason } ' +
      'means the default why-line is REPLACED by the matching inert-state copy (spec §3.3).',
  })
  why!: Record<string, unknown>;

  @ApiProperty({
    type: [String],
    description:
      'Connections claiming this authority that are not active and so were not eligible to hold ' +
      'it. Reported so the page can say "a disabled connection claims this"; never changes the ' +
      'answer or the state.',
  })
  inactiveClaimantConnectionIds!: string[];
}

export class AuthorityAttentionItemDto {
  @ApiProperty({ enum: AuthorityAttentionReasonValues })
  reason!: string;

  @ApiProperty({ enum: AuthorityAttentionBadgeValues })
  badge!: string;

  @ApiProperty({
    enum: AuthorityAttentionSurfaceValues,
    isArray: true,
    description:
      'Every surface this state renders on — NOT where it originates. A1-U originates on a ' +
      'connection and renders on the products whose publishing is paused.',
  })
  surfaces!: string[];

  @ApiProperty({ enum: AuthorityAttentionOriginValues })
  origin!: string;

  @ApiProperty({ enum: AuthorityQuestionValues, nullable: true })
  question!: string | null;

  @ApiProperty({ type: [String], description: 'The connections whose competing claims produced it.' })
  connectionIds!: string[];
}

export class AuthorityAttentionDto {
  @ApiProperty({
    type: [AuthorityAttentionItemDto],
    description: 'Attention-worthy states — counted, toned and filterable (§4.3).',
  })
  counted!: AuthorityAttentionItemDto[];

  @ApiProperty({
    type: [AuthorityAttentionItemDto],
    description:
      'ALWAYS EMPTY TODAY, and correct rather than broken: every member of the union is counted, ' +
      'and §4.3\'s routine states live on the who-decides ROW as a state/source/answer instead. ' +
      'Present so opting a future member out needs no shape change — do not invent a client-side ' +
      'split, which is the two-independent-lists failure §4.3 exists to prevent.',
  })
  routine!: AuthorityAttentionItemDto[];

  @ApiProperty({
    description:
      'Orders carrying at least one counted PERSISTED state. Counts ORDERS, while `counted` ' +
      'counts STATES — a caller wanting one number adds them.',
  })
  affectedOrderCount!: number;
}

export class AuthorityPresetDto {
  @ApiProperty({ enum: AuthorityPresetIdValues })
  id!: string;

  @ApiProperty()
  available!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'A CODE, present iff `available` is false. An unavailable preset is RETURNED rather than ' +
      'omitted so the page can render it disabled-with-a-reason (#2353 AC).',
  })
  unavailableReason!: string | null;
}

export class AuthorityPresetApplyReportDto {
  @ApiProperty({ type: [String] })
  updatedConnectionIds!: string[];

  @ApiProperty({
    type: [String],
    description:
      'Connections whose write failed. The apply is N independent saves and cannot be atomic, so ' +
      'a non-empty list means the arrangement is PARTIALLY applied — re-submitting the same ' +
      'preset converges, because every mutation is idempotent.',
  })
  failedConnectionIds!: string[];
}

export class AuthorityStatusResponseDto {
  @ApiProperty({
    type: [AuthorityAnswerRowDto],
    description:
      'Exactly seven rows in table order, on any install including a zero-config one. Every row ' +
      'carries a concrete answer AND a why — there is no empty state (spec §2.3).',
  })
  rows!: AuthorityAnswerRowDto[];

  @ApiProperty({ type: AuthorityAttentionDto })
  attention!: AuthorityAttentionDto;

  @ApiProperty({ type: [AuthorityPresetDto] })
  presets!: AuthorityPresetDto[];

  @ApiProperty({
    type: AuthorityPresetApplyReportDto,
    required: false,
    description: 'Present only on an apply response; absent on a plain status read.',
  })
  applied?: AuthorityPresetApplyReportDto;
}
