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
  UnauthorizedException,
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
import {
  BENCH_PRESENCE_SERVICE_TOKEN,
  type IBenchPresenceService,
} from '../application/interfaces/bench-presence.service.interface';
import { BenchParcelNotAtThisBenchError } from '../application/services/bench-parcel.service';
import type {
  BenchActivityEntryView,
  BenchClaimResultView,
  BenchParcelView,
  BenchReopenResultView,
  BenchUndoResultView,
  BenchVerificationResultView,
} from '../application/types/bench-parcel.types';
import { ReopenParcelDto } from './dto/reopen-parcel.dto';
import { VerifyUnitDto } from './dto/verify-unit.dto';
import { toParcelResponseDto } from './dto/bench-parcel.mapper';
import {
  BenchActivityEntryResponseDto,
  BenchClaimResultResponseDto,
  BenchParcelResponseDto,
  BenchPresenceResponseDto,
  BenchReopenResultResponseDto,
  BenchUndoResultResponseDto,
  BenchVerificationResultResponseDto,
} from './dto/bench-parcel-response.dto';

@ApiBearerAuth()
@ApiTags('bench')
@Controller('bench/work')
export class BenchParcelController {
  constructor(
    @Inject(BENCH_PARCEL_SERVICE_TOKEN)
    private readonly parcels: IBenchParcelService,
    @Inject(BENCH_PRESENCE_SERVICE_TOKEN)
    private readonly presence: IBenchPresenceService
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
  @ApiResponse({ status: 401, description: 'A verification must name the packer' })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async verifyUnit(
    @Param('workId') workId: string,
    @Body() dto: VerifyUnitDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BenchVerificationResultResponseDto> {
    // #2890 F1. This verification may CLOSE the parcel, and the close records
    // who packed it — so this is the one route on the bench that must not be
    // able to proceed without a principal. It previously read
    // `user?.id ?? null`, which made a closed, unattributed parcel reachable
    // through the shipped route with nothing but `RolesGuard` in the way; an
    // authorization guard is not a data-integrity constraint.
    //
    // The guard does in fact make this unreachable, so the refusal is
    // defence-in-depth and deliberately NOT covered by a test — a spec would
    // have to hand-build a principal-less request the guard forbids and call
    // that coverage. What IS covered is the type: `verifiedByUserId` is a
    // non-nullable `string`, so nothing can reach the service without one.
    //
    // The `?.` reads redundant against the parameter's type and is not: the
    // decorator returns `request.user` unchecked, so the TYPE is an assertion
    // about the guard rather than about the request. Do not delete it.
    if (!user?.id) {
      throw new UnauthorizedException('A verification must name the packer');
    }

    const result = await this.run(() =>
      this.parcels.verifyUnit({
        workId,
        workLineId: dto.workLineId,
        gestureId: dto.gestureId,
        // The verified token's user, never the body's — attribution a client
        // could supply is attribution a dispute cannot rest on.
        verifiedByUserId: user.id,
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
  // `@CurrentUser()` stays OPTIONAL here, unlike `verifyUnit`, and the
  // asymmetry is deliberate: a reopen CLEARS both actor columns rather than
  // writing one, so an absent principal cannot produce the unattributed-close
  // state #2890 closed. Its own audit is `voidedByUserId` on the verification
  // rows, which is a different fact with a different guarantee.
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

  @Post(':workId/claim')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Claim this parcel',
    description:
      'A packer self-assigns a specific, chosen parcel. Can only ever assign to the CALLER — ' +
      "distinct from PATCH :workId/assignment, a supervisor's staffing decision able to name " +
      "anyone. Refused exactly as a scan at this parcel would refuse, plus the ADR-074 lock " +
      '(a parcel locked to a different packer).',
  })
  @ApiResponse({ status: 201, type: BenchClaimResultResponseDto })
  @ApiResponse({ status: 401, description: 'A claim must name the packer' })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async claimParcel(
    @Param('workId') workId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BenchClaimResultResponseDto> {
    if (!user?.id) {
      throw new UnauthorizedException('A claim must name the packer');
    }
    const result = await this.run(() => this.parcels.claimParcel(workId, user.id));
    return this.toClaimDto(result);
  }

  @Get(':workId/activity')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Recent activity for this parcel',
    description:
      "The verification ledger, projected with each line's product name and newest first — " +
      "e.g. \"Linen tea towel — verified\". A voided row surfaces as TWO entries, one for the " +
      'original verify and one for the later undo, in their own chronological places.',
  })
  @ApiResponse({ status: 200, type: [BenchActivityEntryResponseDto] })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async getActivity(@Param('workId') workId: string): Promise<BenchActivityEntryResponseDto[]> {
    const entries = await this.run(() => this.parcels.listActivity(workId));
    return entries.map((entry) => this.toActivityDto(entry));
  }

  @Post(':workId/verifications/undo')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Undo the single most recent scan',
    description:
      'A lighter correction than reopen: voids the last active verification on an OPEN parcel, ' +
      'offered inline beside the line a packer just scanned. Refused `parcel-closed` rather than ' +
      'reopening the box as a side effect — a closed parcel must go through the full reopen ' +
      'ceremony, which is the only place a reopen is ever recorded as having happened.',
  })
  @ApiResponse({ status: 201, type: BenchUndoResultResponseDto })
  @ApiResponse({ status: 401, description: 'An undo must name the packer' })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async undoLastScan(
    @Param('workId') workId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BenchUndoResultResponseDto> {
    // Same discipline as `verifyUnit` (#2890 F1): an undo records who reversed
    // the scan, so it must not be reachable without a principal.
    if (!user?.id) {
      throw new UnauthorizedException('An undo must name the packer');
    }

    const result = await this.run(() =>
      this.parcels.undoLastScan({ workId, actorUserId: user.id })
    );
    return this.toUndoDto(result);
  }

  @Post(':workId/presence')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Announce presence on this parcel, and learn who else has it open',
    description:
      'A lightweight, ephemeral Redis TTL signal — advisory only, never a lock. Call it on open ' +
      'and refresh it while the parcel view stays mounted. Scoped exactly as `getParcel` scopes ' +
      "it, so a packer cannot ping a work id outside this bench's own eligibility to learn who " +
      'else is looking at it. Answers with MASKED names only, never a user id, and never the ' +
      'caller themselves.',
  })
  @ApiResponse({ status: 201, type: BenchPresenceResponseDto })
  @ApiResponse({ status: 401, description: 'A presence ping must name the packer' })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async pingPresence(
    @Param('workId') workId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BenchPresenceResponseDto> {
    if (!user?.id) {
      throw new UnauthorizedException('A presence ping must name the packer');
    }
    // Scoping check only — the result is discarded. Presence must never be
    // readable for a work id outside this bench's own eligibility, exactly as
    // `getParcel` refuses one.
    await this.run(() => this.parcels.getWorkForDocuments(workId));
    // The VERIFIED token's username, never a body field — this is the name a
    // colleague will read as "who is in this box with me", and the same rule
    // `verifyUnit` states for attribution applies: a name a client could
    // supply is a name a client could forge. `username` is the only display
    // name the users context holds (there is no first/last split), and the
    // service masks it before storing it.
    const view = await this.presence.ping(workId, user.id, user.username ?? user.id);
    // Field by field, never a spread — see the DTO module docblock. A spread
    // here would silently publish whatever the view type grows next, which on
    // this particular projection means whatever it grows about a colleague.
    return {
      collision: view.collision,
      others: view.others.map((viewer) => ({ displayName: viewer.displayName })),
    };
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
    return toParcelResponseDto(view);
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

  private toClaimDto(result: BenchClaimResultView): BenchClaimResultResponseDto {
    return {
      outcome: result.outcome,
      reason: result.reason,
      parcel: this.toParcelDto(result.parcel),
    };
  }

  private toActivityDto(entry: BenchActivityEntryView): BenchActivityEntryResponseDto {
    return {
      workLineId: entry.workLineId,
      name: entry.name,
      kind: entry.kind,
      at: entry.at,
      byUserId: entry.byUserId,
    };
  }

  private toUndoDto(result: BenchUndoResultView): BenchUndoResultResponseDto {
    return {
      outcome: result.outcome,
      reason: result.reason,
      workLineId: result.workLineId,
      parcel: this.toParcelDto(result.parcel),
    };
  }
}
