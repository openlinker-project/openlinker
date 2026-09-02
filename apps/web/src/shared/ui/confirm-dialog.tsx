import { useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './dialog';

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  /**
   * The dialog's accessible description. Rendered inside Radix's
   * `Dialog.Description`, which is a **`<p>`** — so this must be phrasing
   * content. Anything with a `<div>`, a list or a card in it belongs in `body`.
   */
  description: ReactNode;
  /**
   * Flow content rendered as a SIBLING of the description.
   *
   * It exists because a `<div>` inside the description's `<p>` is invalid
   * nesting: the parser closes the paragraph early, so the content escapes the
   * element Radix wires as `aria-describedby` and the dialog's accessible
   * description silently becomes whatever is left. Keep the one sentence that
   * must always be read in `description`, and put alerts, lists and generated
   * detail here.
   */
  body?: ReactNode;
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
  /**
   * Refuse the action outright, distinct from `isConfirming` (in flight).
   * Conflating the two would make "not allowed" and "already running" the same
   * state, and only one of them ever resolves.
   */
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  description,
  body,
  isConfirming = false,
  onConfirm,
  onOpenChange,
  open,
  title,
  tone = 'default',
  confirmDisabled = false,
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
        {body ? <div className="dialog__body">{body}</div> : null}
        <DialogFooter>
          <Button tone="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            tone={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={isConfirming || confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
