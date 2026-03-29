import { createBrowserRouter } from 'react-router-dom';
import { loginRoute } from './routes/login.route';
import { rootRoute } from './routes/root.route';

export const appRouter = createBrowserRouter([loginRoute, rootRoute]);
