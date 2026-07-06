/**
 * Subiekt Integration Controller (#1324)
 *
 * Plugin-specific HTTP surface for Subiekt discovery endpoints, mirroring the
 * `AllegroController` precedent (plugin-scoped controller, capability-adapter
 * resolution, guard-narrowed to the concrete adapter). DISTINCT from the
 * capability-generic `InvoicingController`:
 *   - `InvoicingController` serves the NEUTRAL bank-account shape via the
 *     `BankAccountsReader` core capability (no owner info).
 *   - This controller serves the OWNER-AWARE bank-account list
 *     (`ownerPodmiotId`/`ownerName`) plus the Stanowisko Kasowe (cash-register)
 *     list — both Subiekt-local shapes with no neutral core capability
 *     (decisions 2 and 6), so there is no `is*Reader` guard to reuse.
 *
 * Narrowing: the two discovery methods are plain public methods on
 * `SubiektInvoicingAdapter`, not part of any core port. We resolve the
 * connection's `Invoicing` adapter (same seam as `InvoicingController`) and
 * narrow it with a small STRUCTURAL guard rather than `instanceof` — this keeps
 * the concrete adapter as a type-only import (no value-level cross-package
 * dependency) and makes the guard trivially satisfiable by a shaped test
 * double. A non-Subiekt connection is rejected with `BadRequestException`,
 * mirroring how `allegro.controller.ts` rejects an unsupported capability.
 *
 * Adapter/bridge errors propagate as-is — the adapter already translates them;
 * Nest's exception layer maps them (matches `allegro.controller.ts`, which does
 * not wrap adapter errors).
 *
 * @module apps/api/src/integrations/http
 */
import { Controller, Get, Param, BadRequestException, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { InvoicingPort } from '@openlinker/core/invoicing';
import type { SubiektInvoicingAdapter } from '@openlinker/integrations-subiekt';
import { SubiektBankAccountResponseDto } from './dto/subiekt-bank-account-response.dto';
import { SubiektCashRegisterResponseDto } from './dto/subiekt-cash-register-response.dto';

/**
 * Structural narrow to the Subiekt adapter. The discovery methods are
 * Subiekt-local (no core capability), so there is no shared capability guard.
 * A type-only import + duck-typing keeps apps/api free of a value-level
 * dependency on the concrete adapter class.
 */
function isSubiektInvoicingAdapter(adapter: InvoicingPort): adapter is SubiektInvoicingAdapter {
  const candidate = adapter as Partial<SubiektInvoicingAdapter>;
  return (
    typeof candidate.listBankAccountsWithOwner === 'function' &&
    typeof candidate.listCashRegisters === 'function'
  );
}

@Roles('admin')
@ApiBearerAuth()
@ApiTags('subiekt')
@Controller('integrations/subiekt')
export class SubiektController {
  private readonly logger = new Logger(SubiektController.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  @Get('connections/:connectionId/bank-accounts')
  @ApiOperation({
    summary: "List the Subiekt connection's owner-aware bank accounts",
    description:
      "Resolves the connection's Invoicing adapter, narrows to the Subiekt adapter, and returns " +
      'the OWNER-AWARE bank-account list (with ownerPodmiotId/ownerName) so the FE can group ' +
      'accounts by payer and show the >1-owner routing warning. Distinct from the neutral ' +
      "InvoicingController bank-accounts route. 400 when the connection is not a Subiekt one.",
  })
  @ApiParam({ name: 'connectionId', description: 'Connection ID' })
  @ApiResponse({ status: 200, type: [SubiektBankAccountResponseDto] })
  @ApiResponse({ status: 400, description: 'Connection is not a Subiekt Invoicing connection' })
  async listBankAccounts(
    @Param('connectionId') connectionId: string,
  ): Promise<SubiektBankAccountResponseDto[]> {
    this.logger.debug(`Listing Subiekt bank accounts (connection: ${connectionId})`);
    const adapter = await this.resolveSubiektAdapter(connectionId);
    const accounts = await adapter.listBankAccountsWithOwner();
    return accounts.map((account) => ({
      id: account.id,
      accountNumber: account.accountNumber,
      bankName: account.bankName,
      isDefault: account.isDefault,
      ownerPodmiotId: account.ownerPodmiotId,
      ownerName: account.ownerName,
    }));
  }

  @Get('connections/:connectionId/cash-registers')
  @ApiOperation({
    summary: "List the Subiekt connection's cash registers (Stanowiska Kasowe)",
    description:
      "Resolves the connection's Invoicing adapter, narrows to the Subiekt adapter, and returns " +
      'the (unfiltered) cash-register list. oddzialId is an informational branch tag only. ' +
      '400 when the connection is not a Subiekt one.',
  })
  @ApiParam({ name: 'connectionId', description: 'Connection ID' })
  @ApiResponse({ status: 200, type: [SubiektCashRegisterResponseDto] })
  @ApiResponse({ status: 400, description: 'Connection is not a Subiekt Invoicing connection' })
  async listCashRegisters(
    @Param('connectionId') connectionId: string,
  ): Promise<SubiektCashRegisterResponseDto[]> {
    this.logger.debug(`Listing Subiekt cash registers (connection: ${connectionId})`);
    const adapter = await this.resolveSubiektAdapter(connectionId);
    const registers = await adapter.listCashRegisters();
    return registers.map((register) => ({
      id: register.id,
      name: register.name,
      symbol: register.symbol,
      oddzialId: register.oddzialId,
    }));
  }

  /**
   * Resolve the connection's `Invoicing` adapter and narrow it to the concrete
   * Subiekt adapter. Throws `BadRequestException` when the connection is not a
   * Subiekt one (its adapter lacks the Subiekt-local discovery methods).
   */
  private async resolveSubiektAdapter(connectionId: string): Promise<SubiektInvoicingAdapter> {
    const adapter = await this.integrationsService.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      'Invoicing',
    );
    if (!isSubiektInvoicingAdapter(adapter)) {
      throw new BadRequestException(
        `Connection ${connectionId} is not a Subiekt Invoicing connection`,
      );
    }
    return adapter;
  }
}
