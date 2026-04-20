/**
 * Connection Mappings Page
 *
 * Provides three tabbed panels for configuring Allegro → PrestaShop mappings
 * per connection: order statuses, delivery carriers, and payment methods.
 *
 * @module apps/web/src/pages/connections
 */

import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { MappingPanel, type MappingRow } from '../../features/mappings/components/MappingPanel';
import { useStatusMappingsQuery, useUpsertStatusMappings } from '../../features/mappings/hooks/use-status-mappings';
import { useCarrierMappingsQuery, useUpsertCarrierMappings } from '../../features/mappings/hooks/use-carrier-mappings';
import { usePaymentMappingsQuery, useUpsertPaymentMappings } from '../../features/mappings/hooks/use-payment-mappings';
import { useMappingOptions } from '../../features/mappings/hooks/use-mapping-options';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { DesktopOnlyBanner } from '../../shared/ui/desktop-only-banner';

type TabId = 'status' | 'carriers' | 'payments';

const TABS: { id: TabId; label: string }[] = [
  { id: 'status', label: 'Order Statuses' },
  { id: 'carriers', label: 'Carriers' },
  { id: 'payments', label: 'Payments' },
];

export function ConnectionMappingsPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [activeTab, setActiveTab] = useState<TabId>('status');

  const statusQuery = useStatusMappingsQuery(connectionId);
  const carrierQuery = useCarrierMappingsQuery(connectionId);
  const paymentQuery = usePaymentMappingsQuery(connectionId);
  const { options, isLoading: optionsLoading, error: optionsError } = useMappingOptions(connectionId);

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
      eyebrow="Connection"
      title="Mapping Configuration"
      description="Configure Allegro → PrestaShop mappings for order statuses, delivery carriers, and payment methods."
      actions={
        <Link className="button button--secondary" to={`/connections/${connectionId}`}>
          Back to connection
        </Link>
      }
    >
      <DesktopOnlyBanner>
        Mapping editors are designed for desktop. On smaller screens the controls below are still
        visible but large tables may overflow horizontally.
      </DesktopOnlyBanner>

      {/* Tab navigation */}
      <div role="tablist" aria-label="Mapping types" className="toolbar" style={{ marginBottom: '1.5rem', gap: '0.25rem' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`button ${activeTab === tab.id ? 'button--primary' : 'button--ghost'}`}
            onClick={() => { setActiveTab(tab.id); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === activeTab)?.label}>
        {activeTab === 'status' && (
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
            optionsError={optionsError}
          />
        )}

        {activeTab === 'carriers' && (
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
            optionsError={optionsError}
          />
        )}

        {activeTab === 'payments' && (
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
            optionsError={optionsError}
          />
        )}
      </div>
    </PageLayout>
  );
}
