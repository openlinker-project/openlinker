/**
 * Login Stage Motion
 *
 * The easing and spring the login stage shares, so every transition on the
 * page moves the same way (#4029).
 *
 * @module features/auth/components/login-stage
 */
export const LOGIN_STAGE_EASE = [0.22, 1, 0.36, 1] as const;

export const LOGIN_STAGE_SPRING = { type: 'spring', bounce: 0, visualDuration: 0.3 } as const;
