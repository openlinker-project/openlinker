import { LoadingState } from '@openlinker/web';

export const Default = () => (
  <LoadingState
    title="Resolving 1,284 mappings"
    message="Building the offer↔product link table. This usually takes 30–60 seconds."
  />
);

export const CustomEyebrow = () => (
  <LoadingState
    eyebrow="Catalogue sync"
    title="Replicating 6,412 products"
    message="Page 14 of 65 from prestashop.webservice.v1. Progress is resumable — leaving this page is safe."
  />
);

export const ShortMessage = () => (
  <LoadingState title="Checking connection" message="Reaching api.allegro.pl…" />
);
