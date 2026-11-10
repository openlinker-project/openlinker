/** Screen registry, in sidebar order. Each file owns one screen. */
import type { ScreenDef } from '../proto';
import { screen as guide } from './guide';
import { screen as catalog } from './catalog';
import { screen as orders } from './orders';
import { screen as order } from './order';
import { screen as returns } from './returns';
import { screen as bundles } from './bundles';
import { screen as bundleEditor } from './bundle-editor';
import { screen as promotions } from './promotions';
import { screen as bench } from './bench';
import { screen as documents } from './documents';
import { screen as analytics } from './analytics';
import { screen as settings } from './settings';

export const SCREENS: ScreenDef[] = [guide, catalog, orders, order, returns, bundles, bundleEditor, promotions, bench, documents, analytics, settings];
