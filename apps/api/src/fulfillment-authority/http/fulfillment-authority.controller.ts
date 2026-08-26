/**
 * Fulfillment Authority Controller (#2353)
 *
 * Three reads and one write behind the "Who decides what" page: the seven
 * resolved answers plus the inert states, a server-computed preset diff, and the
 * apply.
 *
 * ## Why preview is a READ despite being a POST
 *
 * It commits nothing — it mutates a copy of the claimant configs in memory,
 * re-resolves and diffs. It is a POST only because its input is a body, and it
 * is authorised as a read because #2355's confirm dialog must render for a
 * read-only role that then cannot save. Gating it on `admin` would leave a
 * non-admin able to see the page but not to see what a preset would do, which is
 * the half of the surface that explains the other half.
 *
 * @module apps/api/src/fulfillment-authority/http
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §3
 */
import { Body, Controller, Get, Inject, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  AUTHORITY_STATUS_SERVICE_TOKEN,
  type IAuthorityStatusService,
} from '../application/interfaces/authority-status.service.interface';
import type {
  AuthorityPresetPreview,
  AuthorityStatusView,
} from '../application/types/authority-status.types';
import { ApplyPresetRequestDto } from '../dto/apply-preset-request.dto';
import { AuthorityStatusResponseDto } from '../dto/authority-status-response.dto';
import { PresetPreviewResponseDto } from '../dto/preset-preview-response.dto';

@ApiBearerAuth()
@ApiTags('fulfillment-authority')
@Controller('fulfillment-authority')
export class FulfillmentAuthorityController {
  constructor(
    @Inject(AUTHORITY_STATUS_SERVICE_TOKEN)
    private readonly authorityStatusService: IAuthorityStatusService
  ) {}

  @Get('status')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'Who decides what, right now',
    description:
      'Seven rows in table order, each with a concrete answer AND a why-code, on any install ' +
      'including a zero-config one — there is no empty state. Plus the inert states split into ' +
      'counted and routine (the routine array is always empty today; see its description), the ' +
      'count of affected orders, and the preset catalogue with each unavailable preset\'s reason. ' +
      'Every operator-facing word is the frontend\'s: this endpoint emits codes only.',
  })
  @ApiResponse({ status: 200, type: AuthorityStatusResponseDto })
  // The DTO classes exist to declare the Swagger schema; the handler returns the
  // domain view itself. Mapping row-by-row would mean re-encoding a discriminated
  // union into `Record<string, unknown>` fields by hand — a second definition of a
  // shape one producer already owns, and the drift #2100's single-producer rule
  // exists to prevent.
  async getStatus(): Promise<AuthorityStatusView> {
    return this.authorityStatusService.getStatus();
  }

  @Post('presets/preview')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'What a preset would change — commits nothing',
    description:
      'Applies the preset to an in-memory COPY of every connection config, re-resolves, and ' +
      'returns the diff plus any ambiguity the result would carry. Nothing is written. ' +
      'Authorised as a READ: the confirm dialog must render for a role that cannot then save.',
  })
  @ApiResponse({ status: 200, type: PresetPreviewResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown or unavailable preset' })
  async previewPreset(
    @Body() body: ApplyPresetRequestDto
  ): Promise<AuthorityPresetPreview> {
    return this.authorityStatusService.previewPreset(body.presetId);
  }

  @Put('presets')
  @Roles('admin')
  @ApiOperation({
    summary: 'Apply a preset',
    description:
      'Writes the preset\'s config changes and returns the resulting status. Refuses with 422 ' +
      'when the RESULT would leave any authority ambiguous, naming the conflicting connections ' +
      'and writing nothing — checked against the resulting resolution rather than the delta, so ' +
      'an install that is already ambiguous is refused by every preset including the no-op. ' +
      'Only affects what happens from now on: work already in progress keeps its arrangement.',
  })
  @ApiResponse({ status: 200, type: AuthorityStatusResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown or unavailable preset' })
  @ApiResponse({ status: 422, description: 'The result would be ambiguous; nothing was changed' })
  async applyPreset(@Body() body: ApplyPresetRequestDto): Promise<AuthorityStatusView> {
    return this.authorityStatusService.applyPreset(body.presetId);
  }
}
