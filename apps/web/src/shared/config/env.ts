import { z } from 'zod';

const envSchema = z.object({
  VITE_API_BASE_URL: z.url(),
  VITE_APP_ENV: z.string().min(1),
});

export const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV ?? 'development',
});
