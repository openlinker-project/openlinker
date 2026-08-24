import { Button, ErrorState } from '@openlinker/web';

export const Default = () => (
  <ErrorState
    title="We couldn't reach Allegro"
    message="HTTP 503 from api.allegro.pl. Retry usually clears this."
    action={
      <Button tone="secondary" className="button--sm">
        Retry
      </Button>
    }
  />
);

export const NoAction = () => (
  <ErrorState
    title="Admin role required"
    message="This page manages agent credentials — it requires an admin session."
  />
);

export const CustomEyebrow = () => (
  <ErrorState
    eyebrow="Sync job 4a91"
    title="Catalogue replication failed"
    message="The connection returned 401 Unauthorized after the refresh token expired. Re-authorise the connection, then re-run the job."
    action={
      <Button tone="primary" className="button--sm">
        Re-authorise connection
      </Button>
    }
  />
);
