/** Screen registry for the simple v1 prototype, in sidebar order. */
import type { ScreenDef } from '../proto';
import { screen as how } from './v1-how';
import { screen as catalog } from './catalog';
import { screen as orders } from './v1-orders';
import { screen as order } from './v1-order';
import { screen as returns } from './v1-returns';
import { screen as promotions } from './v1-promotions';
import { screen as products } from './v1-products';
import { screen as bench } from './v1-bench';
import { screen as report } from './v1-report';
import { screen as settings } from './v1-settings';

export const SCREENS: ScreenDef[] = [how, catalog, orders, order, returns, promotions, products, bench, report, settings];
