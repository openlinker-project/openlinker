import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Auto-unmount rendered components after every test. Without this, components
// leak across tests within a file and their `useEffect` cleanups never run —
// notably Radix Toast's `ToastAnnounce` schedules a 1-second `window.setTimeout`
// (`@radix-ui/react-toast/dist/index.mjs:477`) that fires after happy-dom is
// torn down, surfacing as an unhandled "ReferenceError: window is not defined"
// that fails CI even when every assertion passes. RTL only registers this
// hook automatically when `globals: true` is set in the vitest config; we
// don't use globals, so we register it explicitly here.
afterEach(() => {
  cleanup();
});

// happy-dom (and jsdom) do not fully implement HTMLDialogElement.showModal / .close
// with proper focus management. These stubs mirror the browser behaviours that our
// components rely on in tests:
//   showModal — marks the dialog open and remembers the previously-focused element
//   close     — closes the dialog and restores focus (matching native browser behaviour)
const previouslyFocused = new WeakMap<HTMLDialogElement, HTMLElement | null>();

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
  previouslyFocused.set(
    this,
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  this.setAttribute('open', '');
};

HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
  this.removeAttribute('open');
  previouslyFocused.get(this)?.focus();
};

// ────────────────────────────────────────────────────────────────────
// Layout dimensions stub
//
// happy-dom does not compute layout — every element's clientHeight /
// offsetHeight / clientWidth / offsetWidth is 0. TanStack Virtual reads
// clientHeight from its scroll element to decide which rows to render,
// so the virtualized DataTable body comes back empty in tests.
//
// These stubs return a fixed 800 px on every element so virtualization
// yields rows and any other layout-dependent code gets sensible
// defaults. Consequence: tests asserting "element has zero size" will
// see 800 and may behave unexpectedly — scope such assertions with
// `vi.spyOn(el, 'clientHeight').mockReturnValue(0)` inside the test
// when needed. No existing test depends on observing zero dimensions.
// ────────────────────────────────────────────────────────────────────
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 800;
  },
});
