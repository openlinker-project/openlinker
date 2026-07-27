import { useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './dialog';

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
  /** Extra class on the content card (e.g. `dialog__content--elevated` when opened over another dialog). */
  className?: string;
  /** Extra class on the scrim (e.g. `dialog__overlay--elevated` for a nested dialog). */
  overlayClassName?: string;
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
  className,
  overlayClassName,
}: ConfirmDialogProps): ReactElement {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={className}
        overlayClassName={overlayClassName}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
