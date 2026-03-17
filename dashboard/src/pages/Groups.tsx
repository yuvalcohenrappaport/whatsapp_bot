import { useState } from 'react';
import { Plus, Search, UsersRound } from 'lucide-react';
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
  const [search, setSearch] = useState('');

  const filteredGroups = groups?.filter((group) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return group.name?.toLowerCase().includes(term) || group.id.toLowerCase().includes(term);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>Groups</h1>
          <p className="text-sm text-muted-foreground mt-1">WhatsApp groups with travel bot or keyword rules</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Add Group
        </Button>
      </div>

      {!isLoading && groups && groups.length > 0 && (
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search groups..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

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

      {!isLoading && filteredGroups && filteredGroups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredGroups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      )}

      {!isLoading && groups && groups.length > 0 && filteredGroups?.length === 0 && (
        <p className="text-center text-muted-foreground py-12">No groups match your search.</p>
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
  const [query, setQuery] = useState('');

  function handleAdd(groupJid: string, name?: string) {
    addGroup.mutate(
      { id: groupJid, name },
      {
        onSuccess: () => {
          toast.success('Group added');
          setQuery('');
          onOpenChange(false);
        },
      },
    );
  }

  const isJid = query.trim().endsWith('@g.us');
  const term = query.toLowerCase();
  const filtered = participating?.filter((g) => {
    if (!query) return true;
    return g.name?.toLowerCase().includes(term) || g.jid.toLowerCase().includes(term);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh]">
        <DialogHeader>
          <DialogTitle>Add Group</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or JID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {isJid && (
          <Button
            variant="outline"
            className="w-full justify-start"
            disabled={addGroup.isPending}
            onClick={() => handleAdd(query.trim())}
          >
            <Plus className="size-4 mr-2" />
            Add by JID: {query.trim()}
          </Button>
        )}

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

          {!isLoading && participating && participating.length > 0 && filtered?.length === 0 && !isJid && (
            <div className="py-8 text-center text-muted-foreground">
              <p>No groups match "{query}"</p>
            </div>
          )}

          {!isLoading && filtered && filtered.length > 0 && (
            <div className="space-y-1 py-2">
              {filtered.map((group) => (
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
