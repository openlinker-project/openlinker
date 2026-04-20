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
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
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
