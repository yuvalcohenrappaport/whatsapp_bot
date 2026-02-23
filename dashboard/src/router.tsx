import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import Overview from '@/pages/Overview';
import Contacts from '@/pages/Contacts';
import Drafts from '@/pages/Drafts';
import Groups from '@/pages/Groups';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'contacts', element: <Contacts /> },
      { path: 'drafts', element: <Drafts /> },
      { path: 'groups', element: <Groups /> },
    ],
  },
]);
