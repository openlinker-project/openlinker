/**
 * OMS onboarding wizard page object (#3458)
 *
 * The live `/settings/packing` page (#3457). The wizard puts `data-state` and
 * `data-source` on its own root (`[data-testid="oms-onboarding"]`) rather than
 * on `<body>` as the mockup does - see the header of
 * `apps/web/src/features/oms-onboarding/components/oms-onboarding.tsx`.
 *
 * ## Shaping the product-master setup without touching the stack
 *
 * `withConnections` rewrites only the `GET /v1/connections` response, after
 * the real backend answered. That is enough to reach `data-source=none`,
 * `data-source=two` and the pre-Confirm `step-1-product-master` on a stack
 * that is already set up, because the wizard derives all three from that one
 * list. Specs using it must never click a write control: the backend would
 * act on connections the page was not shown.
 *
 * @module pages
 */
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import type { Connection } from '../api/api.types';

export const OMS_ONBOARDING_PATH = '/settings/packing';
const OMS_PLATFORM_TYPE = 'openlinker';

export type ConnectionsRewrite = (connections: Connection[]) => Connection[];

const MASTER_CAPABILITIES = ['ProductMaster', 'InventoryMaster'] as const;

function has(connection: Connection, capability: string): boolean {
  return (
    connection.supportedCapabilities.includes(capability) &&
    connection.enabledCapabilities.includes(capability)
  );
}

/**
 * The product masters the wizard counts: active, with both capabilities
 * advertised and enabled (`selectProductMasters`, #3457).
 */
export function isProductMaster(connection: Connection): boolean {
  return connection.status === 'active' && MASTER_CAPABILITIES.every((c) => has(connection, c));
}

/** Holds either capability, so it would count as a master or a partial one. */
function holdsAnyMasterCapability(connection: Connection): boolean {
  return MASTER_CAPABILITIES.some((c) => has(connection, c));
}

/** Drop every connection holding a master capability: `data-source=none`. */
export const withoutProductMasters: ConnectionsRewrite = (connections) =>
  connections.filter((connection) => !holdsAnyMasterCapability(connection));

/** Hide the OMS connection, so step 1 reads as not yet confirmed. */
export const withoutOmsConnection: ConnectionsRewrite = (connections) =>
  connections.filter((connection) => connection.platformType !== OMS_PLATFORM_TYPE);

/**
 * Exactly two product masters: the first real one plus a renamed copy, and no
 * OMS connection, so the wizard shows the unconfirmed two-master warning.
 */
export const withTwoProductMasters: ConnectionsRewrite = (connections) => {
  const rest = withoutOmsConnection(connections).filter(
    (connection) => !holdsAnyMasterCapability(connection),
  );
  const first = connections.find(isProductMaster);
  if (first === undefined) return rest;
  const copy: Connection = {
    ...first,
    id: '00000000-0000-4000-8000-000000003458',
    name: `${first.name} (second shop)`,
    config: { ...(first.config ?? {}), stockLocationOverride: null },
  };
  return [...rest, { ...first, config: { ...(first.config ?? {}), stockLocationOverride: null } }, copy];
};

export class OmsOnboardingPage {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId('oms-onboarding');
  }

  async goto(): Promise<void> {
    await this.page.goto(OMS_ONBOARDING_PATH);
    await expect(this.root()).toBeVisible();
  }

  /** Rewrite the connections list for the rest of this page's life. */
  async withConnections(rewrite: ConnectionsRewrite): Promise<void> {
    await this.page.route('**/v1/connections', async (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as Connection[];
      await route.fulfill({ response, json: rewrite(body) });
    });
  }

  async expectState(state: string): Promise<void> {
    await expect(this.root()).toHaveAttribute('data-state', state);
  }

  async state(): Promise<string> {
    return (await this.root().getAttribute('data-state')) ?? '';
  }

  async expectSource(source: string): Promise<void> {
    await expect(this.root()).toHaveAttribute('data-source', source);
  }

  /** Jump to a step through the stepper (1-based, live numbering). */
  async goToStep(step: number): Promise<void> {
    await this.page.getByTestId(`wizard-stepper-button-${step}`).click();
  }

  byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }
}
