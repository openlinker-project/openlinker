import { createBrowserRouter } from 'react-router-dom';
import { loginRoute } from './routes/login.route';
import { forgotPasswordRoute } from './routes/forgot-password.route';
import { resetPasswordRoute } from './routes/reset-password.route';
import { rootRoute } from './routes/root.route';

export const appRouter = createBrowserRouter([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  rootRoute,
]);
