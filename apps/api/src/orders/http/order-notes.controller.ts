/**
 * Order Notes Controller (#3531)
 *
 * Internal, office-facing notes on an order. Writes need `orders:write`
 * (admin + operator) — mirroring `OrdersController`'s pack/hold writes.
 * Reads are the same set: a note's TEXT is exactly the kind of operator
 * commentary a viewer already sees elsewhere on the order (the snapshot,
 * holds), so there is no narrower read-only role to serve here.
 *
 * `packer` is deliberately absent from every route on this controller — the
 * bench reads packer-visible notes through `BenchParcelView` (#2418), never
 * through this register, mirroring `OrdersController`'s own exclusion (#2413).
 *
 * @module apps/api/src/orders/http
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_NOTE_SERVICE_TOKEN,
  OrderNoteNotAuthoredError,
  OrderNoteNotFoundError,
  type IOrderNoteService,
  type OrderNote,
} from '@openlinker/core/orders';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import { UpdateOrderNoteDto } from './dto/update-order-note.dto';
import { OrderNoteResponseDto } from './dto/order-note-response.dto';
import { OrderNoteTimelineEntryResponseDto } from './dto/order-note-timeline-response.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/:internalOrderId/notes')
export class OrderNotesController {
  constructor(
    @Inject(ORDER_NOTE_SERVICE_TOKEN)
    private readonly service: IOrderNoteService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "An order's notes, oldest first." })
  @ApiResponse({ status: 200, type: [OrderNoteResponseDto] })
  async list(@Param('internalOrderId') internalOrderId: string): Promise<OrderNoteResponseDto[]> {
    const notes = await this.service.listForOrder(internalOrderId);
    return notes.map((note) => this.toDto(note));
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('timeline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Activity-timeline-shaped entries (created, edited, flag_changed, deleted) for the ' +
      "order's notes — the FE folds these into the order Activity timeline.",
  })
  @ApiResponse({ status: 200, type: [OrderNoteTimelineEntryResponseDto] })
  async timeline(
    @Param('internalOrderId') internalOrderId: string
  ): Promise<OrderNoteTimelineEntryResponseDto[]> {
    const entries = await this.service.listTimelineForOrder(internalOrderId);
    return entries.map((entry) => ({
      noteId: entry.noteId,
      kind: entry.kind,
      occurredAt: entry.occurredAt.toISOString(),
      actorUsername: entry.actorUsername,
      body: entry.body,
      showToPacker: entry.showToPacker,
    }));
  }

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a note. `showToPacker` widens the text onto the pack bench.' })
  @ApiResponse({ status: 201, type: OrderNoteResponseDto })
  async create(
    @Param('internalOrderId') internalOrderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderNoteDto
  ): Promise<OrderNoteResponseDto> {
    const note = await this.service.create(
      internalOrderId,
      user.id,
      user.username,
      dto.body,
      dto.showToPacker ?? false
    );
    return this.toDto(note);
  }

  @Roles('admin', 'operator')
  @Put(':noteId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Edit a note's text and/or its packer-visibility flag (D33: author only). Records the " +
      'prior text as an Activity-timeline entry rather than discarding it.',
  })
  @ApiResponse({ status: 200, type: OrderNoteResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the note\'s author.' })
  @ApiResponse({ status: 404, description: 'No such note.' })
  async update(
    @Param('noteId') noteId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrderNoteDto
  ): Promise<OrderNoteResponseDto> {
    try {
      const note = await this.service.update(noteId, user.id, user.role === 'admin', {
        body: dto.body,
        showToPacker: dto.showToPacker,
      });
      return this.toDto(note);
    } catch (error) {
      throw this.mapError(error, noteId);
    }
  }

  @Roles('admin', 'operator')
  @Delete(':noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a note (D33: author or admin). Text is cleared, entry stays." })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'Caller is neither the author nor an admin.' })
  @ApiResponse({ status: 404, description: 'No such note.' })
  async delete(
    @Param('noteId') noteId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    try {
      await this.service.delete(noteId, user.id, user.role === 'admin');
    } catch (error) {
      throw this.mapError(error, noteId);
    }
  }

  private mapError(error: unknown, noteId: string): Error {
    if (error instanceof OrderNoteNotFoundError) {
      return new NotFoundException(`Order note not found: ${noteId}`);
    }
    if (error instanceof OrderNoteNotAuthoredError) {
      return new ForbiddenException('Only the note\'s author (or an admin, for delete) may do this.');
    }
    return error as Error;
  }

  private toDto(note: OrderNote): OrderNoteResponseDto {
    return {
      id: note.id,
      internalOrderId: note.internalOrderId,
      authorUserId: note.authorUserId,
      authorUsername: note.authorUsername,
      body: note.body,
      showToPacker: note.showToPacker,
      editedAt: note.editedAt?.toISOString() ?? null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
