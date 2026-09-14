/**
 * Adapter Controller
 *
 * HTTP REST API endpoints for adapter discovery. Provides information about
 * available adapters and their supported capabilities. Useful for UI/admin
 * panels to validate supported capabilities and available adapter keys.
 *
 * @module apps/api/src/integrations/http
 *
 * **`@Roles('admin', 'operator', 'viewer')`, not `@AnyRole()` (#2413).** The
 * adapter inventory is integration configuration; the `packer` role has no
 * business in it. Behaviourally identical for every role that exists today.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import { AdapterRegistryPort, ADAPTER_REGISTRY_TOKEN } from '@openlinker/core/integrations';
import { Roles } from '../../auth/decorators/roles.decorator';

@ApiBearerAuth()
@ApiTags('adapters')
@Controller('adapters')
export class AdapterController {
  constructor(
    @Inject(ADAPTER_REGISTRY_TOKEN)
    private readonly adapterRegistry: AdapterRegistryPort
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({ summary: 'List all available adapters' })
  @ApiResponse({
    status: 200,
    description: 'List of all adapters with their metadata',
    type: [Object],
  })
  async listAdapters(): Promise<AdapterMetadata[]> {
    return await this.adapterRegistry.listAdapters();
  }
}
