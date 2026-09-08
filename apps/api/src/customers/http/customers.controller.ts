/**
 * Customers Controller
 *
 * HTTP REST API endpoints for customer projection read operations. Provides
 * endpoints for listing customer projections with filters and retrieving
 * individual customer details with addresses.
 *
 * @module apps/api/src/customers/http
 *
 * **Reads are `@Roles('admin', 'operator', 'viewer')`, not `@AnyRole()` (#2413).**
 * This is wave-spec story A5 as an acceptance criterion rather than a product
 * decision: a bench session must be refused the customer list and a customer
 * record. Naming the three roles is behaviourally identical for every user who
 * exists today and excludes the new `packer` role by construction. Asserted by
 * `apps/api/test/integration/bench-packer-authorization.int-spec.ts` and by
 * `apps/api/src/auth/packer-exclusion.spec.ts` — a comment here would be
 * discharged the moment somebody adds a route.
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
import {
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjectionRepositoryPort,
} from '@openlinker/core/customers';
import type { CustomerProjection, CustomerAddressProjection } from '@openlinker/core/customers';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { CustomerProjectionResponseDto } from './dto/customer-projection-response.dto';
import type { CustomerAddressResponseDto } from './dto/customer-address-response.dto';
import { PaginatedCustomersResponseDto } from './dto/paginated-customers-response.dto';
import { CountCustomersQueryDto } from './dto/count-customers-query.dto';
import type { CustomerProjectionFilters } from '@openlinker/core/customers';
import { PaginatedTotalResponseDto } from '../../common/dto/paginated-total-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * The one DTO-to-filters mapping this list has (#2957 review round 4, I2).
 *
 * Two fields today; the argument is about the third. Shared by `GET /customers`
 * and `GET /customers/count` so the count cannot apply a different filter set
 * than the page - the discipline `orders` and `products` already carry.
 */
function toCustomerProjectionFilters(
  query: CountCustomersQueryDto
): CustomerProjectionFilters {
  return {
    search: query.search,
    lastSourceConnectionId: query.lastSourceConnectionId,
  };
}

@ApiBearerAuth()
@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly customerRepository: CustomerProjectionRepositoryPort
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List customer projections',
    description:
      'Returns a paginated list of customer projections. Supports filtering by search text and lastSourceConnectionId. ' +
      'Set `?withTotal=false` to get the page WITHOUT its total: the `total` field is omitted entirely (never `0`) and the count this list cannot serve from an index is skipped. Fetch the number separately from `GET /customers/count` (#2944).',
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
    const { withTotal, limit = 20, offset = 0 } = query;
    const filters = toCustomerProjectionFilters(query);

    // `?withTotal=false` skips the COUNT entirely and the response OMITS
    // `total` rather than reporting 0 (#2944) - an absent total and a genuine
    // zero must stay distinguishable, or a client renders "0 customers" for a
    // number it simply did not ask for. Anything else keeps the pre-#2944
    // combined read byte-for-byte: one `getManyAndCount()` on one query runner,
    // which always runs its count - there is no short-page branch in
    // typeorm@0.3.17, which is why moving the count off this path is worth
    // doing at all.
    if (withTotal === false) {
      const items = await this.customerRepository.findManyRows(filters, { limit, offset });
      return { items: items.map((c) => this.toDto(c)), limit, offset };
    }

    const { items, total } = await this.customerRepository.findMany(filters, { limit, offset });

    return {
      items: items.map((c) => this.toDto(c)),
      total,
      limit,
      offset,
    };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get('count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Count customer projections matching the filters',
    description:
      'The total for the same filters `GET /customers` accepts, without a page. Paired with ' +
      '`GET /customers?withTotal=false` so a list renders its rows without waiting for a count ' +
      'that cannot stop early (#2944). Takes no limit/offset - the answer depends on the ' +
      'filters alone.',
  })
  @ApiResponse({ status: 200, description: 'Row count', type: PaginatedTotalResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async countCustomers(@Query() query: CountCustomersQueryDto): Promise<PaginatedTotalResponseDto> {
    const total = await this.customerRepository.countMany(toCustomerProjectionFilters(query));
    return { total };
  }

  @Roles('admin', 'operator', 'viewer')
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
