import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { popoverEntrance } from './motion-presets';

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
export const DropdownMenuGroup = RadixDropdownMenu.Group;
export const DropdownMenuSub = RadixDropdownMenu.Sub;

/** A menu row that opens a nested panel; carries a chevron on its end. */
export const DropdownMenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubTrigger>
>(function DropdownMenuSubTrigger({ className = '', children, ...props }, ref) {
  const classes = ['dropdown-menu__item', 'dropdown-menu__sub-trigger', className]
    .filter(Boolean)
    .join(' ');
  return (
    <RadixDropdownMenu.SubTrigger ref={ref} className={classes} {...props}>
      {children}
      <svg
        className="dropdown-menu__sub-chevron"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path
          d="M6 3.5L10.5 8L6 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </RadixDropdownMenu.SubTrigger>
  );
});

/**
 * The nested panel; portalled, so it escapes the parent's clipping. It is
 * placed against the trigger ROW, which sits inset from the menu's edge, so the
 * offsets clear that inset and line its top up with the row.
 */
export const DropdownMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.SubContent>
>(function DropdownMenuSubContent({ className = '', ...props }, ref) {
  const classes = ['dropdown-menu__content', 'dropdown-menu__sub-content', className]
    .filter(Boolean)
    .join(' ');
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.SubContent
        ref={ref}
        className={classes}
        sideOffset={14}
        alignOffset={-8}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
});
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

export interface DropdownMenuAnimatedContentProps
  extends Omit<ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>, 'forceMount' | 'asChild'> {
  /** Controlled open state of the parent `DropdownMenu`; needed to play the exit. */
  open: boolean;
}

/**
 * Menu content that opens and closes with the same entrance as `MotionPopover`.
 * The parent `DropdownMenu` must be controlled so `AnimatePresence` can keep
 * the panel mounted while it plays the exit.
 */
export const DropdownMenuAnimatedContent = forwardRef<
  HTMLDivElement,
  DropdownMenuAnimatedContentProps
>(function DropdownMenuAnimatedContent({ className = '', children, open, ...props }, ref) {
  const classes = ['dropdown-menu__content', className].filter(Boolean).join(' ');
  return (
    <AnimatePresence>
      {open ? (
        <RadixDropdownMenu.Portal forceMount>
          <RadixDropdownMenu.Content ref={ref} asChild forceMount sideOffset={4} {...props}>
            <motion.div
              className={classes}
              style={{ transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)' }}
              {...popoverEntrance(true)}
            >
              {children}
            </motion.div>
          </RadixDropdownMenu.Content>
        </RadixDropdownMenu.Portal>
      ) : null}
    </AnimatePresence>
  );
});
