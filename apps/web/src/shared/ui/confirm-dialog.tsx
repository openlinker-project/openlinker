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
}: ConfirmDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // showModal/close handle focus trapping, Escape key, and focus restoration natively
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      confirmButtonRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Intercept the native cancel event (fired on Escape) to keep controlled state in sync
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event): void => {
      event.preventDefault();
      onOpenChange(false);
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onOpenChange]);

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="dialog"
      onClick={(event) => {
        // Close when clicking the backdrop (the dialog element itself, not its children)
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
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
        <Button
          ref={confirmButtonRef}
          tone={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={isConfirming}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
