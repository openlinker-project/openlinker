/**
 * Return Actions Controller
 *
 * The operator surface for the ONE return write OpenLinker performs (#2333):
 * ask the source to decline a customer return's refund.
 *
 * Deliberately an ACTIONS controller rather than a general `/returns` resource:
 * the returns READ API is #2334's, shipping concurrently, and a separate file
 * with a separate class name lets the two merge textually rather than
 * semantically.
 *
 * The three domain refusals are mapped by the global
 * `ReturnsExceptionFilter` (404 / 409 / 400), not caught here — the repo
 * convention for a domain exception, and what keeps a second caller of the same
 * service from answering 500 for a state this one explains.
 *
 * @module apps/api/src/returns/http
 */
import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  RETURN_DECLINE_SERVICE_TOKEN,
  type DeclineReturnResult,
  type IReturnDeclineService,
} from '@openlinker/core/returns';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  DeclineReturnDto,
  DeclineReturnResponseDto,
} from '../dto/decline-return.dto';

@ApiBearerAuth()
@ApiTags('returns')
@Controller('returns')
export class ReturnActionsController {
  constructor(
    @Inject(RETURN_DECLINE_SERVICE_TOKEN)
    private readonly declineService: IReturnDeclineService
  ) {}

  @Post(':returnId/decline')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: "Ask the return's source to decline its refund",
    description:
      'OpenLinker proposes, the source disposes, OpenLinker confirms from observation (ADR-044). ' +
      'The proposal is persisted before the request is sent, so a double-call reuses it rather ' +
      'than sending twice. `declinedAt` is stamped only from the source\'s own reported instant — ' +
      'a 2xx alone never means "declined by the source". ' +
      'Refused for an orphan return (409) and for a source that declares no decline support (400).',
  })
  @ApiResponse({ status: 201, type: DeclineReturnResponseDto })
  @ApiResponse({ status: 400, description: 'The source declares no decline support' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  @ApiResponse({ status: 409, description: 'The return is an orphan — not attributed to an order' })
  async decline(
    @Param('returnId') returnId: string,
    @Body() dto: DeclineReturnDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<DeclineReturnResponseDto> {
    const result = await this.declineService.decline({
      returnId,
      reasonCode: dto.reasonCode,
      comment: dto.comment ?? null,
      // The actor is taken from the verified token, never from the body — a
      // body-supplied `requestedBy` would let a caller attribute their own
      // action to someone else in the audit trail this record exists to be.
      requestedBy: user.id,
    });

    return this.toResponseDto(result);
  }

  private toResponseDto(result: DeclineReturnResult): DeclineReturnResponseDto {
    const dto = new DeclineReturnResponseDto();
    dto.outcome = result.outcome;
    dto.changeId = result.changeId;
    dto.declinedAt = result.declinedAt ? result.declinedAt.toISOString() : null;
    dto.refusalReason = result.refusalReason;
    return dto;
  }
}
