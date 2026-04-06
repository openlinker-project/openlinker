import { z } from 'zod';
import type { StartAllegroOAuthInput } from '../api/allegro.api';

export const allegroSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  environment: z.enum(['sandbox', 'production']),
  clientId: z.string().trim().min(1, 'Client ID is required'),
  clientSecret: z.string().trim().min(1, 'Client secret is required'),
});

export type AllegroSetupFormValues = z.input<typeof allegroSetupSchema>;
export type AllegroSetupFormSubmission = z.output<typeof allegroSetupSchema>;

export const ALLEGRO_SETUP_DEFAULT_VALUES: AllegroSetupFormValues = {
  name: '',
  environment: 'sandbox',
  clientId: '',
  clientSecret: '',
};

export function toStartOAuthInput(
  values: AllegroSetupFormSubmission,
  redirectUri: string,
): StartAllegroOAuthInput {
  return {
    clientId: values.clientId,
    clientSecret: values.clientSecret,
    redirectUri,
    environment: values.environment,
    connectionName: values.name,
  };
}
