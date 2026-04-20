import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
export const DropdownMenuGroup = RadixDropdownMenu.Group;
export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>
>(function DropdownMenuSeparator({ className = '', ...props }, ref) {
  const classes = ['dropdown-menu__separator', className].filter(Boolean).join(' ');
  return <RadixDropdownMenu.Separator ref={ref} className={classes} {...props} />;
});

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>
>(function DropdownMenuContent({ className = '', children, ...props }, ref) {
  const classes = ['dropdown-menu__content', className].filter(Boolean).join(' ');
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content ref={ref} className={classes} sideOffset={4} {...props}>
        {children}
      </RadixDropdownMenu.Content>
    </RadixDropdownMenu.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>
>(function DropdownMenuItem({ className = '', ...props }, ref) {
  const classes = ['dropdown-menu__item', className].filter(Boolean).join(' ');
  return <RadixDropdownMenu.Item ref={ref} className={classes} {...props} />;
});

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>
>(function DropdownMenuLabel({ className = '', ...props }, ref) {
  const classes = ['dropdown-menu__label', className].filter(Boolean).join(' ');
  return <RadixDropdownMenu.Label ref={ref} className={classes} {...props} />;
});
