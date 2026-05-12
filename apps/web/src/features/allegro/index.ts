/**
 * Allegro — public surface
 *
 * Public barrel for the allegro feature (#609). Cross-feature consumers
 * (today: `features/connections` for the Allegro seller-defaults section)
 * import the responsible-producers query and the safety-attachment upload
 * mutation from here.
 */
export type { AllegroApi } from './api/allegro.api';
export { createAllegroApi } from './api/allegro.api';
export { useResponsibleProducersQuery } from './hooks/use-responsible-producers-query';
export { useUploadSafetyAttachmentMutation } from './hooks/use-upload-safety-attachment-mutation';
export { translateAllegroError } from './lib/translate-allegro-error';
