/**
 * Shoper Base URL Policy
 *
 * Pure rule for what a Shoper `baseUrl` may be, and how it becomes an API
 * URL. Shared by the config shape validator (save time) and the connection
 * tester (probe time), so the two cannot disagree.
 *
 * Deliberately stricter than the WooCommerce / Subiekt `isUrlSsrfSafe`
 * predicate, and for a reason that makes it much shorter: a Shoper shop is
 * ALWAYS a public DNS name (`xxxxx.shoparena.pl` or the merchant's own
 * domain), so there is no local-development case to keep room for. Every IP
 * literal (in any encoding - WHATWG `URL` canonicalises hex, octal and
 * decimal-integer forms to dotted-quad before `isIP` sees them), `localhost`
 * and every single-label host is refused outright instead of range-checked,
 * as are reserved and conventionally private suffixes (`.internal`, `.local`, `.lan`, ...).
 *
 * DOCUMENTED LIMITATION - DNS rebinding: a public name that resolves to a
 * private address at request time cannot be caught by validating the string.
 * The HTTP client's refusal to follow redirects closes the redirect-to-private
 * vector; pure rebinding is a runtime/network concern, as it is for the
 * sibling plugins.
 *
 * @module libs/integrations/shoper/src/domain/policies
 */
import { isIP } from 'net';

import { SHOPER_API_PATH_PREFIX } from '../../shoper.constants';

export type ShoperBaseUrlParseResult =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly issues: readonly string[] };

const HTTPS_PREFIX = 'https://';
const SCHEME_SEPARATOR = '://';
/**
 * Suffixes that are reserved or conventionally private (RFC 6761 / 6762 /
 * 8375 and the usual intranet names). A real shop is never under one; refusing
 * them closes the private-DNS gap the IP-literal and single-label checks leave.
 */
const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'lan',
  'home',
  'corp',
  'intranet',
  'localdomain',
  'home.arpa',
  'test',
  'invalid',
  'example',
] as const;
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function fail(...issues: string[]): ShoperBaseUrlParseResult {
  return { ok: false, issues };
}

/**
 * Parses the operator-supplied `baseUrl`. Returns the normalised lowercase
 * host, or the reasons the value was refused. The credentials / port / path
 * checks accumulate so an operator sees every problem at once; the host checks
 * report only the first that fires, since several complaints about one host
 * value are noise. A trailing-dot FQDN (`shop.example.com.`) is refused on
 * purpose: the value is stored and compared as written.
 */
export function parseShoperBaseUrl(raw: unknown): ShoperBaseUrlParseResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fail('`baseUrl` must be a non-empty string, e.g. `xxxxx.shoparena.pl`');
  }

  const value = raw.trim();
  let withoutScheme = value;
  if (value.includes(SCHEME_SEPARATOR)) {
    if (!value.toLowerCase().startsWith(HTTPS_PREFIX)) {
      return fail('`baseUrl` must use https - the API token is sent on every request');
    }
    withoutScheme = value.slice(HTTPS_PREFIX.length);
  }

  let url: URL;
  try {
    url = new URL(`${HTTPS_PREFIX}${withoutScheme}`);
  } catch {
    return fail('`baseUrl` is not a valid host name, e.g. `xxxxx.shoparena.pl`');
  }

  const issues: string[] = [];
  if (url.username !== '' || url.password !== '') {
    issues.push('`baseUrl` must not contain credentials');
  }
  if (url.port !== '') {
    issues.push('`baseUrl` must not contain a port');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    issues.push('`baseUrl` must be only the shop host, without a path, query or fragment');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname.startsWith('[') || isIP(hostname) !== 0) {
    issues.push('`baseUrl` must be a shop host name, not an IP address');
  } else if (hostname === 'localhost' || !hostname.includes('.')) {
    issues.push('`baseUrl` must be a fully-qualified shop host name, e.g. `xxxxx.shoparena.pl`');
  } else if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(`.${suffix}`))) {
    issues.push('`baseUrl` must be a public shop host name, not a private or reserved one');
  } else if (!hostname.split('.').every((label) => DNS_LABEL.test(label))) {
    issues.push('`baseUrl` is not a valid host name');
  }

  return issues.length > 0 ? fail(...issues) : { ok: true, host: hostname };
}

/** Builds the absolute URL of a REST resource on the shop. `path` starts with `/`. */
export function buildShoperApiUrl(host: string, path: string): string {
  return `${HTTPS_PREFIX}${host}${SHOPER_API_PATH_PREFIX}${path}`;
}
