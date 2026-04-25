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
import PendingTasks from '@/pages/PendingTasks';
import ScheduledMessages from '@/pages/ScheduledMessages';
import Integrations from '@/pages/Integrations';
import LinkedInQueue from '@/pages/LinkedInQueue';
import LinkedInLessonSelection from '@/pages/LinkedInLessonSelection';
import LinkedInVariantFinalization from '@/pages/LinkedInVariantFinalization';
import Calendar from '@/pages/Calendar';
import TripsList from '@/pages/TripsList';
import TripView from '@/pages/TripView';

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
          { path: 'calendar', element: <Calendar /> },
          { path: 'trips', element: <TripsList /> },
          { path: 'trips/:groupJid', element: <TripView /> },
          { path: 'reminders', element: <Reminders /> },
          { path: 'tasks', element: <Tasks /> },
          { path: 'pending-tasks', element: <PendingTasks /> },
          { path: 'scheduled-messages', element: <ScheduledMessages /> },
          { path: 'linkedin/queue', element: <LinkedInQueue /> },
          { path: 'linkedin/queue/posts/:id/lesson', element: <LinkedInLessonSelection /> },
          { path: 'linkedin/queue/posts/:id/variant', element: <LinkedInVariantFinalization /> },
          { path: 'groups', element: <Groups /> },
          { path: 'integrations', element: <Integrations /> },
        ],
      },
    ],
  },
]);
