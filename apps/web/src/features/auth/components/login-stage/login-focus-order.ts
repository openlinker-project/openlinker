/**
 * Login Form Focus Order
 *
 * Tab through the sign-in form goes: username, password, the sign-in button,
 * then "Show" and "Forgot your password?" (#4029). The two password helpers
 * sit inside the password field in the DOM, so the order is applied by
 * moving focus on Tab rather than by rearranging the markup. Before the
 * first stop and after the last one, Tab behaves as usual.
 *
 * @module features/auth/components/login-stage
 */
import type { KeyboardEvent } from 'react';

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isReachable(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.tabIndex >= 0 &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]')
  );
}

/** The sign-in form's stops, in the order Tab visits them. */
export function loginFocusStops(form: HTMLFormElement): HTMLElement[] {
  const inputs = Array.from(form.querySelectorAll('input'));
  const candidates = [
    inputs[0],
    inputs[1],
    form.querySelector('button[type="submit"]'),
    form.querySelector('.password-input__toggle'),
    form.querySelector('.auth-field__aside a'),
  ];
  return candidates.filter(
    (element): element is HTMLElement =>
      element !== null && element !== undefined && isReachable(element)
  );
}

/**
 * The first tab stop after the form, or the first on the page when nothing
 * follows it: the browser would otherwise step back to a stop inside it.
 */
function nextAfter(form: HTMLFormElement): HTMLElement | null {
  const all = Array.from(document.querySelectorAll(TABBABLE)).filter(isReachable);
  const after = all.find(
    (element) =>
      !form.contains(element) &&
      Boolean(form.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
  );
  return after ?? all[0] ?? null;
}

/** `onKeyDown` for the sign-in form: applies the stop order on Tab. */
export function handleLoginFormTab(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const form = event.currentTarget;
  const stops = loginFocusStops(form);
  const index = stops.indexOf(event.target as HTMLElement);
  if (index === -1) return;
  const step = event.shiftKey ? -1 : 1;
  const target = stops[index + step];
  if (target) {
    event.preventDefault();
    target.focus();
    return;
  }
  if (step === 1) {
    // Past the last stop: leave the form, not back to a stop inside it.
    const after = nextAfter(form);
    if (after) {
      event.preventDefault();
      after.focus();
    }
  }
}
