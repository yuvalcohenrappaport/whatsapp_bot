import { useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApproveDraft, useRejectDraft } from '@/hooks/useDrafts';
import type { Draft } from '@/hooks/useDrafts';

interface DraftRowProps {
  draft: Draft;
}

export function DraftRow({ draft }: DraftRowProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const approve = useApproveDraft();
  const reject = useRejectDraft();

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 space-y-3 min-w-0">
          <div className="font-medium">
            {draft.contactName ?? draft.contactJid}
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {draft.inboundMessage?.body ?? 'No message'}
          </p>
          {editing ? (
            <TextareaAutosize
              className="w-full resize-none bg-muted rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setEditing(false)}
              autoFocus
              minRows={2}
            />
          ) : (
            <p
              className="text-sm cursor-pointer hover:bg-muted rounded-md p-3 transition-colors whitespace-pre-wrap"
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {body}
            </p>
          )}
        </div>
        <div className="flex flex-row sm:flex-col gap-2 shrink-0">
          <Button
            size="sm"
            onClick={() => {
              approve.mutate(
                { id: draft.id, body },
                { onSuccess: () => toast.success('Sent!') },
              );
            }}
            disabled={approve.isPending}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reject.mutate(draft.id)}
            disabled={reject.isPending}
          >
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}
