import * as RadixTooltip from '@radix-ui/react-tooltip';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

interface TooltipProviderProps extends ComponentPropsWithoutRef<typeof RadixTooltip.Provider> {
  children: ReactNode;
}

export function TooltipProvider({
  children,
  delayDuration = 250,
  ...props
}: TooltipProviderProps): React.ReactElement {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} {...props}>
      {children}
    </RadixTooltip.Provider>
  );
}

export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(function TooltipContent({ className = '', sideOffset = 6, children, ...props }, ref) {
  const classes = ['tooltip__content', className].filter(Boolean).join(' ');
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content ref={ref} className={classes} sideOffset={sideOffset} {...props}>
        {children}
        <RadixTooltip.Arrow className="tooltip__arrow" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
});
