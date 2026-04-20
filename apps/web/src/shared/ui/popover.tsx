import * as RadixPopover from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;
export const PopoverAnchor = RadixPopover.Anchor;

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixPopover.Content>
>(function PopoverContent({ className = '', sideOffset = 6, children, ...props }, ref) {
  const classes = ['popover__content', className].filter(Boolean).join(' ');
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content ref={ref} className={classes} sideOffset={sideOffset} {...props}>
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
});
