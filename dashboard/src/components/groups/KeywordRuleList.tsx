import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  useKeywordRules,
  useUpdateKeywordRule,
  useDeleteKeywordRule,
} from '@/hooks/useKeywordRules';
import type { KeywordRule } from '@/hooks/useKeywordRules';
import { KeywordRuleFormDialog } from './KeywordRuleFormDialog';

function formatTimestamp(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

interface KeywordRuleListProps {
  groupJid: string;
}

export function KeywordRuleList({ groupJid }: KeywordRuleListProps) {
  const { data: rules, isLoading } = useKeywordRules(groupJid);
  const updateRule = useUpdateKeywordRule(groupJid);
  const deleteRule = useDeleteKeywordRule(groupJid);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<KeywordRule | null>(null);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Label>Keyword Rules</Label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingRule(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Add rule
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && rules?.length === 0 && (
        <p className="text-sm text-muted-foreground">No keyword rules yet.</p>
      )}

      {/* Rule rows */}
      {rules?.map((rule) => (
        <div
          key={rule.id}
          className="flex items-start justify-between gap-2 bg-muted rounded-md px-3 py-2"
        >
          {/* Left side */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{rule.name}</span>
              <Badge variant="outline" className="text-xs">
                {rule.isRegex ? 'regex' : 'keyword'}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {rule.responseType === 'fixed' ? 'fixed' : 'ai'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {rule.pattern}
            </p>
            <p className="text-xs text-muted-foreground">
              {rule.matchCount} match{rule.matchCount === 1 ? '' : 'es'}
              {rule.lastTriggeredAt != null &&
                ` \u00b7 last: ${formatTimestamp(rule.lastTriggeredAt)}`}
            </p>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Switch
              size="sm"
              checked={rule.enabled}
              onCheckedChange={(enabled) =>
                updateRule.mutate(
                  { id: rule.id, patch: { enabled } },
                  {
                    onSuccess: () =>
                      toast.success(enabled ? 'Rule enabled' : 'Rule disabled'),
                  },
                )
              }
            />
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => {
                setEditingRule(rule);
                setFormOpen(true);
              }}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                deleteRule.mutate(rule.id, {
                  onSuccess: () => toast.success('Rule deleted'),
                })
              }
              disabled={deleteRule.isPending}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      ))}

      {/* Form dialog */}
      <KeywordRuleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        groupJid={groupJid}
        rule={editingRule}
      />
    </div>
  );
}
