import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description: ReactNode;
  isConfirming?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
  tone?: 'default' | 'danger';
}

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  description,
  isConfirming = false,
  onConfirm,
  onOpenChange,
  open,
  title,
  tone = 'default',
}: ConfirmDialogProps): ReactElement | null {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus();

    const getFocusableElements = (): HTMLElement[] => {
      if (!dialogRef.current) {
        return [];
      }

      const focusableSelector = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      return Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('aria-hidden'),
      );
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      lastFocusedElementRef.current?.focus();
    };
  }, [onOpenChange, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dialog"
        role="dialog"
      >
        <div className="dialog__header">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
        </div>
        <div id={descriptionId} className="dialog__body">
          {description}
        </div>
        <div className="dialog__actions">
          <Button tone="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button ref={confirmButtonRef} tone={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={isConfirming}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
