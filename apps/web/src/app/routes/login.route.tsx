import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';
import { LoginPage } from '../../pages/auth/LoginPage';

export const loginRoute: RouteObject = {
  path: '/login',
  element: <GuestLayout />,
  children: [{ index: true, element: <LoginPage /> }],
};
