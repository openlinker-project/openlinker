/**
 * Customers Controller
 *
 * HTTP REST API endpoints for customer projection read operations. Provides
 * endpoints for listing customer projections with filters and retrieving
 * individual customer details with addresses.
 *
 * @module apps/api/src/customers/http
 */
import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjectionRepositoryPort,
} from '@openlinker/core/customers';
import type { CustomerProjection, CustomerAddressProjection } from '@openlinker/core/customers';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { CustomerProjectionResponseDto } from './dto/customer-projection-response.dto';
import type { CustomerAddressResponseDto } from './dto/customer-address-response.dto';
import { PaginatedCustomersResponseDto } from './dto/paginated-customers-response.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly customerRepository: CustomerProjectionRepositoryPort
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List customer projections',
    description:
      'Returns a paginated list of customer projections. Supports filtering by search text and lastSourceConnectionId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated customer list',
    type: PaginatedCustomersResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listCustomers(
    @Query() query: ListCustomersQueryDto
  ): Promise<PaginatedCustomersResponseDto> {
    const { search, lastSourceConnectionId, limit = 20, offset = 0 } = query;

    const { items, total } = await this.customerRepository.findMany(
      { search, lastSourceConnectionId },
      { limit, offset }
    );

    return {
      items: items.map((c) => this.toDto(c)),
      total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Internal customer ID (e.g. ol_customer_...)' })
  @ApiOperation({ summary: 'Get customer projection by internal customer ID' })
  @ApiResponse({
    status: 200,
    description: 'Customer projection detail with addresses',
    type: CustomerProjectionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCustomer(@Param('id') id: string): Promise<CustomerProjectionResponseDto> {
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${id}`);
    }

    const addresses = await this.customerRepository.findAddressesByCustomerId(id);

    return {
      ...this.toDto(customer),
      addresses: addresses.map((a) => this.toAddressDto(a)),
    };
  }

  private toDto(customer: CustomerProjection): CustomerProjectionResponseDto {
    return {
      internalCustomerId: customer.internalCustomerId,
      emailHash: customer.emailHash,
      normalizedEmail: customer.normalizedEmail,
      firstName: customer.firstName,
      lastName: customer.lastName,
      lastSeenAt:
        customer.lastSeenAt instanceof Date
          ? customer.lastSeenAt.toISOString()
          : customer.lastSeenAt,
      lastSourceConnectionId: customer.lastSourceConnectionId,
      createdAt:
        customer.createdAt instanceof Date ? customer.createdAt.toISOString() : customer.createdAt,
      updatedAt:
        customer.updatedAt instanceof Date ? customer.updatedAt.toISOString() : customer.updatedAt,
    };
  }

  private toAddressDto(address: CustomerAddressProjection): CustomerAddressResponseDto {
    return {
      addressHash: address.addressHash,
      addressType: address.addressType,
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      postcode: address.postcode,
      countryIso2: address.countryIso2,
      lastSeenAt:
        address.lastSeenAt instanceof Date ? address.lastSeenAt.toISOString() : address.lastSeenAt,
      createdAt:
        address.createdAt instanceof Date ? address.createdAt.toISOString() : address.createdAt,
      updatedAt:
        address.updatedAt instanceof Date ? address.updatedAt.toISOString() : address.updatedAt,
    };
  }
}
