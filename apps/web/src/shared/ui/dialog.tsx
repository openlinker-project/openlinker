import * as RadixDialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogPortal = RadixDialog.Portal;

type DialogContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  overlayClassName?: string;
};

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { children, className = '', overlayClassName = '', ...props },
  ref,
) {
  const contentClasses = ['dialog__content', className].filter(Boolean).join(' ');
  const overlayClasses = ['dialog__overlay', overlayClassName].filter(Boolean).join(' ');

  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={overlayClasses} />
      <RadixDialog.Content ref={ref} className={contentClasses} {...props}>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
});

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(function DialogTitle({ className = '', ...props }, ref) {
  const classes = ['dialog__title', className].filter(Boolean).join(' ');
  return <RadixDialog.Title ref={ref} className={classes} {...props} />;
});

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(function DialogDescription({ className = '', ...props }, ref) {
  const classes = ['dialog__description', className].filter(Boolean).join(' ');
  return <RadixDialog.Description ref={ref} className={classes} {...props} />;
});

export function DialogFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  const classes = ['dialog__footer', className].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
