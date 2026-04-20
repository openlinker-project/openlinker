import * as RadixTabs from '@radix-ui/react-tabs';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Tabs = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixTabs.Root>>(
  function Tabs({ className = '', ...props }, ref) {
    const classes = ['tabs', className].filter(Boolean).join(' ');
    return <RadixTabs.Root ref={ref} className={classes} {...props} />;
  },
);

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTabs.List>
>(function TabsList({ className = '', ...props }, ref) {
  const classes = ['tabs__list', className].filter(Boolean).join(' ');
  return <RadixTabs.List ref={ref} className={classes} {...props} />;
});

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(function TabsTrigger({ className = '', ...props }, ref) {
  const classes = ['tabs__trigger', className].filter(Boolean).join(' ');
  return <RadixTabs.Trigger ref={ref} className={classes} {...props} />;
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(function TabsContent({ className = '', ...props }, ref) {
  const classes = ['tabs__content', className].filter(Boolean).join(' ');
  return <RadixTabs.Content ref={ref} className={classes} {...props} />;
});
