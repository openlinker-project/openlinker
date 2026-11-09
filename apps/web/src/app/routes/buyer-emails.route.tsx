import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const buyerEmailsRoute: RouteObject = {
  path: 'settings/buyer-emails',
  handle: { crumb: { group: 'platform', page: 'buyerEmails' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { BuyerEmailsPage } = await import('../../pages/settings/buyer-emails-page');
    return { Component: BuyerEmailsPage };
  },
};

export const buyerEmailEditorRoute: RouteObject = {
  path: 'settings/buyer-emails/:connectionId/:template',
  handle: { crumb: { group: 'platform', page: 'buyerEmail' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { BuyerEmailEditorPage } = await import('../../pages/settings/buyer-email-editor-page');
    return { Component: BuyerEmailEditorPage };
  },
};
