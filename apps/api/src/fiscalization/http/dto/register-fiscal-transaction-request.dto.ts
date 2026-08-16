/**
 * Register Fiscal Transaction Request DTO (#1908)
 *
 * Body for `POST /fiscal-registrations`. The client supplies ONLY the connection
 * and the order - never the lines, and NEVER the exactly-once key. The
 * controller composes the whole command server-side from the order snapshot.
 *
 * NO `idempotencyKey` FIELD, deliberately. ADR-042 decision 6 makes the key
 * mandatory and caller-supplied at the PORT/SERVICE boundary, and it still is -
 * this controller is one such caller and mints it deterministically per
 * `(connection, order)`. Accepting one over HTTP as well bought nothing and cost
 * the guarantee: an operator re-posting the same `(connectionId, orderId)` under
 * any other key missed the `(connectionId, idempotencyKey)` read gate, inserted a
 * second row, won its claim and called the provider again - the same sale
 * registered twice, which ADR-042 places in the contract precisely because it is
 * a legal event for the seller. A re-attempt after a terminal rejection already
 * works under the deterministic key (the record is resumed and re-claimed), so no
 * legitimate use of a custom key remained. The service-side
 * at-most-one-originating-registration guard now refuses a second key regardless
 * of who supplies it; removing the field keeps an operator from reaching for a
 * switch that only ever produced a 409.
 *
 * Neutral by contract (ADR-042 decision 4): no country, regime or vendor
 * vocabulary reaches the API surface either.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterFiscalTransactionRequestDto {
  @ApiProperty({ description: 'Fiscalization connection id' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ description: 'Internal order id whose sale should be registered' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}
