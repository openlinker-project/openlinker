import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';

export const registerRoute: RouteObject = {
  path: '/register',
  element: <GuestLayout />,
  children: [
    {
      index: true,
      lazy: async () => {
        const { RegisterPage } = await import('../../pages/auth/RegisterPage');
        return { Component: RegisterPage };
      },
    },
  ],
};
