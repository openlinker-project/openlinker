/**
 * Saved Views Controller
 *
 * HTTP surface for named list views (#4241):
 *
 *   GET    /saved-views?pageKey=      my personal views + every shared view
 *   POST   /saved-views               create (shared: admin only)
 *   PATCH  /saved-views/:id           update with `expectedRevision` (409 on mismatch)
 *   DELETE /saved-views/:id           delete (shared: admin only)
 *   PUT    /saved-views/default       set my default, or null for the system "All"
 *
 * `@Roles('admin','operator','viewer')` on every route - a packer has no list
 * tables to arrange, and `@AnyRole()` is not used. A VIEWER may create, edit and
 * delete their OWN personal views: a NEW policy, since the orders column presets
 * (`OrderColumnPresetsController`) exclude viewer. It is deliberate - a saved
 * view is a private arrangement of data the viewer can already read, writes
 * nothing shared, and the display-only `saved-views:write` permission mirrors
 * this list. Shared writes stay admin-only, enforced in the service. The admin-only rule for
 * shared views is enforced in the SERVICE (the decorator only admits roles);
 * another user's personal view answers 404 so its existence is not disclosed.
 * Core takes an actor flag, never a role string, so the role-to-flag mapping
 * happens here.
 *
 * @module apps/api/src/saved-views/http
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  InvalidSavedViewError,
  SAVED_VIEWS_SERVICE_TOKEN,
  SavedViewForbiddenError,
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  SavedViewRevisionConflictError,
  type ISavedViewsService,
  type SavedViewActor,
} from '@openlinker/core/saved-views';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import {
  CreateSavedViewDto,
  ListSavedViewsQueryDto,
  SetDefaultSavedViewDto,
  UpdateSavedViewDto,
} from './dto/saved-view-requests.dto';
import { SavedViewResponseDto } from './dto/saved-view-response.dto';

function toActor(user: AuthenticatedUser): SavedViewActor {
  return { userId: user.id, isAdmin: user.role === 'admin' };
}

@ApiBearerAuth()
@ApiTags('saved-views')
@Controller('saved-views')
export class SavedViewsController {
  constructor(
    @Inject(SAVED_VIEWS_SERVICE_TOKEN)
    private readonly savedViews: ISavedViewsService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({
    summary: "The caller's personal views plus every shared view for a page",
  })
  @ApiResponse({ status: 200, type: SavedViewResponseDto, isArray: true })
  async list(
    @Query() query: ListSavedViewsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<SavedViewResponseDto[]> {
    res.setHeader('Cache-Control', 'no-store');
    const views = await this.run(() => this.savedViews.list(toActor(user), query.pageKey));
    return views.map((view) => SavedViewResponseDto.fromReadModel(view));
  }

  @Roles('admin', 'operator', 'viewer')
  @Post()
  @ApiOperation({ summary: 'Create a personal view, or a shared one (admin only)' })
  @ApiResponse({ status: 201, type: SavedViewResponseDto })
  @ApiResponse({ status: 400, description: 'Malformed definition or a limit is exceeded' })
  @ApiResponse({ status: 403, description: 'Shared view by a non-admin' })
  @ApiResponse({ status: 409, description: 'A view with this name exists in the same scope' })
  async create(
    @Body() dto: CreateSavedViewDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<SavedViewResponseDto> {
    const view = await this.run(() =>
      this.savedViews.create(toActor(user), {
        pageKey: dto.pageKey,
        name: dto.name,
        scope: dto.scope,
        definition: dto.definition,
        workspaceDefault: dto.workspaceDefault,
      })
    );
    return SavedViewResponseDto.fromReadModel(view);
  }

  // Declared before the `:id` routes: a literal segment must not be read as an id.
  @Roles('admin', 'operator', 'viewer')
  @Put('default')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set the caller's default view for a page; null selects the system view" })
  @ApiResponse({ status: 204, description: 'Default updated' })
  @ApiResponse({ status: 404, description: 'The view does not exist or is not visible to the caller' })
  async setDefault(
    @Body() dto: SetDefaultSavedViewDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    await this.run(() => this.savedViews.setDefault(toActor(user), dto.pageKey, dto.viewId));
  }

  @Roles('admin', 'operator', 'viewer')
  @Patch(':id')
  @ApiOperation({ summary: 'Rename or re-define a view. Requires the revision the client read.' })
  @ApiResponse({ status: 200, type: SavedViewResponseDto })
  @ApiResponse({ status: 403, description: 'Shared view by a non-admin' })
  @ApiResponse({ status: 404, description: 'No such view, or another user\'s personal view' })
  @ApiResponse({ status: 409, description: 'Stale revision, or the name is taken' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedViewDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<SavedViewResponseDto> {
    const view = await this.run(() =>
      this.savedViews.update(toActor(user), id, {
        name: dto.name,
        definition: dto.definition,
        workspaceDefault: dto.workspaceDefault,
        expectedRevision: dto.expectedRevision,
      })
    );
    return SavedViewResponseDto.fromReadModel(view);
  }

  @Roles('admin', 'operator', 'viewer')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a view (shared: admin only)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 403, description: 'Shared view by a non-admin' })
  @ApiResponse({ status: 404, description: 'No such view, or another user\'s personal view' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    await this.run(() => this.savedViews.remove(toActor(user), id));
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof SavedViewNotFoundError) {
        throw codedHttpError(HttpStatus.NOT_FOUND, 'SAVED_VIEW_NOT_FOUND', error.message, {
          viewId: error.viewId,
        });
      }
      if (error instanceof SavedViewForbiddenError) {
        throw codedHttpError(HttpStatus.FORBIDDEN, 'SAVED_VIEW_FORBIDDEN', error.message);
      }
      if (error instanceof SavedViewNameTakenError) {
        throw codedHttpError(HttpStatus.CONFLICT, 'SAVED_VIEW_NAME_TAKEN', error.message, {
          pageKey: error.pageKey,
        });
      }
      if (error instanceof SavedViewRevisionConflictError) {
        throw codedHttpError(HttpStatus.CONFLICT, 'SAVED_VIEW_REVISION_CONFLICT', error.message, {
          viewId: error.viewId,
        });
      }
      if (error instanceof InvalidSavedViewError) {
        throw codedHttpError(HttpStatus.BAD_REQUEST, 'SAVED_VIEW_INVALID', error.message, {
          field: error.field,
          rule: error.rule,
          message: error.message,
          ...(error.limit !== undefined ? { limit: error.limit } : {}),
        });
      }
      throw error;
    }
  }
}
