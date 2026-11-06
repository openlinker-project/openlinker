/**
 * Login Glow
 *
 * The brand light behind the login stage (#4029): two soft orbs of the accent
 * colour, bottom left and behind the form, that breathe slowly (CSS keyframes,
 * out of step) and lean a little towards the pointer. They lean by different
 * amounts, which reads as depth rather than the whole background sliding.
 *
 * Two layers per orb on purpose: the outer one carries the pointer offset
 * (motion values, no re-render per mouse move), the inner one the CSS drift,
 * so the two transforms never overwrite each other.
 *
 * Still under reduced motion, in the admin's preview (it renders inside
 * `MotionConfig reducedMotion="always"`) and on touch screens, where there is
 * no pointer to follow.
 *
 * @module features/auth/components/login-stage
 */
import {
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect, type ReactElement } from 'react';

/** Soft follow: the light trails the pointer instead of snapping to it. */
const FOLLOW = { stiffness: 30, damping: 20, mass: 1 } as const;

const ORBS = [
  // Bottom left, the stronger one; leans with the pointer.
  { key: 'a', depth: { x: 14, y: 10 } },
  // Behind the form; leans the other way, just enough to read as depth.
  { key: 'b', depth: { x: -8, y: -6 } },
] as const;

function Orb({
  name,
  depth,
  pointerX,
  pointerY,
}: {
  name: string;
  depth: { x: number; y: number };
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
}): ReactElement {
  const x = useTransform(pointerX, (v) => v * depth.x);
  const y = useTransform(pointerY, (v) => v * depth.y);
  return (
    <motion.div className={`login-glow__lean login-glow__lean--${name}`} style={{ x, y }}>
      <div className={`login-glow__orb login-glow__orb--${name}`} />
    </motion.div>
  );
}

export function LoginGlow(): ReactElement {
  const still = useReducedMotionConfig() ?? false;
  // -1..1 from the viewport centre.
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const pointerX = useSpring(rawX, FOLLOW);
  const pointerY = useSpring(rawY, FOLLOW);

  useEffect(() => {
    if (still || typeof window === 'undefined') return undefined;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const onMove = (event: PointerEvent): void => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1);
      rawY.set((event.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = (): void => {
      rawX.set(0);
      rawY.set(0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [still, rawX, rawY]);

  return (
    <div
      className={['login-glow', still ? 'login-glow--still' : ''].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {ORBS.map((orb) => (
        <Orb
          key={orb.key}
          name={orb.key}
          depth={orb.depth}
          pointerX={pointerX}
          pointerY={pointerY}
        />
      ))}
    </div>
  );
}
