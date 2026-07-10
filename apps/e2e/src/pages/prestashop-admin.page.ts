/**
 * PrestaShop back-office page object
 *
 * Drives the PrestaShop admin (`/admin-dev`) for light visual confirmation of a
 * product/order during the golden path. It owns its own login and per-origin
 * `storageState`, because the PrestaShop admin lives on a different origin than
 * the OL SPA.
 *
 * IMPORTANT: the admin MUST be reached via the tunnel base URL, not
 * `localhost:8080` — `ps_shop_url.domain` is set to the tunnel, so a
 * `localhost:8080/admin-dev` request 301-redirects to the tunnel host. Callers
 * pass the tunnel base (derived from the connection's `config.baseUrl`).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class PrestashopAdminPage {
  constructor(private readonly page: Page) {}

  /** Log into the back office at `<baseUrl>/admin-dev`. */
  async login(baseUrl: string, email: string, password: string): Promise<void> {
    const base = baseUrl.replace(/\/$/, '');
    await this.page.goto(`${base}/admin-dev/`, { waitUntil: 'domcontentloaded' });
    // Already authenticated (storageState seeded)? The header shows the shop name.
    if (await this.isLoggedIn()) return;

    await this.page.locator('#email').fill(email);
    await this.page.locator('#passwd').fill(password);
    await this.page.locator('#submit_login').click();
    await expect(this.page.locator('#header, .header-toolbar, nav.main-header').first()).toBeVisible({
      timeout: 30_000,
    });
  }

  async isLoggedIn(): Promise<boolean> {
    return (await this.page.locator('#submit_login').count()) === 0;
  }

  /** Persist the authenticated PS-admin session for reuse. */
  async saveStorageState(path: string): Promise<void> {
    await this.page.context().storageState({ path });
  }

  get productsMenuLink(): Locator {
    return this.page.getByRole('link', { name: /Catalog|Products/ }).first();
  }

  /** Best-effort: search the product catalogue by name/reference. */
  async searchProduct(baseUrl: string, query: string): Promise<void> {
    const base = baseUrl.replace(/\/$/, '');
    await this.page.goto(
      `${base}/admin-dev/index.php?controller=AdminProducts&productFilter_name=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded' },
    );
  }
}
