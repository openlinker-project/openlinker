/**
 * WooCommerce wp-admin page object
 *
 * Drives the WordPress/WooCommerce admin (`/wp-admin`) for light visual
 * confirmation of the published product during the golden path. It owns its own
 * login and per-origin `storageState`, because wp-admin lives on a different
 * origin than the OL SPA (default `http://localhost:8082`).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class WooCommerceAdminPage {
  constructor(private readonly page: Page) {}

  /**
   * Log into wp-admin. `adminUrl` is the `/wp-admin` base; unauthenticated hits
   * redirect to `wp-login.php`.
   */
  async login(adminUrl: string, user: string, password: string): Promise<void> {
    const base = adminUrl.replace(/\/$/, '');
    await this.page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    if (await this.isLoggedIn()) return;

    await this.page.locator('#user_login').fill(user);
    await this.page.locator('#user_pass').fill(password);
    await this.page.locator('#wp-submit').click();
    await expect(this.page.locator('#wpadminbar, #adminmenumain').first()).toBeVisible({
      timeout: 30_000,
    });
  }

  async isLoggedIn(): Promise<boolean> {
    return (await this.page.locator('#wp-submit').count()) === 0;
  }

  /** Persist the authenticated wp-admin session for reuse. */
  async saveStorageState(path: string): Promise<void> {
    await this.page.context().storageState({ path });
  }

  get productsMenuLink(): Locator {
    return this.page.getByRole('link', { name: 'Products' }).first();
  }

  /** Best-effort: open the WooCommerce products list filtered by search term. */
  async searchProduct(adminUrl: string, query: string): Promise<void> {
    const base = adminUrl.replace(/\/$/, '');
    await this.page.goto(
      `${base}/edit.php?post_type=product&s=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded' },
    );
  }
}
