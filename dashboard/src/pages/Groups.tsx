import { useState } from 'react';
import { Plus, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GroupCard } from '@/components/groups/GroupCard';
import { useGroups, useAddGroup, useParticipatingGroups } from '@/hooks/useGroups';

export default function Groups() {
  const { data: groups, isLoading } = useGroups();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Groups</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Add Group
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && groups && groups.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-20">
          <UsersRound className="size-12 mb-4 opacity-50 text-muted-foreground" />
          <p className="text-lg text-muted-foreground">No groups tracked yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add a WhatsApp group to get started.
          </p>
        </Card>
      )}

      {!isLoading && groups && groups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      )}

      <AddGroupDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function AddGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: participating, isLoading } = useParticipatingGroups();
  const addGroup = useAddGroup();
  const [jid, setJid] = useState('');

  function handleAdd(groupJid: string, name?: string) {
    addGroup.mutate(
      { id: groupJid, name },
      {
        onSuccess: () => {
          toast.success('Group added');
          setJid('');
          onOpenChange(false);
        },
      },
    );
  }

  function handleAddByJid(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = jid.trim();
    if (!trimmed) return;
    handleAdd(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh]">
        <DialogHeader>
          <DialogTitle>Add Group</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleAddByJid} className="flex gap-2">
          <Input
            placeholder="Group JID (e.g. 123456789@g.us)"
            value={jid}
            onChange={(e) => setJid(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={addGroup.isPending || !jid.trim()}>
            Add
          </Button>
        </form>

        <div className="text-xs text-muted-foreground -mt-2">Or pick from your WhatsApp groups:</div>

        <div className="overflow-y-auto -mx-6 px-6 max-h-[50vh]">
          {isLoading && (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!isLoading && (!participating || participating.length === 0) && (
            <div className="py-8 text-center text-muted-foreground">
              <p>No WhatsApp groups found</p>
            </div>
          )}

          {!isLoading && participating && participating.length > 0 && (
            <div className="space-y-1 py-2">
              {participating.map((group) => (
                <button
                  key={group.jid}
                  className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-accent/50 transition-colors disabled:opacity-50"
                  disabled={addGroup.isPending || group.alreadyTracked}
                  onClick={() => handleAdd(group.jid, group.name ?? undefined)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {group.name ?? group.jid}
                    </p>
                    {group.name && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {group.jid}
                      </p>
                    )}
                  </div>
                  {group.alreadyTracked ? (
                    <span className="text-xs text-muted-foreground shrink-0">Added</span>
                  ) : (
                    <UsersRound className="size-4 text-muted-foreground shrink-0" />
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
