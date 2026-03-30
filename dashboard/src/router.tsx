import { createBrowserRouter } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { AppLayout } from '@/components/layout/AppLayout';
import Login from '@/pages/Login';
import Overview from '@/pages/Overview';
import Contacts from '@/pages/Contacts';
import Drafts from '@/pages/Drafts';
import Groups from '@/pages/Groups';
import Events from '@/pages/Events';
import Reminders from '@/pages/Reminders';
import Tasks from '@/pages/Tasks';
import ScheduledMessages from '@/pages/ScheduledMessages';
import Integrations from '@/pages/Integrations';

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
          { path: 'reminders', element: <Reminders /> },
          { path: 'tasks', element: <Tasks /> },
          { path: 'scheduled-messages', element: <ScheduledMessages /> },
          { path: 'groups', element: <Groups /> },
          { path: 'integrations', element: <Integrations /> },
        ],
      },
    ],
  },
]);
