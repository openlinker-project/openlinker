/**
 * Bench Label Controller (#3654)
 *
 * `POST bench/work/:workId/label/replace` - the one place a packer may cause a
 * label to be bought, and only as the replacement of the label already on this
 * box.
 *
 * ## Why `packer` may call it (ADR-071: no new principal)
 *
 * Narrower than any `/shipments/*` route it replaces the need for:
 * - the body is parcel data only (global `ValidationPipe`: whitelist +
 *   forbidNonWhitelisted, so an address or shipment id is a 400);
 * - the recipient is derived server-side from the order, like auto-dispatch;
 * - the route is work-scoped and takes no shipment id;
 * - it cannot issue an invoice or fiscal document (`bench-never-issues.spec.ts`).
 *
 * Status mapping: 404 = not a parcel of this bench / no shipment on it;
 * 409 = a named refusal with nothing changed; 201 = `replaced` or
 * `cancelled-not-replaced` (the old label IS void; the body says so).
 *
 * @module apps/api/src/bench/http
 */
import {
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FulfillmentWorkNotFoundError } from '@openlinker/core/fulfillment';

import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  BENCH_LABEL_SERVICE_TOKEN,
  type IBenchLabelService,
} from '../application/interfaces/bench-label.service.interface';
import { BenchLabelShipmentNotFoundError } from '../application/services/bench-label.service';
import { BenchParcelNotAtThisBenchError } from '../application/services/bench-parcel.service';
import { BenchReplaceLabelResponseDto } from './dto/bench-documents-response.dto';
import { ReplaceLabelDto, toReplaceLabelParcel } from './dto/replace-label.dto';

@ApiBearerAuth()
@ApiTags('bench')
@Controller('bench')
export class BenchLabelController {
  constructor(
    @Inject(BENCH_LABEL_SERVICE_TOKEN) private readonly labels: IBenchLabelService
  ) {}

  @Post('work/:workId/label/replace')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Replace the label on this box',
    description:
      'Voids the work’s current label and buys a new one with the given parcel data. The ' +
      'recipient is never sent; it is derived from the order. Refused 409 (reason in body, ' +
      'nothing changed): cannot-cancel, already-handed-over, parcel-completed, no-label, ' +
      'recipient-unavailable, parcel-size-unknown, replace-in-progress. A re-buy that fails ' +
      'after the void answers 201 `cancelled-not-replaced`.',
  })
  @ApiResponse({ status: 201, type: BenchReplaceLabelResponseDto })
  @ApiResponse({ status: 400, description: 'Body is not exactly one parcel shape' })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench, or it has no shipment' })
  @ApiResponse({ status: 409, description: 'Refused; body carries `reason`' })
  async replaceLabel(
    @Param('workId') workId: string,
    @Body() dto: ReplaceLabelDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BenchReplaceLabelResponseDto> {
    // Records who replaced a paid label; unreachable without a principal (#2890 F1).
    if (!user?.id) {
      throw new UnauthorizedException('A label replacement must name the packer');
    }
    const parcel = toReplaceLabelParcel(dto);

    let result;
    try {
      result = await this.labels.replaceLabel({ workId, parcel, actorUserId: user.id });
    } catch (error) {
      if (
        error instanceof FulfillmentWorkNotFoundError ||
        error instanceof BenchParcelNotAtThisBenchError ||
        error instanceof BenchLabelShipmentNotFoundError
      ) {
        throw new NotFoundException('No such parcel at this bench');
      }
      throw error;
    }

    if (result.outcome === 'refused') {
      throw new ConflictException({ reason: result.reason, message: result.reason });
    }
    return {
      outcome: result.outcome,
      cancelledShipmentId: result.cancelledShipmentId,
      newShipmentId: result.outcome === 'replaced' ? result.newShipmentId : null,
      cancelledAfterDispatch: result.cancelledAfterDispatch,
    };
  }
}
