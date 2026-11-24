import { z } from 'zod';
import type { StartAllegroOAuthInput } from '../api/allegro.api';
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  wizardConfig,
  type DeliveryLineSuggestion,
  type DeliveryWizardValue,
} from '../../delivery-on-documents';
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

export type AllegroSetupSchemaCopy = ResolvedCopy<Messages['allegro-core']>['allegroSetupSchema'];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Built per render from the active language's copy: a module-level schema
 * would freeze its messages in the first language.
 */
export function createAllegroSetupSchema(copy: AllegroSetupSchemaCopy) {
  return z.object({
  name: z.string().trim().min(1, copy.nameRequired),
  environment: z.enum(['sandbox', 'production']),
  clientId: z.string().trim().min(1, copy.clientIdRequired),
  clientSecret: z.string().trim().min(1, copy.clientSecretRequired),
  // The <select> registers a string value (empty string when "None" is picked),
  // so the input type stays `string | undefined` and per-step `form.trigger`
  // can validate cleanly. The transform coerces the empty string to undefined
  // so the API payload never carries an empty UUID.
  masterCatalogConnectionId: z
    .string()
    .optional()
    .refine(
      (value) => !value || UUID_REGEX.test(value),
      copy.invalidConnectionId,
    )
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  // The answer to the "Sales documents" step. Structured state rather than a
  // registered input, so it is set through `setValue` (#3911).
  deliveryOnDocuments: z.custom<DeliveryWizardValue>().optional(),
  });
}

type AllegroSetupSchema = ReturnType<typeof createAllegroSetupSchema>;

export type AllegroSetupFormValues = z.input<AllegroSetupSchema>;
export type AllegroSetupFormSubmission = z.output<AllegroSetupSchema>;

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
