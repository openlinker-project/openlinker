import type { RouteObject } from 'react-router-dom';

export const editConnectionRoute: RouteObject = {
  path: 'connections/:connectionId/edit',
  lazy: async () => {
    const { EditConnectionPage } = await import(
      '../../pages/connections/edit-connection-page'
    );
    return { Component: EditConnectionPage };
  },
};
