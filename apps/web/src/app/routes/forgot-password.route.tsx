import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';
import { ForgotPasswordPage } from '../../pages/auth/ForgotPasswordPage';

export const forgotPasswordRoute: RouteObject = {
  path: '/forgot-password',
  element: <GuestLayout />,
  children: [{ index: true, element: <ForgotPasswordPage /> }],
};
