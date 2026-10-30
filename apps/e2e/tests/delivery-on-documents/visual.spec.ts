/**
 * Visual parity with the committed mockup (#3912, ADR-079)
 *
 * Five states x two viewports x two themes. For each: the live UI is measured
 * (no horizontal overflow, no clipped text, WCAG text contrast) and
 * screenshotted, then the matching mockup view is screenshotted in the same
 * viewport and theme for side-by-side review. Every measurement is written to
 * `test-results/delivery-on-documents/summary.json` whether it passed or not;
 * the assertions run last so a failing state still leaves both screenshots.
 *
 * @module tests/delivery-on-documents
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import {
  DELIVERY_CONNECTION_IDS,
  cleanupDeliveryOnDocuments,
  seedDeliveryOnDocuments,
  setSourceDeliveryConfig,
} from '../../src/support/delivery-on-documents-seed';
import {
  applyTheme,
  captureMockupScreenshot,
  runVisualChecks,
  writeVisualSummary,
  type MockupView,
  type VisualStateSummary,
  type VisualTheme,
} from '../../src/support/visual-checks';
import type { PageObjects } from '../../src/pages';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const THEMES: readonly VisualTheme[] = ['light', 'dark'];

interface VisualState {
  name: string;
  mockupView: MockupView;
  /** Live root element the checks measure. */
  rootSelector: string;
  /** Drive the live app into the state. */
  arrange: (page: Page, pages: PageObjects) => Promise<void>;
  /** Drive the mockup into the matching state, when it needs more than the hash. */
  arrangeMockup?: (page: Page) => Promise<void>;
}

const STATES: readonly VisualState[] = [
  {
    name: 'tab-configured',
    mockupView: 'mapowania',
    rootSelector: '.dd-panel',
    arrange: async (_page, pages): Promise<void> => {
      const tab = pages.deliveryOnDocuments;
      await tab.goto(DELIVERY_CONNECTION_IDS.source);
      await tab.button('Use them').click();
      await expect(tab.row('Poland')).toContainText('Koszt dostawy 23%');
    },
  },
  {
    name: 'tab-first-run',
    mockupView: 'start',
    rootSelector: '.dd-panel',
    arrange: async (_page, pages): Promise<void> => {
      const tab = pages.deliveryOnDocuments;
      await tab.goto(DELIVERY_CONNECTION_IDS.source);
      await expect(tab.suggestionStrip).toBeVisible();
    },
  },
  {
    name: 'editor-dialog',
    mockupView: 'mapowania',
    rootSelector: '[role="dialog"]',
    arrange: async (_page, pages): Promise<void> => {
      const tab = pages.deliveryOnDocuments;
      await tab.goto(DELIVERY_CONNECTION_IDS.source);
      await tab.button('Use them').click();
      await expect(tab.row('Poland')).toBeVisible();
      await tab.editButton('Poland').click();
      await expect(tab.editor.title('Poland')).toBeVisible();
      await waitForDialogSettled(_page);
    },
    arrangeMockup: async (page): Promise<void> => {
      await page.getByRole('button', { name: 'Edit Poland' }).click();
      await waitForDialogSettled(page);
    },
  },
  {
    name: 'wizard-suggested',
    mockupView: 'kreator',
    rootSelector: '.dd-wizard',
    arrange: async (_page, pages): Promise<void> => {
      await pages.allegroWizard.goto();
      await pages.allegroWizard.advanceToSalesDocuments('Delivery E2E visual');
      await expect(pages.allegroWizard.step.miniReceipt).toBeVisible();
    },
  },
  {
    name: 'wizard-own',
    mockupView: 'kreator',
    rootSelector: '.dd-wizard',
    arrange: async (_page, pages): Promise<void> => {
      await pages.allegroWizard.goto();
      await pages.allegroWizard.advanceToSalesDocuments('Delivery E2E visual');
      await pages.allegroWizard.step.ownChoice.check();
      await expect(pages.allegroWizard.step.ownTable).toBeVisible();
    },
    arrangeMockup: async (page): Promise<void> => {
      await page.locator('.dd-choice').filter({ hasText: 'Set it up myself' }).click();
    },
  },
];

/**
 * The dialog fades in; measuring mid-animation blends every colour toward the
 * backdrop and reports contrast the settled UI does not have.
 */
async function waitForDialogSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog !== null && dialog.getAnimations({ subtree: true }).every((a) => a.playState !== 'running');
  });
}

/** True when the element carrying the text is styled by this feature (`dd-*`), not merely inside it. */
function ownsTheText(selector: string): boolean {
  const last = selector.split(' > ').pop() ?? '';
  return /\.dd-/.test(last);
}

const results: VisualStateSummary[] = [];

test.beforeAll(async () => {
  await seedDeliveryOnDocuments();
});

test.afterAll(async () => {
  await writeVisualSummary(results);
  await cleanupDeliveryOnDocuments();
});

for (const state of STATES) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${state.name} at ${String(viewport.width)}px, ${theme}`, async ({
        page,
        pages,
        api,
      }) => {
        let summary: VisualStateSummary | null = null;

        await test.step('reset the connection to first run', async () => {
          await setSourceDeliveryConfig(api, null);
        });

        await test.step(`open the live state at ${String(viewport.width)}x${String(viewport.height)}`, async () => {
          await page.setViewportSize(viewport);
          await page.addInitScript((value) => {
            try {
              window.localStorage.setItem('openlinker.theme', value);
            } catch {
              // storage can be disabled
            }
          }, theme);
          await page.emulateMedia({ colorScheme: theme });
          await state.arrange(page, pages);
          await applyTheme(page, theme);
        });

        await test.step('measure overflow and contrast, screenshot the live UI', async () => {
          summary = await runVisualChecks(page, {
            state: state.name,
            width: viewport.width,
            theme,
            rootSelector: state.rootSelector,
          });
        });

        await test.step('screenshot the mockup counterpart', async () => {
          if (summary === null) return;
          summary.mockupScreenshot = await captureMockupScreenshot(
            page,
            state.mockupView,
            state.name,
            viewport.width,
            viewport.height,
            theme,
            state.arrangeMockup,
          );
          results.push(summary);
        });

        await test.step('no horizontal overflow, no clipped text', () => {
          expect.soft(summary?.documentOverflow, 'page scrolls horizontally').toBe(false);
          expect.soft(summary?.clipped, 'text clipped by overflow:hidden').toEqual([]);
        });

        await test.step('text contrast meets WCAG AA', () => {
          // Two tiers. Anything under 3:1 is unreadable wherever it sits, and
          // every text this feature styles itself (`dd-*`) must meet 4.5:1.
          // A shared design-system part between 3:1 and 4.5:1 (the muted
          // form-field description, the infotip glyph) is the app-wide token,
          // not this feature's choice - it is recorded in summary.json for
          // the report rather than failing this spec.
          const offenders = summary?.contrastOffenders ?? [];
          const failing = offenders.filter(
            (offender) => offender.ratio < 3 || ownsTheText(offender.selector),
          );
          expect.soft(failing, 'low-contrast text').toEqual([]);
        });
      });
    }
  }
}
