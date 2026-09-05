/**
 * Description Format Controller (ADR-046)
 *
 * One read: what the destination behind this connection accepts in a product
 * description. The frontend composes its rich-text editor from the answer - which
 * marks exist, which heading levels, whether a link control renders, which tag
 * bold serialises to, the byte cap - which is what keeps destination knowledge
 * out of `apps/web` entirely.
 *
 * Destination-kind-agnostic, like `TaxonomyController` and for the same reason:
 * the service probes which capability declares the format, so nothing here
 * branches on `platformType`. Mounted as a sibling rather than under
 * `shop-publish` because a marketplace connection needs it too.
 *
 * Never touches the live platform - `getDescriptionFormat()` is a pure adapter
 * declaration.
 *
 * @module apps/api/src/listings/http
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  DESCRIPTION_FORMAT_READ_SERVICE_TOKEN,
  type IDescriptionFormatReadService,
} from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { DescriptionFormatResponseDto } from './dto/description-format-response.dto';

@ApiBearerAuth()
@ApiTags('listings')
// Declared explicitly, matching `TaxonomyController`. Since #2079 `RolesGuard`
// DENIES a route carrying no decorator, so this is required, not decorative. Any
// authenticated user when the decorator is absent, so omitting it is fail-open
// on role even where the effective audience happens to be the same set.
@Roles('admin', 'operator', 'viewer')
@Controller('listings/connections/:connectionId')
export class DescriptionFormatController {
  constructor(
    @Inject(DESCRIPTION_FORMAT_READ_SERVICE_TOKEN)
    private readonly descriptionFormat: IDescriptionFormatReadService,
  ) {}

  @Get('description-format')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Read what this destination accepts in a product description",
    description:
      'Returns the destination-declared DescriptionFormat (ADR-046). Always returns a usable format: when the destination declares none - or when no publishing capability resolves at all, e.g. a disabled connection - `declared` is false and the conservative fallback is returned, which the UI must surface rather than presenting as authoritative. Never fails for an unknown connection, because an editor has nothing to do with that error.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: DescriptionFormatResponseDto })
  async getDescriptionFormat(
    @Param('connectionId') connectionId: string,
  ): Promise<DescriptionFormatResponseDto> {
    const view = await this.descriptionFormat.getForConnection(connectionId);
    return DescriptionFormatResponseDto.fromDomain(view);
  }
}
