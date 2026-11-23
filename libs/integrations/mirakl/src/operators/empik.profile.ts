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
};
