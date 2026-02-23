import { useState } from 'react';
import { Plus, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { GroupCard } from '@/components/groups/GroupCard';
import { useGroups, useAddGroup } from '@/hooks/useGroups';

export default function Groups() {
  const { data: groups, isLoading } = useGroups();
  const addGroup = useAddGroup();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newJid, setNewJid] = useState('');
  const [newName, setNewName] = useState('');

  function handleAdd() {
    const jid = newJid.trim();
    if (!jid) return;
    addGroup.mutate(
      { id: jid, name: newName.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Group added');
          setDialogOpen(false);
          setNewJid('');
          setNewName('');
        },
      },
    );
  }

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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Group</DialogTitle>
            <DialogDescription>
              Enter the WhatsApp group JID and an optional name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Group JID</Label>
              <Input
                value={newJid}
                onChange={(e) => setNewJid(e.target.value)}
                placeholder="123456789@g.us"
              />
            </div>
            <div className="space-y-2">
              <Label>Name (optional)</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Trip Planning"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleAdd}
              disabled={!newJid.trim() || addGroup.isPending}
            >
              Add Group
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
