import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const usersCrumb: RouteCrumbHandle = {
  crumb: { group: 'Administration', title: 'Users' },
};

export const usersRoute: RouteObject = {
  path: 'users',
  handle: usersCrumb,
  lazy: async () => {
    const { UsersPage } = await import('../../pages/users/users-page');
    return { Component: UsersPage };
  },
};
