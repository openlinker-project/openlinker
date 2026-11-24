/**
 * PrestaShop Connection-Config Contribution
 *
 * The non-render half of the PrestaShop fields that are not host-level:
 * `defaultTaxRulesGroupId`, the tax-rule group a published product takes when
 * its master catalogue holds no tax rate (a marketplace master such as Empik
 * reports none). The API's product publisher uses it only then, so it never
 * overrides a catalogue rate.
 *
 * CLEARING WRITES `null`, NOT A DELETED KEY: the host submit merges
 * `{ ...fresh.config, ...input.config }` shallowly, so a deleted top-level key
 * would come back from the refetch. The API reads `null` like absent.
 *
 * @module plugins/prestashop
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readOptionalConfigString } from '../../shared/plugins';
import { getPrestashopMessages } from './messages';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** `config.defaultTaxRulesGroupId` as a whole number, `''` for none. */
    prestashopDefaultTaxRulesGroupId?: string;
  }
}

const WHOLE_NUMBER = /^\d+$/;

// Annotated so TS keeps the excess-property check live (the KSeF precedent).
const prestashopSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  prestashopDefaultTaxRulesGroupId: z
    .string()
    // The message is looked up when a value is validated, so it follows the
    // active language instead of freezing at module load.
    .refine((value) => value.trim() === '' || WHOLE_NUMBER.test(value.trim()), {
      error: () => getPrestashopMessages().connectionConfig.defaultTaxGroupInvalid,
    })
    .optional(),
};

function readPrestashopConfig(config: Record<string, unknown>): Record<string, string> {
  const group = config.defaultTaxRulesGroupId;
  return {
    prestashopDefaultTaxRulesGroupId:
      typeof group === 'number' && Number.isInteger(group) && group >= 0
        ? String(group)
        : typeof group === 'string' && WHOLE_NUMBER.test(group.trim())
          ? group.trim()
          : '',
  };
}

function applyPrestashopConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  const group = readOptionalConfigString(patch, 'prestashopDefaultTaxRulesGroupId');
  if (group !== undefined) {
    const text = group.trim();
    next.defaultTaxRulesGroupId = WHOLE_NUMBER.test(text) ? Number.parseInt(text, 10) : null;
  }
  return next;
}

export const prestashopConnectionConfig: ConnectionConfigContribution = {
  schemaShape: prestashopSchemaShape,
  readConfigToForm: readPrestashopConfig,
  applyToConfig: applyPrestashopConfig,
};
