/**
 * Login Stage
 *
 * The whole login screen (#4029): top bar, an optional background behind a
 * brand gradient, the hero and the auth card. The card's column reserves the
 * tallest view the card can show and centres the card in it, so the page
 * height never changes and the card's centre never moves.
 *
 * Presentational, so the admin's live preview (Settings > Login page) renders
 * exactly what visitors see. The background is passed in because the demo's
 * preview of the panel lives in `app/` (it imports the app shell).
 *
 * @module features/auth/components/login-stage
 */
import { motion, useReducedMotionConfig } from 'motion/react';
import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { AuthCard, type AuthCardProps } from './auth-card';
import { LoginGlow } from './login-glow';
import { LoginHero } from './login-hero';
import { LOGIN_STAGE_EASE } from './login-stage-motion';
import { LoginStageFooter, LoginTopBar } from './login-top-bar';
import { useBackdropParallax, useLoginPointer } from './use-login-parallax';

export interface LoginStageProps extends Omit<AuthCardProps, 'onReserve'> {
  /** The demo's blurred app preview; without it the stage shows the gradient only. */
  background?: ReactNode;
  /** Skip the card's entrance (the admin preview, or a step that keeps the same card). */
  animateEntrance?: boolean;
  className?: string;
}

export function LoginStage({
  background,
  animateEntrance = true,
  className,
  ...card
}: LoginStageProps): ReactElement {
  const [reserve, setReserve] = useState(0);
  const still = useReducedMotionConfig() ?? false;
  const pointer = useLoginPointer();
  const backdrop = useBackdropParallax(pointer);
  const classes = [
    'login-stage',
    background ? 'login-stage--app-preview' : 'login-stage--gradient',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const entrance = animateEntrance
    ? {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6, ease: LOGIN_STAGE_EASE, delay: 0.2 },
      }
    : {};
  return (
    <div className={classes}>
      {background ? (
        // Outer layer: the live tilt. Inner layer: a one-off settle (the screen
        // swings up from a deeper lean), so the two transforms never collide.
        <motion.div className="login-stage__bg" style={backdrop}>
          <motion.div
            className="login-stage__bg-settle"
            initial={
              still || !animateEntrance
                ? false
                : { opacity: 0, rotateX: 24, scale: 1.08, transformPerspective: 1400 }
            }
            animate={{ opacity: 1, rotateX: 0, scale: 1, transformPerspective: 1400 }}
            transition={{ duration: 1.8, ease: LOGIN_STAGE_EASE }}
          >
            {background}
          </motion.div>
        </motion.div>
      ) : null}
      <div className="login-stage__wash" aria-hidden="true" />
      <LoginGlow pointer={pointer} />
      <LoginTopBar bar={card.copy.bar} />
      <div className="login-stage__inner">
        <LoginHero copy={card.copy} />
        <div
          className="login-stage__auth-col"
          style={
            reserve ? ({ '--login-auth-reserve': `${reserve}px` } as CSSProperties) : undefined
          }
        >
          <motion.section className="auth-card" aria-label={card.copy.login.title} {...entrance}>
            <AuthCard {...card} onReserve={setReserve} />
          </motion.section>
        </div>
        <LoginStageFooter bar={card.copy.bar} />
      </div>
    </div>
  );
}
