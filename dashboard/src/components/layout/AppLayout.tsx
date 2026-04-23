import { Outlet } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';

export function AppLayout() {
  const { status, qr } = useConnectionStatus();

  return (
    <SidebarProvider>
      {/* Phase 50 mobile: env(safe-area-inset-*) clears the iOS notch + home bar.
          Desktop / non-notched devices fall back to 0 (no visible change). */}
      <div className="flex h-screen w-full bg-background text-foreground gradient-mesh-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <Topbar status={status} qr={qr} />
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
