import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { LoginForm } from '../../features/auth/components/LoginForm';
import { useSystemConfigQuery } from '../../features/system';
import { isMarketingLandingTrackable } from '../../features/demo';
import { useMessages } from '../../shared/i18n';

export function LoginPage(): ReactElement {
  const copy = useMessages('auth').login;
  const systemConfigQuery = useSystemConfigQuery();
  const location = useLocation();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;
  const showTrackingFootnote = isMarketingLandingTrackable(systemConfigQuery.data, location.search);

  return (
    <section className="guest-page">
      <h1 className="guest-page__title">{copy.title}</h1>
      <p className="guest-page__description">{copy.description}</p>
      <LoginForm demoMode={demoMode} showTrackingFootnote={showTrackingFootnote} />
    </section>
  );
}
