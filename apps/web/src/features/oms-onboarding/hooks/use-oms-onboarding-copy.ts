/**
 * Packing onboarding wording (#3457, #4017)
 *
 * Every operator-facing sentence of the "Pack orders in OpenLinker" wizard and
 * its status page, in the active language. The sentences live in the
 * `oms-onboarding` namespace of the locale files (ADR-081); this module picks
 * the plural form a count needs and fills the names, so no component builds a
 * sentence out of English pieces. The shape matches what the wizard, the
 * status view and the tile read, so the three cannot drift apart.
 *
 * The sentences in step 3 describe what the backend actually does once packing
 * is on. Each one names the issue that makes it true, so a reviewer can check
 * it against the code rather than against the mockup:
 *
 * - a routed order is not created in the product master        #3485
 * - the product master's stock is lowered per line, once       #3453
 * - out of stock / no address / routing error waits in Orders  #3485
 * - the operator's own shop orders are not routed              #3487
 * - orders the marketplace ships itself are not routed         #3488
 * - an order already sent before is not routed on re-download  #3455
 *
 * @module features/oms-onboarding/hooks
 */
import { useMemo } from 'react';
import {
  formatPlural,
  getLocale,
  getMessages,
  interpolate,
  messagesIn,
  useActiveLocale,
  useMessages,
  type Messages,
  type ResolvedCopy,
  type SupportedLocale,
} from '../../../shared/i18n';

type OmsOnboardingMessages = ResolvedCopy<Messages['oms-onboarding']>;

export interface WhatChangesItem {
  readonly title: string;
  readonly body: string;
}

export function buildOmsOnboardingCopy(m: OmsOnboardingMessages, locale: SupportedLocale) {
  const { step1, step2, step3, step4, status, stopDialog } = m;
  return {
    page: m.page,
    stepOf: (step: number, total: number): string => interpolate(m.stepOf, { step, total }),
    salesDocumentsStep: m.salesDocumentsStep,
    setupSteps: m.setupSteps,
    back: m.back,
    continue: m.continue,
    adminOnly: m.adminOnly,
    /** The created packing connection's name. Renamable on its connection page. */
    packingConnectionName: m.packingConnectionName,

    step1: {
      ...step1,
      partialBody: (name: string, missing: string): string =>
        interpolate(step1.partialBody, { name, missing }),
      tooManyBody: (count: number): string => formatPlural(count, step1.tooManyBody, locale),
      conflictBody: (name: string): string => interpolate(step1.conflictBody, { name }),
      failedStep: {
        connection: step1.failedStep.connection,
        location: step1.failedStep.location,
        override: (name: string): string => interpolate(step1.failedStep.override, { name }),
      },
      progressLabel: (names: string): string => interpolate(step1.progressLabel, { names }),
      progressCount: (located: string, total: string): string =>
        interpolate(step1.progressCount, { located, total }),
      syncingTitle: (names: string): string => interpolate(step1.syncingTitle, { names }),
      syncingBody: (total: string): string => interpolate(step1.syncingBody, { total }),
    },

    step2: {
      ...step2,
      createdTitle: (name: string): string => interpolate(step2.createdTitle, { name }),
      createdBody: (login: string): string => interpolate(step2.createdBody, { login }),
      listTitle: (count: number): string => interpolate(step2.listTitle, { count }),
    },

    step3: {
      ...step3,
      masterTodayOne: (name: string): string => interpolate(step3.masterTodayOne, { name }),
      benchBoxItems: [step3.benchBoxItems.newOrders, step3.benchBoxItems.inStock] as readonly string[],
      waitBoxItems: [step3.waitBoxItems.outOfStock, step3.waitBoxItems.noAddress] as readonly string[],
      sameBoxItems: (names: string): string[] => [
        interpolate(step3.sameBoxItems.ownStore, { names }),
        step3.sameBoxItems.marketplaceShips,
        interpolate(step3.sameBoxItems.alreadyIn, { names }),
      ],
      changes: (names: string): WhatChangesItem[] => [
        {
          title: step3.changes.stayInOpenLinker.title,
          body: interpolate(step3.changes.stayInOpenLinker.body, { names }),
        },
        step3.changes.labels,
        step3.changes.printing,
        step3.changes.allMarketplaces,
      ],
      ack: (names: string): string => interpolate(step3.ack, { names }),
    },

    step4: {
      ...step4,
      masters: (count: number): string => formatPlural(count, step4.masters, locale),
    },

    status: {
      ...status,
      onBody: (count: number, ago: string | null): string =>
        count === 0
          ? status.onBodyEmpty
          : formatPlural(count, status.onBodyCount, locale, {
              last: ago === null ? '' : interpolate(status.onBodyLast, { ago }),
            }),
      stepsLeft: (count: number): string => formatPlural(count, status.stepsLeft, locale),
      offBody: (names: string): string => interpolate(status.offBody, { names }),
      stockFrom: (located: string, total: string, names: string): string =>
        interpolate(status.stockFrom, { located, total, names }),
      arrivedTitle: (reference: string): string => interpolate(status.arrivedTitle, { reference }),
      arrivedMeta: (products: number, ago: string): string =>
        formatPlural(products, status.arrivedMeta, locale, { ago }),
      arrivedStock: (names: string): string => interpolate(status.arrivedStock, { names }),
    },

    stopDialog: {
      ...stopDialog,
      bodyNewOrders: (names: string): string => interpolate(stopDialog.bodyNewOrders, { names }),
      bodyExisting: (count: number): string =>
        count === 0 ? stopDialog.bodyExistingNone : formatPlural(count, stopDialog.bodyExisting, locale),
    },

    /** How the product masters are named in a sentence when there are two. */
    yourProductMasters: m.yourProductMasters,
    and: m.and,
  };
}

export type OmsOnboardingCopy = ReturnType<typeof buildOmsOnboardingCopy>;

/** The wording for an explicit language, outside React (tests). */
export function omsOnboardingCopyIn(locale: SupportedLocale): OmsOnboardingCopy {
  return buildOmsOnboardingCopy(messagesIn('oms-onboarding', locale), locale);
}

/**
 * The wording in the language the provider last set, outside React: mutation
 * hooks and zod schemas that read it when they run, not when their module loads.
 */
export function getOmsOnboardingCopy(): OmsOnboardingCopy {
  return buildOmsOnboardingCopy(getMessages('oms-onboarding'), getLocale());
}

export function useOmsOnboardingCopy(): OmsOnboardingCopy {
  const messages = useMessages('oms-onboarding');
  const locale = useActiveLocale();
  return useMemo(() => buildOmsOnboardingCopy(messages, locale), [messages, locale]);
}
