/**
 * Adapter Controller
 *
 * HTTP REST API endpoints for adapter discovery. Provides information about
 * available adapters and their supported capabilities. Useful for UI/admin
 * panels to validate supported capabilities and available adapter keys.
 *
 * @module apps/api/src/integrations/http
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdapterRegistryPort, ADAPTER_REGISTRY_TOKEN, AdapterMetadata } from '@openlinker/core/integrations';

@ApiBearerAuth()
@ApiTags('adapters')
@Controller('adapters')
export class AdapterController {
  constructor(
    @Inject(ADAPTER_REGISTRY_TOKEN)
    private readonly adapterRegistry: AdapterRegistryPort,
  ) {}

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

