import { z } from 'zod';

const envSchema = z.object({
  VITE_API_BASE_URL: z.url(),
  VITE_APP_ENV: z.string().min(1),
  // Not validated against the supported list here: an unsupported value must
  // fall back to the same default as an unset one (ADR-081), not fail the
  // whole app at boot.
  VITE_DEFAULT_UI_LOCALE: z.string(),
});

export const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV ?? 'development',
  // Used only when the browser asks for no shipped language (#3890); English is
  // the last resort. `||`, not `??`: a blank build arg or `.env` line arrives as
  // '' and must mean "unset".
  VITE_DEFAULT_UI_LOCALE: import.meta.env.VITE_DEFAULT_UI_LOCALE || 'en',
});
