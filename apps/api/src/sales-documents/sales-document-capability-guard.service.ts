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
 * Reuses `resolveSalesDocumentRouting`'s own `REQUIRED_CAPABILITY_BY_CORE_KIND`
 * map (`@openlinker/core/sales-documents`) rather than a separately maintained
 * copy, so this save-time check and the routing resolver's own structural
 * check can never drift apart.
 *
 * @module apps/api/src/sales-documents
 */
import { Inject, Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  isCoreSalesDocumentKind,
  REQUIRED_CAPABILITY_BY_CORE_KIND,
  type SalesDocumentKind,
} from '@openlinker/core/sales-documents';

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
    if (!isCoreSalesDocumentKind(documentKind)) return;

    const requiredCapability = REQUIRED_CAPABILITY_BY_CORE_KIND[documentKind];
    if (requiredCapability === undefined) return;

    // Checked against what the OPERATOR turned on, not what the adapter
    // package could theoretically support (review finding 5) — every other
    // gate in this epic (the actual `AutoIssueTriggerService` runtime path,
    // `SalesDocumentCapabilityGuardService`'s own sibling checks) keys off
    // `connection.enabledCapabilities`. Keying off `metadata.supportedCapabilities`
    // instead let an operator save a rule routing through a connection whose
    // adapter CAN support the capability but that was never enabled — the
    // save-time guard would pass, and the rejection would only surface later,
    // as a confusing `unsupported-document-kind-on-connection` block on a
    // real order.
    const { connection } = await this.integrations.getAdapter(connectionId);
    if (!connection.enabledCapabilities.includes(requiredCapability)) {
      throw new BadRequestException(
        `Connection '${connectionId}' does not have ${requiredCapability} enabled, which is required to issue '${documentKind}'.`,
      );
    }
  }
}
