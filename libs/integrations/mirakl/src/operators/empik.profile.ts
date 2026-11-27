/**
 * Empik Operator Profile
 *
 * Empik Marketplace (EmpikPlace) runs Mirakl; this profile is everything the
 * shared Mirakl plugin needs to know about it today. Both hosts were verified
 * live during SPIKE-4268: production answers `/api/version`, and a staging shop
 * key answers A01 on `stg1` and 401 on production.
 *
 * @module libs/integrations/mirakl/src/operators
 */
import type { MiraklOperatorProfile } from '../domain/types/mirakl-operator-profile.types';
import { EMPIK_ADAPTER_KEY } from '../mirakl.constants';

export const empikOperatorProfile: MiraklOperatorProfile = {
  adapterKey: EMPIK_ADAPTER_KEY,
  platformType: 'empik',
  displayName: 'Empik Marketplace',
  brand: 'Empik',
  version: '0.1.0',
  baseUrls: {
    production: 'https://marketplace.empik.com',
    staging: 'https://stg1.marketplace.empik.com',
  },
  // DO01 on staging (2026-11-23): `CUSTOMER_INVOICE` ("Faktura"), entity ORDER.
  invoiceDocumentTypeCode: 'CUSTOMER_INVOICE',
  taxonomyOwners: { production: 'empik', staging: 'empik:staging' },
  // RE02 REFUND on staging (2026-11-24): 15 agreed with the customer (out of
  // stock), 16 cancelled before shipping, 17 returned without a reason,
  // 18 not collected, REFUND_21 damaged, REFUND_22 not as described.
  refundReasonCodes: {
    withdrawal: '17',
    defective: 'REFUND_21',
    not_as_described: 'REFUND_22',
    wrong_item: 'REFUND_22',
    other: '17',
  },
  // PM11 on staging (2026-11-26, category Aparaty dla dzieci and SPIKE-4268).
  cardAttributes: {
    category: 'STR_GOLD',
    catalogCode: 'CATALOG_CODE',
    // Empik refused a longer one on staging (import 30572, 2026-11-26).
    catalogCodeMaxLength: 26,
    title: 'PELNY_TYTUL',
    description: 'OPIS_PRODUKTU_PELNY',
    ean: 'EAN',
    mainImage: 'ZDJECIE_OKLADKI_PRZOD_DUZY',
    extraImagePrefix: 'DODATKOWE_ZDJECIA_',
    extraImageCount: 10,
    vat: 'VAT_VALUE',
    variantGroup: 'VARIANT_GROUP_MKPL',
    bundle: '650',
    bundleContents: 'ADRU',
    packQuantity: '2039',
  },
};
