/**
 * Sales-Document Capability Guard Service (#2170)
 *
 * The ONE connection-capability check the mockup describes ("a rule pointing
 * `Invoice → eparagony.pl` is rejected before it can save, since eparagony.pl
 * carries no `Invoicing` capability") — deliberately placed HERE, at the API
 * layer, rather than inside `libs/core/src/sales-documents`. That core
 * concern is pinned as a zero-outbound-CORE-context-edge leaf
 * (`barrel-purity.spec.ts`); injecting `IIntegrationsService` there to
 * resolve a connection's capabilities would add exactly the cross-context
 * edge that property forbids. This service already has `IIntegrationsService`
 * in scope, so it does the check and the controller calls it BEFORE
 * delegating to the core `ISalesDocumentRulesService`.
 *
 * Mirrors `resolveSalesDocumentRouting`'s own
 * `REQUIRED_CAPABILITY_BY_CORE_KIND` map — kept as a SEPARATE small map here
 * rather than imported, since that map is a private (non-exported) constant
 * inside the core resolver file and duplicating three lines of open-world-safe
 * lookup logic is cheaper than exporting an internal implementation detail
 * across the API/core boundary for one caller.
 *
 * @module apps/api/src/sales-documents
 */
import { Inject, Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { CoreSalesDocumentKindValues, type SalesDocumentKind } from '@openlinker/core/sales-documents';

const REQUIRED_CAPABILITY_BY_CORE_KIND: Readonly<Record<string, string>> = {
  invoice: 'Invoicing',
  'fiscal-receipt': 'Fiscalization',
};

@Injectable()
export class SalesDocumentCapabilityGuardService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  /**
   * Throws `BadRequestException` when `connectionId` lacks the capability
   * `documentKind` requires. An open-world (unrecognized) kind has no known
   * required capability and passes structurally — validity for those stays a
   * deeper, adapter-level concern (ADR-041 decision 10), never a check this
   * guard can perform.
   */
  async assertConnectionSupportsKind(
    connectionId: string,
    documentKind: SalesDocumentKind,
  ): Promise<void> {
    const isCoreKind = (CoreSalesDocumentKindValues as readonly string[]).includes(documentKind);
    if (!isCoreKind) return;

    const requiredCapability = REQUIRED_CAPABILITY_BY_CORE_KIND[documentKind];
    if (requiredCapability === undefined) return;

    const { metadata } = await this.integrations.getAdapter(connectionId);
    if (!metadata.supportedCapabilities.includes(requiredCapability)) {
      throw new BadRequestException(
        `Connection '${connectionId}' does not support ${requiredCapability}, which is required to issue '${documentKind}'.`,
      );
    }
  }
}
