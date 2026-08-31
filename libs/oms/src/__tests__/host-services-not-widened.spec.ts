/**
 * `HostServices` is not widened for the OMS (#2405 AC-5, ADR-055, ADR-062 §4).
 *
 * ADR-055 routes the OL-OMS's five core-service dependencies through the
 * descriptor's own factory closure (`OmsPluginDeps`) rather than through the
 * SDK's shared `HostServices` bag, because five OMS-specific reads fail that
 * bag's stated "every plausible future plugin needs this" test.
 *
 * The issue asks for a diff assertion. A `git diff` run in the author's shell
 * proves nothing about a later commit on the same branch, so the property is
 * mechanised here instead: the member set is pinned, and adding an OMS service
 * to the bag fails this suite rather than a reviewer's memory.
 *
 * Reading the source text rather than the type is deliberate — an interface
 * has no runtime representation to enumerate, and generating a value to
 * inspect would pin the generator instead of the contract.
 *
 * Note the path below reaches OUT of `libs/oms` into a sibling package. ADR-055
 * forbids in-repo relative escapes for this package's *shipped* code; this is a
 * test file, excluded by the `files` whitelist, so it does not affect
 * publishability — but it is the one file here that would not survive package
 * extraction, and it would need to move to `libs/plugin-sdk` at that point.
 *
 * @module libs/oms/src/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every member of `HostServices`, in declaration order, as of #2405.
 *
 * Widening this bag is a plugin-SDK contract change and needs its own
 * decision — see the field-addition policy in `host-services.ts` itself.
 * Updating this list without one is the failure the suite exists to catch.
 */
const EXPECTED_HOST_SERVICES_MEMBERS = [
  'logger',
  'identifierMapping',
  'credentialsResolver',
  'http',
  'cache',
  'adapterRegistry',
  'factoryResolver',
  'connectionTesterRegistry',
  'emailNormalizerRegistry',
  'retryClassifierRegistry',
  'authFailureClassifierRegistry',
  'schedulerTaskRegistry',
  'webhookProvisioningRegistry',
  'webhookEventTranslatorRegistry',
  'inboundWebhookDecoderRegistry',
  'connectionConfigShapeValidatorRegistry',
  'connectionCredentialsShapeValidatorRegistry',
  'connectionCredentialsRewriterRegistry',
  'oauthCompletionRegistry',
];

/** The five services the OMS takes through its own closure instead. */
const OMS_PLUGIN_DEPS = ['inventoryQuery', 'orderRecords', 'products', 'shipping', 'mappingConfig'];

function readHostServicesMembers(): string[] {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', 'plugin-sdk', 'src', 'host-services.ts'),
    'utf8'
  );
  const start = source.indexOf('export interface HostServices');
  expect(start).toBeGreaterThanOrEqual(0);
  // Bounded to THIS interface. Slicing to EOF would sweep in any later
  // 2-space-indented declaration (a future `HostServicesV2`, an options type)
  // and fail both assertions for a reason that has nothing to do with
  // widening — a red that misdirects is barely better than a green that lies.
  const end = source.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);
  // `readonly` is OPTIONAL in the pattern on purpose. Requiring it left a hole
  // in exactly the case this file guards: a member added WITHOUT `readonly`
  // would be invisible to the scan, the existing members would keep the
  // non-vacuity check green, `toEqual` would still match and
  // `not.toContain('inventoryQuery')` would still pass — while `HostServices`
  // had in fact been widened. Dropping one word is the likeliest shape a
  // hurried widening takes, so it must not be the shape that slips through.
  return [...body.matchAll(/^\s{2}(?:readonly\s+)?([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]);
}

describe('HostServices is not widened for the OMS', () => {
  it('should expose exactly the members it had before #2405', () => {
    // Non-vacuity first: a regex that silently matched nothing would make the
    // comparison below pass against an empty list.
    const members = readHostServicesMembers();
    expect(members.length).toBeGreaterThan(0);
    expect(members).toEqual(EXPECTED_HOST_SERVICES_MEMBERS);
  });

  it('should carry NONE of the five OMS factory deps', () => {
    // The assertion that actually encodes the decision: these reach the plugin
    // through `OmsPluginDeps`, the Erli precedent, never through the bag.
    const members = readHostServicesMembers();
    for (const dep of OMS_PLUGIN_DEPS) {
      expect(members).not.toContain(dep);
    }
  });
});
