/**
 * Shipping setup wording (#3958)
 *
 * The OMS setup's Shipping step and the Shipping row of the packing status,
 * in the active language. The sentences live in the `omsOnboarding` namespace
 * of the locale files (ADR-081); this module picks the plural form a count
 * needs and fills the names, so neither component builds a sentence out of
 * English pieces.
 *
 * @module features/oms-onboarding/hooks
 */
import { useMemo } from 'react';
import {
  formatPlural,
  interpolate,
  messagesIn,
  useActiveLocale,
  useMessages,
  type Messages,
  type ResolvedCopy,
  type SupportedLocale,
} from '../../../shared/i18n';

type OmsOnboardingMessages = ResolvedCopy<Messages['oms-onboarding']>;

export interface ShippingStepCopy {
  readonly why: string;
  readonly routesTitle: string;
  readonly routesLead: string;
  readonly noCarrierTitle: string;
  readonly noCarrierBody: string;
  readonly connectCarrier: string;
  readonly noSourcesBody: string;
  readonly checking: string;
  readonly coverage: (withCarrier: number, total: number) => string;
  readonly coverageUnknown: string;
  readonly cannotList: string;
  readonly loadFailed: string;
  readonly retry: string;
  readonly badge: {
    readonly todo: string;
    readonly partly: string;
    readonly all: string;
    readonly noLabels: string;
  };
  readonly expand: (name: string) => string;
  readonly autoTitle: string;
  readonly autoLocked: string;
  readonly autoLead: (withCarrier: number, total: number) => string;
  readonly autoGroupLabel: string;
  readonly noTitle: string;
  readonly noBody: string;
  readonly yesTitle: string;
  readonly yesBody: string;
  readonly defaultsTitle: string;
  readonly defaultsLead: string;
  readonly weightDescription: string;
  readonly weightRequired: string;
  readonly fromNow: (methods: number, parcel: string | null) => string;
  readonly saveAndContinue: string;
  readonly saving: string;
  readonly saveFailedTitle: string;
  readonly unsavedTitle: (name: string) => string;
  readonly unsavedBody: string;
  readonly goBackAndSave: string;
  readonly continueWithoutSaving: string;
}

export interface ShippingStatusCopy {
  readonly title: string;
  readonly on: (withCarrier: number, total: number) => string;
  readonly off: (withCarrier: number, total: number) => string;
  readonly none: string;
  readonly unknown: string;
  readonly change: string;
  readonly stop: string;
  readonly start: string;
  readonly stopTitle: string;
  readonly stopBody: string;
  readonly stopCancel: string;
  readonly stopping: string;
  readonly stopFailedTitle: string;
}

export function buildShippingStepCopy(
  m: OmsOnboardingMessages['shippingStep'],
  locale: SupportedLocale
): ShippingStepCopy {
  return {
    why: m.why,
    routesTitle: m.routesTitle,
    routesLead: m.routesLead,
    noCarrierTitle: m.noCarrierTitle,
    noCarrierBody: m.noCarrierBody,
    connectCarrier: m.connectCarrier,
    noSourcesBody: m.noSourcesBody,
    checking: m.checking,
    coverage: (withCarrier, total) => formatPlural(total, m.coverage, locale, { withCarrier }),
    coverageUnknown: m.coverageUnknown,
    cannotList: m.cannotList,
    loadFailed: m.loadFailed,
    retry: m.retry,
    badge: m.badge,
    expand: (name) => interpolate(m.expand, { name }),
    autoTitle: m.autoTitle,
    autoLocked: m.autoLocked,
    autoLead: (withCarrier, total) => formatPlural(total, m.autoLead, locale, { withCarrier }),
    autoGroupLabel: m.autoGroupLabel,
    noTitle: m.noTitle,
    noBody: m.noBody,
    yesTitle: m.yesTitle,
    yesBody: m.yesBody,
    defaultsTitle: m.defaultsTitle,
    defaultsLead: m.defaultsLead,
    weightDescription: m.weightDescription,
    weightRequired: m.weightRequired,
    // The parcel clause is its own sentence part because it is optional; the
    // plural is on the method count, which decides "that method" / "those N".
    fromNow: (methods, parcel) =>
      formatPlural(methods, m.fromNow, locale, {
        parcel: parcel === null ? '' : interpolate(m.fromNowParcel, { parcel }),
      }),
    saveAndContinue: m.saveAndContinue,
    saving: m.saving,
    saveFailedTitle: m.saveFailedTitle,
    unsavedTitle: (name) => interpolate(m.unsavedTitle, { name }),
    unsavedBody: m.unsavedBody,
    goBackAndSave: m.goBackAndSave,
    continueWithoutSaving: m.continueWithoutSaving,
  };
}

export function buildShippingStatusCopy(
  m: OmsOnboardingMessages['shippingStatus'],
  locale: SupportedLocale
): ShippingStatusCopy {
  return {
    title: m.title,
    on: (withCarrier, total) => formatPlural(total, m.on, locale, { withCarrier }),
    off: (withCarrier, total) => formatPlural(total, m.off, locale, { withCarrier }),
    none: m.none,
    unknown: m.unknown,
    change: m.change,
    stop: m.stop,
    start: m.start,
    stopTitle: m.stopTitle,
    stopBody: m.stopBody,
    stopCancel: m.stopCancel,
    stopping: m.stopping,
    stopFailedTitle: m.stopFailedTitle,
  };
}

/** The step's wording for an explicit language, outside React (tests). */
export function shippingStepCopyIn(locale: SupportedLocale): ShippingStepCopy {
  return buildShippingStepCopy(messagesIn('oms-onboarding', locale).shippingStep, locale);
}

/** The status row's wording for an explicit language, outside React (tests). */
export function shippingStatusCopyIn(locale: SupportedLocale): ShippingStatusCopy {
  return buildShippingStatusCopy(messagesIn('oms-onboarding', locale).shippingStatus, locale);
}

export function useShippingStepCopy(): ShippingStepCopy {
  const messages = useMessages('oms-onboarding').shippingStep;
  const locale = useActiveLocale();
  return useMemo(() => buildShippingStepCopy(messages, locale), [messages, locale]);
}

export function useShippingStatusCopy(): ShippingStatusCopy {
  const messages = useMessages('oms-onboarding').shippingStatus;
  const locale = useActiveLocale();
  return useMemo(() => buildShippingStatusCopy(messages, locale), [messages, locale]);
}
