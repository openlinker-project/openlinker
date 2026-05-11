import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';

export const resetPasswordRoute: RouteObject = {
  path: '/reset-password/:token',
  element: <GuestLayout />,
  children: [
    {
      index: true,
      lazy: async () => {
        const { ResetPasswordPage } = await import('../../pages/auth/ResetPasswordPage');
        return { Component: ResetPasswordPage };
      },
    },
  ],
};
