/**
 * Customers API Module
 *
 * NestJS module for customer projection read API endpoints. Imports core
 * customers module and registers the customers controller.
 *
 * @module apps/api/src/customers
 */
import { Module } from '@nestjs/common';
import { CustomersModule as CoreCustomersModule } from '@openlinker/core/customers';
import { CustomersController } from './http/customers.controller';

@Module({
  imports: [CoreCustomersModule],
  controllers: [CustomersController],
})
export class CustomersApiModule {}
