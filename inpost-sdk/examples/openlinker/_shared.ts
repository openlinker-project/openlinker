/**
 * Shared wiring + fixtures for the OpenLinker-simulation examples.
 *
 * Builds the prototype `InpostShippingAdapter` (over the fetch-based SDK) the
 * same way OpenLinker's DI would, and provides sample order/recipient data so
 * each example reads like a slice of the real dispatch/status-sync services.
 */

import { createInpostShipXClient, INPOST_SHIPX_SANDBOX_BASE_URL } from '../../src/index.ts';
import { InpostShippingAdapter } from '../../openlinker/inpost-shipping.adapter.ts';
import type {
  InpostConnectionConfig,
  ShipmentRecipient,
  ShipmentAddress,
} from '../../openlinker/ol-shipping.types.ts';

export function requireToken(): string {
  const token = process.env.INPOST_TOKEN;
  if (!token) {
    console.error('Missing INPOST_TOKEN env var.');
    process.exit(1);
  }
  return token;
}

/** Stand-in for the InPost shipping-provider connection's config in OpenLinker. */
export const CONNECTION_CONFIG: InpostConnectionConfig = {
  environment: 'sandbox',
  organizationId: process.env.INPOST_ORG_ID ?? '6485',
  senderAddress: {
    name: 'Testowa Firma OpenLinker',
    email: 'sender@example.com',
    phone: '888000000',
    address: {
      street: 'Testowa',
      buildingNumber: '1',
      city: 'Warszawa',
      postCode: '00-001',
      countryCode: 'PL',
    },
  },
  // Sandbox dev account has no courier agreement → use the contract-free C2C
  // courier service. Override with INPOST_COURIER_SERVICE if your org has one.
  courierService:
    (process.env.INPOST_COURIER_SERVICE as 'inpost_courier_standard' | 'inpost_courier_c2c') ??
    'inpost_courier_c2c',
};

/** A plausible buyer pulled off a marketplace order. */
export const SAMPLE_RECIPIENT: ShipmentRecipient = {
  firstName: 'Jan',
  lastName: 'Testowy',
  email: 'jan.testowy@example.com',
  phone: '888111222',
};

export const SAMPLE_COURIER_ADDRESS: ShipmentAddress = {
  street: 'Marszałkowska',
  buildingNumber: '12',
  city: 'Warszawa',
  postCode: '00-590',
  countryCode: 'PL',
};

export function buildAdapter(opts?: { autoConfirm?: boolean }): InpostShippingAdapter {
  const client = createInpostShipXClient({
    token: requireToken(),
    baseUrl: process.env.INPOST_BASE ?? INPOST_SHIPX_SANDBOX_BASE_URL,
    organizationId: CONNECTION_CONFIG.organizationId,
    logLevel: (process.env.INPOST_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'warn',
  });
  return new InpostShippingAdapter(client, CONNECTION_CONFIG, { autoConfirm: opts?.autoConfirm ?? true });
}

/** Mints a fake internal id like OpenLinker's IdentifierMappingService would. */
export function fakeId(prefix: string): string {
  return `ol_${prefix}_${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}`;
}

export function banner(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/**
 * The fresh sandbox org isn't provisioned for InPost courier — ShipX rejects
 * `inpost_courier_standard` creates with `missing_trucker_id`. Detect it so the
 * courier examples can explain rather than dump a stack trace.
 */
export function isCourierNotProvisioned(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'missing_trucker_id'
  );
}

export function explainCourierGap(): void {
  console.log(
    '\n⚠ ShipX rejected the courier shipment with `missing_trucker_id`.\n' +
      '  The sandbox organization has no courier (trucker) configuration yet — paczkomat\n' +
      '  works out of the box, but `inpost_courier_standard` needs the trucker/courier\n' +
      '  service enabled on the org in the sandbox manager. The adapter code is correct;\n' +
      '  this is an account-provisioning gap, not a bug.',
  );
}
