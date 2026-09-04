/**
 * Bench Parcel Controller (#2418, `W3b-5`, spec §§ 2.4–2.5)
 *
 * The three things that happen to one box: it opens, units go into it, and —
 * only when it shut by mistake — it opens again.
 *
 * ## There is no close route, and that is the design
 *
 * Decision D18: *"the parcel closes on the last verification, with no
 * confirmation step."* The close happens inside `verifyUnit`'s own transaction,
 * so a "Done" button on the bench would have nothing to call. Its absence is
 * asserted by `no-parcel-commit-control.spec.ts` rather than left to review, and
 * the mockup states the promise to the packer in as many words: *"This box
 * closes itself the moment the last line is verified. There is nothing here to
 * press."*
 *
 * ## Auth
 *
 * `JwtAuthGuard` is global, so per the house convention no redundant
 * `@UseGuards` appears here. Every route names `packer`, which makes
 * `packer-exclusion.spec.ts` fail until it is recorded in
 * `PACKER_GRANTED_ROUTES` — the second axis that spec exists for.
 *
 * These are the routes #2413's review deliberately left the bench without. It
 * closed `/orders` because `orderSnapshot` carries the buyer's name, email and
 * both un-redacted addresses under the default `OL_STORE_PII=true`. The bench
 * reaches the parcel **through the work** instead, and the projection is an
 * explicit allowlist rather than an order read with fields trimmed.
 *
 * @module apps/api/src/bench/http
 */
import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FulfillmentWorkNotFoundError } from '@openlinker/core/fulfillment';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  BENCH_PARCEL_SERVICE_TOKEN,
  type IBenchParcelService,
} from '../application/interfaces/bench-parcel.service.interface';
import { BenchParcelNotAtThisBenchError } from '../application/services/bench-parcel.service';
import type {
  BenchParcelView,
  BenchReopenResultView,
  BenchVerificationResultView,
} from '../application/types/bench-parcel.types';
import { ReopenParcelDto } from './dto/reopen-parcel.dto';
import { VerifyUnitDto } from './dto/verify-unit.dto';
import {
  BenchParcelResponseDto,
  BenchReopenResultResponseDto,
  BenchVerificationResultResponseDto,
} from './dto/bench-parcel-response.dto';

@ApiBearerAuth()
@ApiTags('bench')
@Controller('bench/work')
export class BenchParcelController {
  constructor(
    @Inject(BENCH_PARCEL_SERVICE_TOKEN)
    private readonly parcels: IBenchParcelService
  ) {}

  @Get(':workId/parcel')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Open one parcel at the bench',
    description:
      'What must go in this box, how far it has got, and whether it may be packed at all. Scoped ' +
      "to work routed to OpenLinker's own packing executor: a parcel belonging to anyone else " +
      'answers 404, because a packer has no business reading another executor’s parcel in order ' +
      'to be told they may not pack it. Carries no address, email, phone or total.',
  })
  @ApiResponse({ status: 200, type: BenchParcelResponseDto })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async getParcel(@Param('workId') workId: string): Promise<BenchParcelResponseDto> {
    return this.toParcelDto(await this.run(() => this.parcels.getParcel(workId)));
  }

  @Post(':workId/verifications')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Verify one unit into the box',
    description:
      'Records one unit against one line — and shuts the box when it was the last, with no ' +
      'confirmation step and no control to press. A scan and a hand-confirm send the IDENTICAL ' +
      'body: the request names a LINE, never a barcode, so the two are recorded the same way by ' +
      'construction. A wrong item, an over-pack and a parcel that must not be packed each record ' +
      'NOTHING and do not consume the gesture id.',
  })
  @ApiResponse({ status: 201, type: BenchVerificationResultResponseDto })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async verifyUnit(
    @Param('workId') workId: string,
    @Body() dto: VerifyUnitDto,
    @CurrentUser() user?: AuthenticatedUser
  ): Promise<BenchVerificationResultResponseDto> {
    const result = await this.run(() =>
      this.parcels.verifyUnit({
        workId,
        workLineId: dto.workLineId,
        gestureId: dto.gestureId,
        // The verified token's user, never the body's — attribution a client
        // could supply is attribution a dispute cannot rest on.
        verifiedByUserId: user?.id ?? null,
      })
    );
    return this.toVerificationDto(result);
  }

  @Post(':workId/reopen')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Reopen a parcel closed by mistake',
    description:
      'Verification resumes from zero and every recorded unit is voided with who and when — a ' +
      'closed box is full by definition, so keeping the counts would simply re-shut it. Refused ' +
      'once the goods have left the building: the box is gone, and reopening it in software is a ' +
      'fiction. A refusal is a 200 carrying its reason, not an error — the packer must be told ' +
      'which of the two it is.',
  })
  @ApiResponse({ status: 201, type: BenchReopenResultResponseDto })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async reopenParcel(
    @Param('workId') workId: string,
    @Body() dto: ReopenParcelDto,
    @CurrentUser() user?: AuthenticatedUser
  ): Promise<BenchReopenResultResponseDto> {
    const result = await this.run(() =>
      this.parcels.reopenParcel({
        workId,
        reopenedByUserId: user?.id ?? null,
        expectedVersion: dto.expectedVersion,
      })
    );
    return this.toReopenDto(result);
  }

  /**
   * "Does not exist" and "is not yours" answer the SAME 404.
   *
   * Deliberate: distinguishing them would let a packer enumerate which work ids
   * exist in an installation by reading the difference between two refusals.
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof FulfillmentWorkNotFoundError ||
        error instanceof BenchParcelNotAtThisBenchError
      ) {
        throw new NotFoundException('No such parcel at this bench');
      }
      throw error;
    }
  }

  /** Field by field, never a spread — see the DTO module docblock. */
  private toParcelDto(view: BenchParcelView): BenchParcelResponseDto {
    return {
      workId: view.workId,
      version: view.version,
      orderReference: view.orderReference,
      buyerName: view.buyerName,
      parcelIndex: view.parcelIndex,
      parcelTotal: view.parcelTotal,
      refusal: view.refusal,
      holdReason: view.holdReason,
      closedAt: view.closedAt,
      packedByUserId: view.packedByUserId,
      lines: view.lines.map((line) => ({
        workLineId: line.workLineId,
        productVariantId: line.productVariantId,
        name: line.name,
        sku: line.sku,
        ean: line.ean,
        gtin: line.gtin,
        requiredQuantity: line.requiredQuantity,
        verifiedQuantity: line.verifiedQuantity,
      })),
    };
  }

  private toVerificationDto(
    result: BenchVerificationResultView
  ): BenchVerificationResultResponseDto {
    return {
      outcome: result.outcome,
      reason: result.reason,
      parcel: this.toParcelDto(result.parcel),
    };
  }

  private toReopenDto(result: BenchReopenResultView): BenchReopenResultResponseDto {
    return {
      outcome: result.outcome,
      reason: result.reason,
      parcel: this.toParcelDto(result.parcel),
    };
  }
}
