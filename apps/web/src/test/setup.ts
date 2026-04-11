import '@testing-library/jest-dom/vitest';

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
