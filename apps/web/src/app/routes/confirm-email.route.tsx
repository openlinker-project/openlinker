import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';

export const confirmEmailRoute: RouteObject = {
  path: '/confirm-email/:token',
  element: <GuestLayout />,
  children: [
    {
      index: true,
      lazy: async () => {
        const { ConfirmEmailPage } = await import('../../pages/auth/ConfirmEmailPage');
        return { Component: ConfirmEmailPage };
      },
    },
  ],
};
