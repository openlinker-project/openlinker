/**
 * Connection Payment Methods Controller (#3774)
 *
 * Discovery read for the operator's payment-method map: which native payment
 * identifiers a connection's recent orders carried and how each is classified.
 * Read-only; a payment gateway id is a technical name, not buyer data.
 *
 * @module apps/api/src/orders/http
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CONNECTION_PAYMENT_METHODS_SERVICE_TOKEN,
  type IConnectionPaymentMethodsService,
} from '../application/interfaces/connection-payment-methods.service.interface';
import {
  ConnectionPaymentMethodsResponseDto,
  toConnectionPaymentMethodsDto,
} from './dto/connection-payment-methods-response.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('connections/:connectionId/payment-methods')
export class ConnectionPaymentMethodsController {
  constructor(
    @Inject(CONNECTION_PAYMENT_METHODS_SERVICE_TOKEN)
    private readonly service: IConnectionPaymentMethodsService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('observed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Payment identifiers a connection's recent orders carried, and how each is classified.",
  })
  @ApiResponse({ status: 200, type: ConnectionPaymentMethodsResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown connection.' })
  async listObserved(
    @Param('connectionId', ParseUUIDPipe) connectionId: string
  ): Promise<ConnectionPaymentMethodsResponseDto> {
    return toConnectionPaymentMethodsDto(await this.service.listObserved(connectionId));
  }
}
