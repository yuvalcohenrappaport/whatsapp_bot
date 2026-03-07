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
        className={`card-shine cursor-pointer hover:bg-accent/30 transition-all duration-200 p-6 space-y-3 border-border/50 hover:border-border ${(group.travelBotActive || group.keywordRulesActive) ? 'border-l-2 border-l-[oklch(0.68_0.16_200)]' : ''}`}
        onClick={() => setPanelOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="font-medium truncate">
            {group.name ?? group.id}
          </div>
          <div className="flex gap-1.5">
            {group.travelBotActive && (
              <Badge variant="default" className="bg-emerald-subtle text-emerald border-glow-emerald text-xs">
                Travel
              </Badge>
            )}
            {group.keywordRulesActive && (
              <Badge variant="default" className="bg-emerald-subtle text-emerald border-glow-emerald text-xs">
                Keywords
              </Badge>
            )}
            {!group.travelBotActive && !group.keywordRulesActive && (
              <Badge variant="secondary">Inactive</Badge>
            )}
          </div>
        </div>
        {group.reminderDay && (
          <div className="flex items-center gap-1.5 text-sm text-amber-accent">
            <Calendar className="size-3.5" />
            <span>Reminder: {group.reminderDay.charAt(0).toUpperCase() + group.reminderDay.slice(1)}</span>
          </div>
        )}
        {group.calendarLink && (
          <div className="flex items-center gap-1.5 text-sm text-teal">
            <LinkIcon className="size-3.5" />
            <span className="truncate">Calendar linked</span>
          </div>
        )}
      </Card>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <GroupPanel group={group} onClose={() => setPanelOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
