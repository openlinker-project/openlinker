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
import { ListingsListPage } from './listings.page';
import { OfferProductPickerModal } from './offer-product-picker.page';
import { BulkOfferWizard } from './bulk-offer-wizard.page';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';
import { OrdersListPage, OrderDetailPage } from './orders.page';
import { WooCommerceAdminPage } from './woocommerce-admin.page';
import { AnalyticsPage } from './analytics.page';
import { AnalyticsMockupPage } from './analytics-mockup.page';

export interface PageObjects {
  login: LoginPage;
  connectionsList: ConnectionsListPage;
  connectionDetail: ConnectionDetailPage;
  productsList: ProductsListPage;
  listingsList: ListingsListPage;
  offerProductPicker: OfferProductPickerModal;
  bulkOfferWizard: BulkOfferWizard;
  bulkBatchProgress: BulkBatchProgressPage;
  ordersList: OrdersListPage;
  orderDetail: OrderDetailPage;
  woocommerceAdmin: WooCommerceAdminPage;
  analytics: AnalyticsPage;
  analyticsMockup: AnalyticsMockupPage;
}

export function createPageObjects(page: Page): PageObjects {
  return {
    login: new LoginPage(page),
    connectionsList: new ConnectionsListPage(page),
    connectionDetail: new ConnectionDetailPage(page),
    productsList: new ProductsListPage(page),
    listingsList: new ListingsListPage(page),
    offerProductPicker: new OfferProductPickerModal(page),
    bulkOfferWizard: new BulkOfferWizard(page),
    bulkBatchProgress: new BulkBatchProgressPage(page),
    ordersList: new OrdersListPage(page),
    orderDetail: new OrderDetailPage(page),
    woocommerceAdmin: new WooCommerceAdminPage(page),
    analytics: new AnalyticsPage(page),
    analyticsMockup: new AnalyticsMockupPage(page),
  };
}

export * from './login.page';
export * from './connections.page';
export * from './products.page';
export * from './listings.page';
export * from './offer-product-picker.page';
export * from './bulk-offer-wizard.page';
export * from './bulk-batch-progress.page';
export * from './orders.page';
export * from './invoice-panel.page';
export * from './woocommerce-admin.page';
export * from './analytics.page';
export * from './analytics-mockup.page';
