import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';

export const forgotPasswordRoute: RouteObject = {
  path: '/forgot-password',
  element: <GuestLayout />,
  children: [
    {
      index: true,
      lazy: async () => {
        const { ForgotPasswordPage } = await import('../../pages/auth/ForgotPasswordPage');
        return { Component: ForgotPasswordPage };
      },
    },
  ],
};
