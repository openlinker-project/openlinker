/**
 * KSeF numbering page
 *
 * Dedicated numbering surface reached from the connection's Actions tab. Two
 * tabs — Series (series table + document routing) and Number audit (per-series
 * gap audit). Reached only for a KSeF connection (the route is contributed by
 * the KSeF plugin), so the capability gate is the plugin boundary itself — no
 * platformType literal here. The active tab is URL state (`?tab=`), and the
 * write affordances degrade to read-only in demo mode.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useConnectionQuery } from '../../../features/connections';
import { PageLayout } from '../../../shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/tabs';
import { useDemoMode } from '../../../features/system';
import { KsefNumberingAuditTab } from './ksef-numbering-audit-tab';
import { KsefNumberingSeriesTab } from './ksef-numbering-series-tab';

const TAB_VALUES = ['series', 'audit'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(value: string | null): value is TabValue {
  return value === 'series' || value === 'audit';
}

export function KsefNumberingPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDemoMode = useDemoMode();

  const connectionQuery = useConnectionQuery(connectionId);
  const connectionName = connectionQuery.data?.name;

  const activeTab: TabValue = isTabValue(searchParams.get('tab')) ? (searchParams.get('tab') as TabValue) : 'series';

  function setTab(next: string): void {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('tab', next);
        return params;
      },
      { replace: true },
    );
  }

  // Skeleton the connection name into the back-link — never flash a placeholder.
  const backLabel = connectionName ? `Actions · ${connectionName}` : 'Actions';
  const backTo = { to: `/connections/${connectionId}?tab=actions`, label: backLabel };

  return (
    <PageLayout
      backTo={backTo}
      eyebrow="Invoicing"
      title="Invoice numbering"
      description="Numbering series are shared across every connection; this page controls which series each document type on this connection is routed to."
    >
      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList aria-label="Invoice numbering sections">
          <TabsTrigger value="series">Series</TabsTrigger>
          <TabsTrigger value="audit">Number audit</TabsTrigger>
        </TabsList>
        <TabsContent value="series">
          <KsefNumberingSeriesTab connectionId={connectionId} readOnly={isDemoMode} />
        </TabsContent>
        <TabsContent value="audit">
          <KsefNumberingAuditTab connectionId={connectionId} readOnly={isDemoMode} />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
