/**
 * MotionProvider
 *
 * App-wide Motion settings. Every animation honours the operator's
 * `prefers-reduced-motion` setting. The only place outside a primitive that
 * touches Motion, per the headless-library policy.
 *
 * @module shared/ui
 */
import { MotionConfig } from 'motion/react';
import type { PropsWithChildren, ReactElement } from 'react';

export function MotionProvider({ children }: PropsWithChildren): ReactElement {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
