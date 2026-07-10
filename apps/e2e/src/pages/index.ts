/**
 * Page-object registry
 *
 * Builds the `pages` bag handed to specs via the extended `test` fixture. Each
 * accessor lazily constructs a page object bound to the active Playwright
 * `page`, so specs compose flows without importing page objects individually.
 *
 * @module pages
 */
import { type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import { ConnectionsListPage, ConnectionDetailPage } from './connections.page';
import { ProductsListPage } from './products.page';
import { ProductDetailPage } from './product-detail.page';
import { ListingsListPage } from './listings.page';
import { ListingDetailPage } from './listing-detail.page';
import { PublishToShopDialog } from './publish-dialog.page';
import { BulkOfferWizard } from './bulk-offer-wizard.page';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';
import { TriggerSyncDialog } from './trigger-sync-dialog.page';
import { OrdersListPage, OrderDetailPage } from './orders.page';
import { PrestashopAdminPage } from './prestashop-admin.page';
import { WooCommerceAdminPage } from './woocommerce-admin.page';

export interface PageObjects {
  login: LoginPage;
  connectionsList: ConnectionsListPage;
  connectionDetail: ConnectionDetailPage;
  productsList: ProductsListPage;
  productDetail: ProductDetailPage;
  listingsList: ListingsListPage;
  listingDetail: ListingDetailPage;
  publishToShop: PublishToShopDialog;
  bulkOfferWizard: BulkOfferWizard;
  bulkBatchProgress: BulkBatchProgressPage;
  triggerSync: TriggerSyncDialog;
  ordersList: OrdersListPage;
  orderDetail: OrderDetailPage;
  prestashopAdmin: PrestashopAdminPage;
  woocommerceAdmin: WooCommerceAdminPage;
}

export function createPageObjects(page: Page): PageObjects {
  return {
    login: new LoginPage(page),
    connectionsList: new ConnectionsListPage(page),
    connectionDetail: new ConnectionDetailPage(page),
    productsList: new ProductsListPage(page),
    productDetail: new ProductDetailPage(page),
    listingsList: new ListingsListPage(page),
    listingDetail: new ListingDetailPage(page),
    publishToShop: new PublishToShopDialog(page),
    bulkOfferWizard: new BulkOfferWizard(page),
    bulkBatchProgress: new BulkBatchProgressPage(page),
    triggerSync: new TriggerSyncDialog(page),
    ordersList: new OrdersListPage(page),
    orderDetail: new OrderDetailPage(page),
    prestashopAdmin: new PrestashopAdminPage(page),
    woocommerceAdmin: new WooCommerceAdminPage(page),
  };
}

export * from './login.page';
export * from './connections.page';
export * from './products.page';
export * from './product-detail.page';
export * from './listings.page';
export * from './listing-detail.page';
export * from './publish-dialog.page';
export * from './bulk-offer-wizard.page';
export * from './bulk-batch-progress.page';
export * from './trigger-sync-dialog.page';
export * from './orders.page';
export * from './shipment-panel.page';
export * from './invoice-panel.page';
export * from './prestashop-admin.page';
export * from './woocommerce-admin.page';
