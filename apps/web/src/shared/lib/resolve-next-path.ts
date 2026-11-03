/**
 * Resolve a `?next=` deep-link target (#1938, moved to `shared` by #3096)
 *
 * Only a same-origin absolute path is honoured, so a crafted
 * `?next=https://evil.example` cannot turn a redirect into an open redirect. A
 * protocol-relative `//host` is rejected for the same reason, and so is
 * `/\host`, which browsers normalise to `//host`.
 *
 * It lives in `shared` because two layers need it and neither owns it: the
 * consent page (`features/demo`) and the guest layout that returns a signed-in
 * user to where they were heading (`app/layouts`). A sanitiser is not demo
 * knowledge.
 *
 * @module shared/lib
 */
export function resolveNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/';
  }
  return raw;
}
