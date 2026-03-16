import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquare, Calendar, UsersRound, Bell, CheckSquare, Plug } from 'lucide-react';
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/drafts', label: 'Drafts', icon: MessageSquare },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/reminders', label: 'Reminders', icon: Bell },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/groups', label: 'Groups', icon: UsersRound },
  { to: '/integrations', label: 'Integrations', icon: Plug },
];

export function AppSidebar() {
  return (
    <ShadcnSidebar collapsible="offcanvas">
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-subtle glow-emerald">
            <span className="text-emerald text-sm font-bold">W</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-sidebar-foreground font-[var(--font-heading)]" style={{ fontFamily: 'var(--font-heading)' }}>
            WA Bot
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <NavLink to={item.to} end={item.to === '/'}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} className="gap-3">
                        <item.icon className={`size-4 ${isActive ? 'text-emerald' : ''}`} />
                        <span className={isActive ? 'text-emerald font-medium' : ''}>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </ShadcnSidebar>
  );
}
