/**
 * Sales-Document Settings Controller (#3941)
 *
 * The OpenLinker-wide sales-document settings, today the gift form on
 * documents (the lowest of three levels: the gift, the connection, this
 * default; gifts spec section 8.3). Reading is open to operators and viewers
 * because the connection tab and the order view name this default as the source
 * of a gift's form; writing is admin-only.
 *
 * @module apps/api/src/sales-documents/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  InvalidGiftDocumentFormError,
  readZeroValueLineSupport,
  SALES_DOCUMENT_SETTINGS_SERVICE_TOKEN,
  type ISalesDocumentSettingsService,
} from '@openlinker/core/sales-documents';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  SalesDocumentProvidersResponseDto,
  SalesDocumentSettingsResponseDto,
  SetSalesDocumentSettingsDto,
} from './dto/sales-document-settings.dto';

@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents/settings')
export class SalesDocumentSettingsController {
  constructor(
    @Inject(SALES_DOCUMENT_SETTINGS_SERVICE_TOKEN)
    private readonly settings: ISalesDocumentSettingsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({ summary: 'Read the OpenLinker-wide sales-document settings' })
  @ApiResponse({ status: 200, type: SalesDocumentSettingsResponseDto })
  async get(): Promise<SalesDocumentSettingsResponseDto> {
    return SalesDocumentSettingsResponseDto.fromSetting(await this.settings.getGiftDocumentForm());
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('document-providers')
  @ApiOperation({
    summary: 'What each document provider declares about a 0.00 line',
    description:
      'Drives which gift forms are offered: "shown at 0.00" is offered only where a provider declares ' +
      'it accepts a zero line. A fiscal receipt always reads false. A provider that cannot be resolved ' +
      'is left out rather than failing the read.',
  })
  @ApiResponse({ status: 200, type: SalesDocumentProvidersResponseDto })
  async documentProviders(): Promise<SalesDocumentProvidersResponseDto> {
    const [invoicing, fiscal] = await Promise.all([
      this.integrations.listCapabilityAdapters<unknown>({ capability: 'Invoicing' }).catch(() => []),
      this.integrations
        .listCapabilityAdapters<unknown>({ capability: 'Fiscalization', lazy: true })
        .catch(() => []),
    ]);
    return {
      providers: [
        ...invoicing.map((entry) => ({
          connectionId: entry.connectionId,
          name: entry.connection.name,
          platformType: entry.connection.platformType,
          kind: 'invoice' as const,
          acceptsZeroValueLine: readZeroValueLineSupport(entry.adapter) ?? null,
        })),
        ...fiscal.map((entry) => ({
          connectionId: entry.connectionId,
          name: entry.connection.name,
          platformType: entry.connection.platformType,
          kind: 'fiscal-receipt' as const,
          acceptsZeroValueLine: false,
        })),
      ],
    };
  }

  @Roles('admin')
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save the OpenLinker-wide gift form on documents' })
  @ApiResponse({ status: 200, type: SalesDocumentSettingsResponseDto })
  @ApiResponse({ status: 400, description: 'Not one of the offered gift forms' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async set(
    @Body() dto: SetSalesDocumentSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SalesDocumentSettingsResponseDto> {
    try {
      return SalesDocumentSettingsResponseDto.fromSetting(
        await this.settings.setGiftDocumentForm(
          dto.giftDocumentForm,
          user?.id ?? null,
          dto.giftDocumentUnitPrice ?? null,
        ),
      );
    } catch (error) {
      if (error instanceof InvalidGiftDocumentFormError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
