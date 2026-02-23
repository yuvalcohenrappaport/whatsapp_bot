import { useState } from 'react';
import { Calendar, Link as LinkIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { GroupPanel } from './GroupPanel';
import type { Group } from '@/hooks/useGroups';

interface GroupCardProps {
  group: Group;
}

export function GroupCard({ group }: GroupCardProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors p-6 space-y-3"
        onClick={() => setPanelOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="font-medium truncate">
            {group.name ?? group.id}
          </div>
          <Badge variant={group.active ? 'default' : 'secondary'}>
            {group.active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {group.reminderDay && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-3.5" />
            <span>Reminder: {group.reminderDay.charAt(0).toUpperCase() + group.reminderDay.slice(1)}</span>
          </div>
        )}
        {group.calendarLink && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LinkIcon className="size-3.5" />
            <span className="truncate">Calendar linked</span>
          </div>
        )}
      </Card>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-96 overflow-y-auto">
          <GroupPanel group={group} onClose={() => setPanelOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
