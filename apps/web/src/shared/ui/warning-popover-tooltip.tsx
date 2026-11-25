/**
 * WarningPopoverTooltip
 *
 * `IconWithOnHoverPopoverTooltip` with the warning triangle and the warning
 * tone filled in: the mark that says "read this before you go on" and opens a
 * short explanation on hover, focus or tap.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';
import {
  IconWithOnHoverPopoverTooltip,
  type IconWithOnHoverPopoverTooltipProps,
} from './icon-with-popover-tooltip';
import { WarningIcon } from './icons';

export type WarningPopoverTooltipProps = Omit<IconWithOnHoverPopoverTooltipProps, 'icon' | 'tone'>;

export function WarningPopoverTooltip(props: WarningPopoverTooltipProps): ReactElement {
  return <IconWithOnHoverPopoverTooltip {...props} icon={<WarningIcon />} tone="warning" />;
}
