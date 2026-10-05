/**
 * What a bridge said when it refused our credentials, safe to put in an error.
 *
 * Three clients in this package talk to the bridge and all three can be handed a
 * 401, but only one of them read the body - so an operator whose bridge token
 * was rotated got a sentence naming the cause on the invoicing path and a bare
 * "HTTP 401" on the orders and inventory paths, for the identical
 * misconfiguration (#3365 review).
 *
 * This is shared rather than copied because the careful part is not the read, it
 * is the REDACTION: the body comes from a service OpenLinker does not control,
 * so "our bridge does not echo the token" is not a property a client may rely
 * on. Three copies of that rule is three chances for one of them to skip a form
 * of the token, and the thing that leaks is a credential.
 *
 * @module libs/integrations/subiekt/src/bridge
 */

/** Longest body excerpt carried into an error message. */
const MAX_REASON_LENGTH = 300;

/**
 * Below this, `replace` would shred unrelated body text rather than redact a
 * credential - a two-character token would turn the bridge's own sentence into
 * noise, and the redaction would be the thing that made the message unreadable.
 * A secret that short is not one worth protecting.
 */
const MIN_REDACTABLE_TOKEN_LENGTH = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove the bridge token from a string taken off the wire.
 *
 * The forms a bridge realistically produces are all replaced: the token
 * verbatim, a percent-encoded copy (a `WWW-Authenticate` challenge, or a URL it
 * was interpolated into), and either in a different case. Assuming the echo is
 * byte-identical would be the same unfounded assumption as trusting there is no
 * echo at all.
 */
export function redactBridgeToken(text: string, token: string | undefined): string {
  let out = text;
  if (token !== undefined && token.length >= MIN_REDACTABLE_TOKEN_LENGTH) {
    const forms = [token, encodeURIComponent(token)].filter(
      (form, index, all) => form.length > 0 && all.indexOf(form) === index
    );
    for (const form of forms) {
      out = out.replace(new RegExp(escapeRegExp(form), 'gi'), '[redacted]');
    }
  }
  return out.length > MAX_REASON_LENGTH ? `${out.slice(0, MAX_REASON_LENGTH)}…` : out;
}

/**
 * Read an auth-refusal reason off a response body, redacted and bounded.
 *
 * Answers `undefined` when the body says nothing the error's own `status` does
 * not already carry - padding a message with the number it already has helps
 * nobody - and when the body cannot be read at all, which must never turn a 401
 * into a different error.
 */
export async function readBridgeAuthReason(
  response: Response,
  token: string | undefined
): Promise<string | undefined> {
  let raw: string;
  try {
    raw = (await response.text()).trim();
  } catch {
    return undefined;
  }
  if (raw.length === 0 || raw === `HTTP ${response.status}`) {
    return undefined;
  }

  // An enveloped body is the bridge's own shape; anything else is surfaced as
  // the text it is, because a bridge behind a proxy answers with whatever the
  // proxy felt like sending and that is exactly the case worth seeing.
  let reason = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const enveloped = (parsed as { error?: { reason?: unknown } }).error?.reason;
      const bare = (parsed as { reason?: unknown }).reason;
      if (typeof enveloped === 'string' && enveloped.length > 0) {
        reason = enveloped;
      } else if (typeof bare === 'string' && bare.length > 0) {
        reason = bare;
      }
    }
  } catch {
    // Not JSON - keep the raw text.
  }

  const safe = redactBridgeToken(reason, token);
  return safe.length > 0 ? safe : undefined;
}
