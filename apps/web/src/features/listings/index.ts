/**
 * Listings — public surface
 *
 * Public barrel for the listings feature (#609). Cross-feature consumers
 * (today: the `plugins/allegro` wiring, which references the Allegro
 * create-offer wizard and the listings API request type) import from here.
 */
export type { CreateOfferRequest } from './api/listings.types';
export { AllegroCreateOfferWizard } from './components/AllegroCreateOfferWizard';
