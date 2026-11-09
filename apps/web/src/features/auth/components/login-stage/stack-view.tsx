/**
 * Stack View and Success Check
 *
 * `StackView` is one view of the auth card's stack. Inactive views stay
 * mounted (they hold the height the column reserves) but are hidden and
 * inert. `SuccessCheck` settles in and draws its tick whenever its view
 * activates (#4029).
 *
 * @module features/auth/components/login-stage
 */
import { motion, useReducedMotion } from 'motion/react';
import type { ReactElement, ReactNode, Ref } from 'react';
import { LOGIN_STAGE_EASE, LOGIN_STAGE_SPRING } from './login-stage-motion';

interface StackViewProps {
  active: boolean;
  /** A finished step: centred, since there is nothing to read left to right. */
  centered?: boolean;
  nodeRef: Ref<HTMLDivElement>;
  name: string;
  children: ReactNode;
}

export function StackView({
  active,
  centered = false,
  nodeRef,
  name,
  children,
}: StackViewProps): ReactElement {
  return (
    <motion.div
      ref={nodeRef}
      className={centered ? 'auth-card__view auth-card__view--center' : 'auth-card__view'}
      data-view={name}
      aria-hidden={!active}
      inert={!active}
      initial={false}
      animate={{ opacity: active ? 1 : 0, y: active ? 0 : 6 }}
      transition={{
        duration: active ? 0.26 : 0.14,
        ease: LOGIN_STAGE_EASE,
        delay: active ? 0.06 : 0,
      }}
    >
      {children}
    </motion.div>
  );
}

export function SuccessCheck({ active }: { active: boolean }): ReactElement {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      className="auth-card__check"
      viewBox="0 0 48 48"
      aria-hidden="true"
      initial={false}
      animate={active && !reduce ? { scale: [0.6, 1], opacity: [0, 1] } : { scale: 1, opacity: 1 }}
      transition={LOGIN_STAGE_SPRING}
    >
      <circle
        cx="24"
        cy="24"
        r="23"
        fill="var(--status-success-soft)"
        stroke="var(--status-success-border)"
      />
      <motion.path
        d="M15 24.5l6 6 12-13"
        fill="none"
        stroke="var(--status-success-strong)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: active || reduce ? 1 : 0 }}
        transition={{ duration: 0.45, ease: LOGIN_STAGE_EASE, delay: active ? 0.25 : 0 }}
      />
    </motion.svg>
  );
}
