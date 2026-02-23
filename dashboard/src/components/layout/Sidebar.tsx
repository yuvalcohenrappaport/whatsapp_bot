import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquare, UsersRound } from 'lucide-react';
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
  { to: '/groups', label: 'Groups', icon: UsersRound },
];

export function AppSidebar() {
  return (
    <ShadcnSidebar collapsible="none">
      <SidebarHeader className="px-4 py-5">
        <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
          WA Bot
        </span>
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
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
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
