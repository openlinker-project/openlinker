/**
 * Public API base URL
 *
 * The address of the OpenLinker API as the browser reaches it, with no
 * trailing slash. Used to pre-fill webhook callback URLs: a platform must post
 * to the API, and on a split-origin deployment (`app.example.com` serving the
 * web app, `api.example.com` serving the API) the page's own origin is the web
 * app, which answers a webhook with 405.
 *
 * It is a pre-fill, not a guarantee: an API the browser reaches on a private
 * address (local dev, a Docker host alias) is still not reachable from the
 * internet, which is why the callback field stays editable.
 *
 * @module shared/config
 */
import { env } from './env';

export function publicApiBaseUrl(): string {
  return env.VITE_API_BASE_URL.trim().replace(/\/+$/, '');
}
