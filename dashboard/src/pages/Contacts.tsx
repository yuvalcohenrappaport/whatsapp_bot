import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ContactCard } from '@/components/contacts/ContactCard';
import { useContacts, useRecentChats, useAddContact } from '@/hooks/useContacts';

export default function Contacts() {
  const { data: contacts, isLoading } = useContacts();
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Filter to only active contacts (mode !== 'off')
  const activeContacts = contacts?.filter((c) => c.mode !== 'off') ?? [];

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <Button onClick={() => setAddDialogOpen(true)}>
          <UserPlus className="size-4 mr-2" />
          Add Contact
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-20" />
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && activeContacts.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Users className="size-12 mb-4 opacity-50" />
          <p className="text-lg">No contacts yet</p>
          <p className="text-sm mt-1">Add a contact to get started.</p>
        </Card>
      )}

      {/* Contact cards grid */}
      {!isLoading && activeContacts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {activeContacts.map((contact) => (
            <ContactCard key={contact.jid} contact={contact} />
          ))}
        </div>
      )}

      {/* Add Contact Dialog */}
      <AddContactDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  );
}

function AddContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: recentChats, isLoading } = useRecentChats();
  const addContact = useAddContact();
  const [phone, setPhone] = useState('');

  function handleAdd(jid: string) {
    addContact.mutate(
      { jid },
      {
        onSuccess: () => {
          toast.success('Contact added');
          setPhone('');
          onOpenChange(false);
        },
      },
    );
  }

  function handleAddByPhone(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
    if (!cleaned || !/^\d{7,15}$/.test(cleaned)) {
      toast.error('Enter a valid phone number');
      return;
    }
    handleAdd(`${cleaned}@s.whatsapp.net`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh]">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>

        {/* Add by phone number */}
        <form onSubmit={handleAddByPhone} className="flex gap-2">
          <Input
            placeholder="Phone number (e.g. 972501234567)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={addContact.isPending || !phone.trim()}>
            Add
          </Button>
        </form>

        <div className="text-xs text-muted-foreground -mt-2">Or pick from recent chats:</div>

        <div className="overflow-y-auto -mx-6 px-6 max-h-[50vh]">
          {isLoading && (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!isLoading && (!recentChats || recentChats.length === 0) && (
            <div className="py-8 text-center text-muted-foreground">
              <p>No recent chats available to add</p>
            </div>
          )}

          {!isLoading && recentChats && recentChats.length > 0 && (
            <div className="space-y-1 py-2">
              {recentChats.map((chat) => (
                <button
                  key={chat.jid}
                  className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-accent/50 transition-colors disabled:opacity-50"
                  disabled={addContact.isPending || chat.alreadyContact}
                  onClick={() => handleAdd(chat.jid)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{chat.jid}</p>
                    {chat.lastMessage && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {chat.lastMessage.body}
                      </p>
                    )}
                  </div>
                  {chat.alreadyContact ? (
                    <span className="text-xs text-muted-foreground shrink-0">Added</span>
                  ) : (
                    <UserPlus className="size-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
