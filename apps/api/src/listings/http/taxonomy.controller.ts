/**
 * Destination Taxonomy Controller (#2074, ADR-037)
 *
 * The neutral tree-browse + search surface the model was built for. Until this
 * existed there was NO marketplace tree-browse route at all — only the
 * platform-named `source/categories` on the mappings controller — and `search`,
 * which ADR-037 calls the point of the projection, was unreachable over HTTP.
 *
 * Spans both destination kinds: the service resolves scope from the connection
 * (owner-keyed marketplace, borrower-aware for Erli, connection-keyed shop), so
 * nothing here branches on `platformType`. Deliberately not mounted under
 * `shop-publish` for that reason, and deliberately not reusing the mappings
 * controller's `source` / `destination` words, which name a pairing rather than
 * a destination kind and do not generalise.
 *
 * Reads never touch the live platform — that is the model's defining property.
 *
 * @module apps/api/src/listings/http
 */
import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  DESTINATION_TAXONOMY_SERVICE_TOKEN,
  IDestinationTaxonomyService,
} from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import {
  TaxonomyCategoryResponseDto,
  TaxonomySearchHitResponseDto,
  toPathSegmentDtos,
} from './dto/taxonomy-category-response.dto';
import { TaxonomySearchQueryDto } from './dto/taxonomy-search-query.dto';

@Roles('admin', 'operator', 'viewer')
@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings/connections/:connectionId/taxonomy')
export class TaxonomyController {
  constructor(
    @Inject(DESTINATION_TAXONOMY_SERVICE_TOKEN)
    private readonly taxonomyService: IDestinationTaxonomyService,
  ) {}

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Browse a destination's category tree (projection, never live)",
    description:
      'Returns the direct children of parentId (root level when omitted) from the synced destination-taxonomy projection. Works for marketplace and shop connections alike; scope is resolved from the connection capability. An empty array means the taxonomy has not synced yet, NOT that the destination has no categories.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiQuery({ name: 'parentId', required: false, type: String })
  @ApiResponse({ status: 200, type: [TaxonomyCategoryResponseDto] })
  // Corrected in #2085: 404 / 409 are unreachable on any taxonomy read. Scope
  // resolution probes the destination kind through a swallowing try/catch, so
  // an unknown connection, a disabled one, and a missing browse capability all
  // arrive as the same 422.
  @ApiResponse({
    status: 422,
    description:
      'No taxonomy source could be resolved — the connection does not exist, is disabled, or exposes no category browser',
  })
  async browseCategories(
    @Param('connectionId') connectionId: string,
    @Query('parentId') parentId?: string,
  ): Promise<TaxonomyCategoryResponseDto[]> {
    const categories = await this.taxonomyService.browse(connectionId, parentId);
    return categories.map((category) => TaxonomyCategoryResponseDto.fromDomain(category));
  }

  @Get('categories/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Search a destination's whole category tree",
    description:
      'Substring match across every node in scope, each hit carrying its root-to-leaf breadcrumb. This is what the projection exists for: the pickers can only filter the level they have loaded, so an operator searching from the root otherwise finds nothing and concludes the category does not exist. Diacritic-insensitive.',
  })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [TaxonomySearchHitResponseDto] })
  @ApiResponse({ status: 400, description: 'Query too short' })
  // See the note on `browseCategories` above — 404 / 409 are unreachable here
  // for the same reason.
  @ApiResponse({
    status: 422,
    description:
      'No taxonomy source could be resolved — the connection does not exist, is disabled, or exposes no category browser',
  })
  async searchCategories(
    @Param('connectionId') connectionId: string,
    @Query() query: TaxonomySearchQueryDto,
  ): Promise<TaxonomySearchHitResponseDto[]> {
    const hits = await this.taxonomyService.search(connectionId, query.q, query.limit);
    return hits.map((hit) => ({
      category: TaxonomyCategoryResponseDto.fromDomain(hit.category),
      path: toPathSegmentDtos(hit.path),
    }));
  }
}
