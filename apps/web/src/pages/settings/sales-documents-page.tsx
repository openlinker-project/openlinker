/**
 * Sales Documents Page (#2159)
 *
 * Admin-only page hosting the centralized "Settings -> Sales documents routing" view.
 * The route path keeps its original `/settings/sales-documents` spelling: it is
 * a persisted link target, and #3307 renamed only what an operator reads.
 * Mirrors `McpTokensPage`'s admin-gating shape.
 *
 * TWO SECTIONS, IN THIS ORDER (mockup `sales-document-routing.html`):
 *
 *   1. `SalesDocumentRuleEnginePanel` — the primary authoring surface (#2170 /
 *      M7 / #2550). ONE market table plus the per-country routing dialog.
 *   2. `SalesDocumentsPanel` — the mockup's "Connected providers" table. It is
 *      DEMOTED below the market list, never removed: it is the only place a
 *      connection's document kind, "goes first" and trigger model are set at
 *      all, and a connection with nothing set there is not a routing candidate
 *      for the rule engine either (`architecture-overview.md § Invoicing`,
 *      #2156). Deleting it left an install with no way to make auto-issue fire
 *      — `config.invoicing.triggerModel` defaults to `manual`, so a fully
 *      authored rule set still issued nothing (#2809 review, BLOCKING 3).
 *
 * @module apps/web/src/pages/settings
 */
import { useState, type ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';
import { GuideButton, GuideDrawer, useGuideDrawer } from '../../shared/ui/guide-drawer';
import { HelpLink } from '../../shared/ui/help-link';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusTabs } from '../../shared/ui/status-tabs';
import { GiftDocumentsDefaultPanel, useGiftDocumentsGuide } from '../../features/gift-documents';
import { useMessages } from '../../shared/i18n';
import { SalesDocumentRuleEnginePanel, SalesDocumentsPanel } from '../../features/sales-documents';

type SectionTab = 'markets' | 'providers' | 'gifts';
const SECTION_IDS: Record<SectionTab, string> = {
  markets: 's-markets',
  providers: 's-prov',
  gifts: 's-gifts',
};

export function SalesDocumentsPage(): ReactElement {
  const { session } = useSession();
  const copy = useMessages('settings').salesDocumentsPage;
  const guide = useGuideDrawer();
  const guideCopy = useGiftDocumentsGuide();
  const giftCopy = useMessages('gift-documents').settings;
  // The tabs jump to a section; they do not hide the others (the whole page is one
  // scroll), and they start on the section this slice is about.
  const [tab, setTab] = useState<SectionTab>('gifts');

  function goTo(next: SectionTab | null): void {
    if (next === null) return;
    setTab(next);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    document
      .getElementById(SECTION_IDS[next])
      ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.adminOnly.description}>
        <ErrorState
          title={copy.adminOnly.title}
          message={copy.adminOnly.message}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      backTo={{ to: '/settings', label: copy.backLabel }}
      actions={<GuideButton label={giftCopy.guideButton} onClick={() => guide.show()} />}
    >
      <div className="list-statusbar">
        <StatusTabs<SectionTab>
          hideCounts
          aria-label={copy.sectionsLabel}
          value={tab}
          onChange={goTo}
          tabs={[
            { key: 'markets', label: copy.sections.markets },
            { key: 'providers', label: copy.sections.providers },
            { key: 'gifts', label: copy.sections.gifts },
          ]}
        />
      </div>
      <div id="s-markets" className="gift-anchor">
        <SalesDocumentRuleEnginePanel />
      </div>
      <div id="s-prov" className="gift-anchor">
        <SalesDocumentsPanel />
      </div>
      <GiftDocumentsDefaultPanel onHelp={(itemId) => guide.show(itemId)} />
      <GuideDrawer
        open={guide.open}
        onOpenChange={guide.onOpenChange}
        focusItemId={guide.itemId}
        title={guideCopy.title}
        lede={guideCopy.lede}
        sections={guideCopy.sections}
        footer={<HelpLink surfaceKey="sales-documents-routing" />}
      />
    </PageLayout>
  );
}
