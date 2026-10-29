/**
 * Locale-keyed subtree
 *
 * Remounts its children when the language changes. A formatter called
 * without a locale reads the active language at call time, so a memoised row
 * or a `useMemo`-cached string would otherwise keep the old language after a
 * switch. Switching is rare, so a remount of the routed tree is the cheap,
 * complete answer; providers above it (query cache, session) are kept.
 *
 * The cost: component state below it is lost on a switch, so an open modal or
 * an unsaved form is discarded. There is no generic "dirty" signal to guard
 * on, and a remount is what makes every cached string refresh; keeping the
 * switch itself and its focus alive across it is the switch's job.
  *
 * @module shared/i18n
 */
import { Fragment, type PropsWithChildren, type ReactElement } from 'react';
import { useLocale } from './use-locale';

export function LocaleKeyed({ children }: PropsWithChildren): ReactElement {
  const { locale } = useLocale();
  return <Fragment key={locale}>{children}</Fragment>;
}
