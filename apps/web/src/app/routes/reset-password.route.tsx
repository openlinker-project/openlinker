import type { RouteObject } from 'react-router-dom';
import { GuestLayout } from '../layouts/guest-layout';
import { ResetPasswordPage } from '../../pages/auth/ResetPasswordPage';

export const resetPasswordRoute: RouteObject = {
  path: '/reset-password/:token',
  element: <GuestLayout />,
  children: [{ index: true, element: <ResetPasswordPage /> }],
};
