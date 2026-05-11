import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';

export const loginRoute: RouteObject = {
  path: '/login',
  element: <GuestLayout />,
  children: [
    {
      index: true,
      lazy: async () => {
        const { LoginPage } = await import('../../pages/auth/LoginPage');
        return { Component: LoginPage };
      },
    },
  ],
};
