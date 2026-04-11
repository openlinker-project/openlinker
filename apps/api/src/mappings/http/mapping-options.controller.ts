/**
 * Mapping Options Controller
 *
 * Helper endpoints that return available option values for FE dropdowns.
 * For MVP, all lists are hardcoded with well-known Allegro and PrestaShop values.
 * Live platform calls (fetching actual PS order states, carriers) are deferred to a follow-up.
 *
 * @module apps/api/src/mappings/http
 */

import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MappingOptionResponseDto } from './dto/mapping-option-response.dto';

/**
 * Well-known Allegro order/payment statuses.
 * Source: Allegro REST API documentation — CheckoutForm.status and payment.type values.
 */
const ALLEGRO_ORDER_STATUSES: MappingOptionResponseDto[] = [
  { value: 'BOUGHT', label: 'Bought (checkout started)' },
  { value: 'FILLED_IN', label: 'Filled in (buyer data provided)' },
  { value: 'READY_FOR_PROCESSING', label: 'Ready for processing' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * Well-known Allegro delivery method IDs.
 * Source: Allegro REST API — /sale/delivery-methods endpoint values.
 */
const ALLEGRO_DELIVERY_METHODS: MappingOptionResponseDto[] = [
  { value: 'INPOST_PACZKOMAT', label: 'InPost Paczkomat' },
  { value: 'INPOST_KURIER', label: 'InPost Kurier' },
  { value: 'DPD', label: 'DPD' },
  { value: 'DHL', label: 'DHL' },
  { value: 'UPS', label: 'UPS' },
  { value: 'POCZTEX', label: 'Pocztex' },
  { value: 'GLS', label: 'GLS' },
  { value: 'FEDEX', label: 'FedEx' },
  { value: 'PICKUP', label: 'Personal pickup' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * Well-known Allegro payment provider names.
 * Source: Allegro REST API — CheckoutForm.payment.type values.
 */
const ALLEGRO_PAYMENT_PROVIDERS: MappingOptionResponseDto[] = [
  { value: 'P24', label: 'Przelewy24' },
  { value: 'CARD', label: 'Card payment' },
  { value: 'BLIK', label: 'BLIK' },
  { value: 'WIRE_TRANSFER', label: 'Wire transfer' },
  { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery' },
  { value: 'INSTALLMENTS', label: 'Installments' },
  { value: 'SPLIT_PAYMENT', label: 'Split payment' },
];

/**
 * Common PrestaShop default order status IDs and labels.
 * Values correspond to PrestaShop's built-in order_state IDs (1–12).
 * Merchants with custom statuses should extend their mapping via the PS admin panel.
 */
const PRESTASHOP_ORDER_STATUSES: MappingOptionResponseDto[] = [
  { value: '1', label: 'Awaiting check payment' },
  { value: '2', label: 'Payment accepted' },
  { value: '3', label: 'Processing in progress' },
  { value: '4', label: 'Shipped' },
  { value: '5', label: 'Delivered' },
  { value: '6', label: 'Cancelled' },
  { value: '7', label: 'Refunded' },
  { value: '8', label: 'Payment error' },
  { value: '9', label: 'On backorder (paid)' },
  { value: '10', label: 'Awaiting bank wire payment' },
  { value: '11', label: 'Remote payment accepted' },
  { value: '12', label: 'On backorder (not paid)' },
];

/**
 * Common PrestaShop default carrier IDs and labels.
 * Merchants should configure carrier IDs matching their PS installation.
 */
const PRESTASHOP_CARRIERS: MappingOptionResponseDto[] = [
  { value: '1', label: 'My carrier' },
  { value: '2', label: 'My cheap carrier' },
];

/**
 * Common PrestaShop payment module names.
 * Corresponds to the `module_name` field on PS orders.
 */
const PRESTASHOP_PAYMENT_MODULES: MappingOptionResponseDto[] = [
  { value: 'ps_wirepayment', label: 'Wire payment (ps_wirepayment)' },
  { value: 'ps_checkpayment', label: 'Check payment (ps_checkpayment)' },
  { value: 'ps_cashondelivery', label: 'Cash on delivery (ps_cashondelivery)' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'przelewy24', label: 'Przelewy24' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'dotpay', label: 'Dotpay' },
  { value: 'payu', label: 'PayU' },
];

@Roles('admin')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId')
export class MappingOptionsController {
  // ── Allegro options ───────────────────────────────────────────────────────

  @Get('allegro/order-statuses')
  @ApiOperation({ summary: 'List available Allegro order status values' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  getAllegroOrderStatuses(
    @Param('connectionId') _connectionId: string,
  ): MappingOptionResponseDto[] {
    return ALLEGRO_ORDER_STATUSES;
  }

  @Get('allegro/delivery-methods')
  @ApiOperation({ summary: 'List available Allegro delivery method IDs' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  getAllegroDeliveryMethods(
    @Param('connectionId') _connectionId: string,
  ): MappingOptionResponseDto[] {
    return ALLEGRO_DELIVERY_METHODS;
  }

  @Get('allegro/payment-providers')
  @ApiOperation({ summary: 'List available Allegro payment provider names' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  getAllegroPaymentProviders(
    @Param('connectionId') _connectionId: string,
  ): MappingOptionResponseDto[] {
    return ALLEGRO_PAYMENT_PROVIDERS;
  }

  // ── PrestaShop options ────────────────────────────────────────────────────

  @Get('prestashop/order-statuses')
  @ApiOperation({ summary: 'List available PrestaShop order status IDs' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  getPrestashopOrderStatuses(
    @Param('connectionId') _connectionId: string,
  ): MappingOptionResponseDto[] {
    return PRESTASHOP_ORDER_STATUSES;
  }

  @Get('prestashop/carriers')
  @ApiOperation({ summary: 'List available PrestaShop carrier IDs' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  getPrestashopCarriers(
    @Param('connectionId') _connectionId: string,
  ): MappingOptionResponseDto[] {
    return PRESTASHOP_CARRIERS;
  }

  @Get('prestashop/payment-modules')
  @ApiOperation({ summary: 'List available PrestaShop payment module names' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  getPrestashopPaymentModules(
    @Param('connectionId') _connectionId: string,
  ): MappingOptionResponseDto[] {
    return PRESTASHOP_PAYMENT_MODULES;
  }
}
