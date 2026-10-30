import { z } from 'zod';
import type { StartAllegroOAuthInput } from '../api/allegro.api';
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  wizardConfig,
  type DeliveryLineSuggestion,
  type DeliveryWizardValue,
} from '../../delivery-on-documents';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const allegroSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  environment: z.enum(['sandbox', 'production']),
  clientId: z.string().trim().min(1, 'Client ID is required'),
  clientSecret: z.string().trim().min(1, 'Client secret is required'),
  // The <select> registers a string value (empty string when "None" is picked),
  // so the input type stays `string | undefined` and per-step `form.trigger`
  // can validate cleanly. The transform coerces the empty string to undefined
  // so the API payload never carries an empty UUID.
  masterCatalogConnectionId: z
    .string()
    .optional()
    .refine(
      (value) => !value || UUID_REGEX.test(value),
      'Invalid connection ID',
    )
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  // The answer to the "Sales documents" step. Structured state rather than a
  // registered input, so it is set through `setValue` (#3911).
  deliveryOnDocuments: z.custom<DeliveryWizardValue>().optional(),
});

export type AllegroSetupFormValues = z.input<typeof allegroSetupSchema>;
export type AllegroSetupFormSubmission = z.output<typeof allegroSetupSchema>;

export const ALLEGRO_SETUP_DEFAULT_VALUES: AllegroSetupFormValues = {
  name: '',
  environment: 'sandbox',
  clientId: '',
  clientSecret: '',
  masterCatalogConnectionId: '',
  deliveryOnDocuments: DEFAULT_DELIVERY_WIZARD_VALUE,
};

export function toStartOAuthInput(
  values: AllegroSetupFormSubmission,
  redirectUri: string,
  reauthConnectionId?: string,
  suggestions: readonly DeliveryLineSuggestion[] = [],
): StartAllegroOAuthInput {
  return {
    clientId: values.clientId,
    clientSecret: values.clientSecret,
    redirectUri,
    environment: values.environment,
    connectionName: values.name,
    ...(values.masterCatalogConnectionId
      ? { masterCatalogConnectionId: values.masterCatalogConnectionId }
      : {}),
    ...(reauthConnectionId ? { connectionId: reauthConnectionId } : {}),
    // A reauth only rotates credentials; it must not carry config (#3911).
    ...(reauthConnectionId
      ? {}
      : {
          deliveryOnDocuments: wizardConfig(
            values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE,
            suggestions,
          ),
        }),
  };
}
