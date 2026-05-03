/**
 * Connection Mappings Page
 *
 * Provides three tabbed panels for configuring Allegro → PrestaShop mappings
 * per connection: order statuses, delivery carriers, and payment methods.
 *
 * @module apps/web/src/pages/connections
 */

import { type ReactElement, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { Alert } from '../../shared/ui/alert';
import { MappingPanel, type MappingRow } from '../../features/mappings/components/MappingPanel';
import { useStatusMappingsQuery, useUpsertStatusMappings } from '../../features/mappings/hooks/use-status-mappings';
import { useCarrierMappingsQuery, useUpsertCarrierMappings } from '../../features/mappings/hooks/use-carrier-mappings';
import { usePaymentMappingsQuery, useUpsertPaymentMappings } from '../../features/mappings/hooks/use-payment-mappings';
import { useMappingOptions } from '../../features/mappings/hooks/use-mapping-options';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import type { MappingOption } from '../../features/mappings/api/mappings.types';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { DesktopOnlyBanner } from '../../shared/ui/desktop-only-banner';

type TabId = 'status' | 'carriers' | 'payments';

const TABS: { id: TabId; label: string }[] = [
  { id: 'status', label: 'Order Statuses' },
  { id: 'carriers', label: 'Carriers' },
  { id: 'payments', label: 'Payments' },
];

interface FallbackBannerSpec {
  tone: 'info' | 'warning';
  message: ReactNode;
}

/**
 * Resolves the user-facing copy for the carrier-fallback banner (#517).
 * Returns null when the banner should not render (loading, errored,
 * nothing unmapped, or when we genuinely don't have enough info to
 * decide). Banner only fires on the carriers tab.
 *
 * Decision tree mirrors the BE adapter's resolution chain (#516):
 *   (1) `defaultCarrierId` set        → "using fallback: {name}"   info
 *   (2) OL Dynamic carrier installed   → "using OpenLinker Dynamic" info
 *   (3) neither                        → "sync will fail …"         warning
 */
function deriveCarrierFallbackBanner(args: {
  unmappedCount: number;
  defaultCarrierId: string | null;
  carriers: MappingOption[];
}): FallbackBannerSpec | null {
  const { unmappedCount, defaultCarrierId, carriers } = args;
  if (unmappedCount <= 0) return null;

  const count = (
    <span className="alert__count">{unmappedCount}</span>
  );
  const noun = unmappedCount === 1 ? 'method' : 'methods';

  // Case 1 — explicit fallback configured. Resolve the carrier name from
  // the loaded options. If the saved id no longer exists in the live
  // options (operator deleted the carrier in BO), fall through to the
  // "no fallback" warning so the operator notices.
  if (defaultCarrierId) {
    const fallback = carriers.find((c) => c.value === defaultCarrierId);
    if (fallback) {
      return {
        tone: 'info',
        message: (
          <>
            {count} {noun} unmapped — using fallback: {fallback.label}.
          </>
        ),
      };
    }
  }

  // Case 2 — OL Dynamic is installed and runtime will fall back to it.
  const hasDynamic = carriers.some((c) => c.kind === 'dynamic');
  if (hasDynamic) {
    return {
      tone: 'info',
      message: (
        <>
          {count} {noun} unmapped — using OpenLinker Dynamic (exact Allegro
          cost) at sync time.
        </>
      ),
    };
  }

  // Case 3 — no fallback at all. Operator-actionable warning.
  return {
    tone: 'warning',
    message: (
      <>
        {count} {noun} unmapped — sync will fail until a mapping or fallback
        is configured.
      </>
    ),
  };
}

export function ConnectionMappingsPage(): ReactElement {
  const { connectionId = '' } = useParams();

  const statusQuery = useStatusMappingsQuery(connectionId);
  const carrierQuery = useCarrierMappingsQuery(connectionId);
  const paymentQuery = usePaymentMappingsQuery(connectionId);
  const { options, isLoading: optionsLoading, errors: optionsErrors } = useMappingOptions(connectionId);
  // Connection config carries `defaultCarrierId` which the carrier
  // fallback-banner copy depends on (#517). Errors are tolerated — if we
  // can't load the connection we just suppress the banner; the BE still
  // does the right thing at sync time per #516.
  const connectionQuery = useConnectionQuery(connectionId);

  // Per-panel error isolation (#484): a failure in one bundle key must not
  // block the other tabs. Each panel only watches the two keys it actually
  // reads from.
  const statusOptionsError =
    optionsErrors.allegroOrderStatuses ?? optionsErrors.prestashopOrderStatuses ?? null;
  const carrierOptionsError =
    optionsErrors.allegroDeliveryMethods ?? optionsErrors.prestashopCarriers ?? null;
  const paymentOptionsError =
    optionsErrors.allegroPaymentProviders ?? optionsErrors.prestashopPaymentModules ?? null;

  const upsertStatus = useUpsertStatusMappings(connectionId);
  const upsertCarrier = useUpsertCarrierMappings(connectionId);
  const upsertPayment = useUpsertPaymentMappings(connectionId);

  const isLoading = statusQuery.isLoading || carrierQuery.isLoading || paymentQuery.isLoading;
  const loadError = statusQuery.error ?? carrierQuery.error ?? paymentQuery.error ?? null;

  if (isLoading) {
    return (
      <PageLayout eyebrow="Connection" title="Mappings" description="Loading mapping configuration…">
        <LoadingState liveRegion="off" title="Loading mappings" message="Fetching configured mappings for this connection." />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout eyebrow="Connection" title="Mappings" description="Unable to load mapping configuration.">
        <ErrorState title="Unable to load mappings" message={loadError.message} />
      </PageLayout>
    );
  }

  const statusRows: MappingRow[] = (statusQuery.data ?? []).map((m) => ({
    sourceValue: m.allegroStatus,
    targetValue: m.prestashopStatusId,
  }));

  const carrierRows: MappingRow[] = (carrierQuery.data ?? []).map((m) => ({
    sourceValue: m.allegroDeliveryMethodId,
    targetValue: m.prestashopCarrierId,
  }));

  const paymentRows: MappingRow[] = (paymentQuery.data ?? []).map((m) => ({
    sourceValue: m.allegroPaymentProvider,
    targetValue: m.prestashopPaymentModule,
  }));

  function handleSaveStatus(rows: MappingRow[]): void {
    upsertStatus.mutate({
      items: rows.map((r) => ({ allegroStatus: r.sourceValue, prestashopStatusId: r.targetValue })),
    });
  }

  function handleSaveCarriers(rows: MappingRow[]): void {
    upsertCarrier.mutate({
      items: rows.map((r) => ({ allegroDeliveryMethodId: r.sourceValue, prestashopCarrierId: r.targetValue })),
    });
  }

  function handleSavePayments(rows: MappingRow[]): void {
    upsertPayment.mutate({
      items: rows.map((r) => ({ allegroPaymentProvider: r.sourceValue, prestashopPaymentModule: r.targetValue })),
    });
  }

  return (
    <PageLayout
      backTo={{ to: `/connections/${connectionId}`, label: 'Connection' }}
      eyebrow="Connection"
      title="Mapping Configuration"
      description="Configure Allegro → PrestaShop mappings for order statuses, delivery carriers, and payment methods."
    >
      <DesktopOnlyBanner>
        Mapping editors are designed for desktop. On smaller screens the controls below are still
        visible but large tables may overflow horizontally.
      </DesktopOnlyBanner>

      <Tabs defaultValue="status" aria-label="Mapping types">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="status">
          <MappingPanel
            title="Order Status Mappings"
            description="Map Allegro order statuses to the corresponding PrestaShop order status IDs."
            sourceLabel="Allegro status"
            targetLabel="PrestaShop status"
            sourceOptions={options.allegroOrderStatuses}
            targetOptions={options.prestashopOrderStatuses}
            savedRows={statusRows}
            onSave={handleSaveStatus}
            isSaving={upsertStatus.isPending}
            saveError={upsertStatus.error}
            optionsLoading={optionsLoading}
            optionsError={statusOptionsError}
          />
        </TabsContent>

        <TabsContent value="carriers">
          {(() => {
            // Banner suppression: only render when both option lists +
            // the connection are loaded and the carriers options query
            // didn't error. Otherwise the banner copy can't be trusted.
            const carriersReady =
              !optionsLoading && carrierOptionsError === null && connectionQuery.data !== undefined;
            if (!carriersReady) return null;
            const cfg = connectionQuery.data?.config as
              | { defaultCarrierId?: unknown }
              | undefined;
            const defaultCarrierId =
              cfg?.defaultCarrierId !== undefined && cfg.defaultCarrierId !== null
                ? String(cfg.defaultCarrierId)
                : null;
            const banner = deriveCarrierFallbackBanner({
              unmappedCount: options.allegroDeliveryMethods.length - carrierRows.length,
              defaultCarrierId,
              carriers: options.prestashopCarriers,
            });
            if (!banner) return null;
            return (
              <Alert tone={banner.tone} className="mapping-panel__fallback-alert">
                {banner.message}
              </Alert>
            );
          })()}
          <MappingPanel
            title="Carrier Mappings"
            description="Map Allegro delivery method IDs to the corresponding PrestaShop carrier IDs."
            sourceLabel="Allegro delivery method"
            targetLabel="PrestaShop carrier"
            sourceOptions={options.allegroDeliveryMethods}
            targetOptions={options.prestashopCarriers}
            savedRows={carrierRows}
            onSave={handleSaveCarriers}
            isSaving={upsertCarrier.isPending}
            saveError={upsertCarrier.error}
            optionsLoading={optionsLoading}
            optionsError={carrierOptionsError}
          />
        </TabsContent>

        <TabsContent value="payments">
          <MappingPanel
            title="Payment Mappings"
            description="Map Allegro payment provider names to the corresponding PrestaShop payment module names."
            sourceLabel="Allegro payment provider"
            targetLabel="PrestaShop payment module"
            sourceOptions={options.allegroPaymentProviders}
            targetOptions={options.prestashopPaymentModules}
            savedRows={paymentRows}
            onSave={handleSavePayments}
            isSaving={upsertPayment.isPending}
            saveError={upsertPayment.error}
            optionsLoading={optionsLoading}
            optionsError={paymentOptionsError}
          />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
