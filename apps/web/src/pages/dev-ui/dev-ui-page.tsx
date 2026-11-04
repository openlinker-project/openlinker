/**
 * Dev UI page — design-system browser (#775)
 *
 * Three tabs: Brandbook (tokens, type, color, spacing, motion),
 * Primitives (kitchen sink for every component in shared/ui/), Patterns
 * (composed examples). Hidden — reachable only at `/dev/ui`.
 *
 * @module pages/dev-ui
 */
import type { ReactElement } from 'react';
import {
  PageLayout,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../shared/ui';
import { BrandbookSection } from './sections/brandbook-section';
import { PrimitivesSection } from './sections/primitives-section';
import { PatternsSection } from './sections/patterns-section';
import { useMessages } from '../../shared/i18n';

export function DevUiPage(): ReactElement {
  const copy = useMessages('dev-ui').devUiPage;
  return (
    <PageLayout
      eyebrow="Internal · Issue #775"
      title="Design System"
      description={copy.description}
    >
      <Tabs defaultValue="brandbook">
        <TabsList aria-label="Design system sections">
          <TabsTrigger value="brandbook">Brandbook</TabsTrigger>
          <TabsTrigger value="primitives">Primitives</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
        </TabsList>
        <TabsContent value="brandbook">
          <BrandbookSection />
        </TabsContent>
        <TabsContent value="primitives">
          <PrimitivesSection />
        </TabsContent>
        <TabsContent value="patterns">
          <PatternsSection />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
