import { createBrowserRouter } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { AppLayout } from '@/components/layout/AppLayout';
import Login from '@/pages/Login';
import Overview from '@/pages/Overview';
import Contacts from '@/pages/Contacts';
import Drafts from '@/pages/Drafts';
import Groups from '@/pages/Groups';
import Events from '@/pages/Events';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <AuthGuard />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: 'contacts', element: <Contacts /> },
          { path: 'drafts', element: <Drafts /> },
          { path: 'events', element: <Events /> },
          { path: 'groups', element: <Groups /> },
        ],
      },
    ],
  },
]);
