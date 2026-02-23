import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ContactPanel } from './ContactPanel';
import type { Contact } from '@/hooks/useContacts';

interface ContactCardProps {
  contact: Contact;
}

const modeBadgeClass: Record<string, string> = {
  off: 'bg-muted text-muted-foreground',
  draft: 'bg-blue-600/20 text-blue-400 border-blue-500/30',
  auto: 'bg-green-600/20 text-green-400 border-green-500/30',
};

function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

export function ContactCard({ contact }: ContactCardProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors p-6 space-y-3"
        onClick={() => setPanelOpen(true)}
      >
        {/* Name + mode badge row */}
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-base truncate">
            {contact.name ?? contact.jid}
          </h3>
          <Badge
            variant="outline"
            className={`capitalize shrink-0 ${modeBadgeClass[contact.mode] ?? ''}`}
          >
            {contact.mode}
          </Badge>
        </div>

        {/* Last message snippet */}
        {contact.lastMessage ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {truncate(contact.lastMessage.body, 80)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/60 italic">No messages yet</p>
        )}

        {/* Timestamp */}
        {contact.lastMessage?.timestamp && (
          <p className="text-xs text-muted-foreground/60">
            {relativeTime(contact.lastMessage.timestamp)}
          </p>
        )}
      </Card>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-96">
          <ContactPanel contact={contact} onClose={() => setPanelOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
