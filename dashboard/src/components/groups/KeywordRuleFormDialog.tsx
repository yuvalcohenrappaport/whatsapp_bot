import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCreateKeywordRule,
  useUpdateKeywordRule,
} from '@/hooks/useKeywordRules';
import type { KeywordRule } from '@/hooks/useKeywordRules';

interface KeywordRuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupJid: string;
  rule: KeywordRule | null;
}

export function KeywordRuleFormDialog({
  open,
  onOpenChange,
  groupJid,
  rule,
}: KeywordRuleFormDialogProps) {
  const createRule = useCreateKeywordRule(groupJid);
  const updateRule = useUpdateKeywordRule(groupJid);

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [responseType, setResponseType] = useState<'fixed' | 'ai'>('fixed');
  const [responseText, setResponseText] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(60);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setPattern(rule.pattern);
      setIsRegex(rule.isRegex);
      setResponseType(rule.responseType);
      setResponseText(rule.responseText ?? '');
      setAiInstructions(rule.aiInstructions ?? '');
      setCooldownSeconds(Math.round(rule.cooldownMs / 1000));
    } else {
      setName('');
      setPattern('');
      setIsRegex(false);
      setResponseType('fixed');
      setResponseText('');
      setAiInstructions('');
      setCooldownSeconds(60);
    }
  }, [rule, open]);

  const isPending = createRule.isPending || updateRule.isPending;
  const isEdit = rule !== null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload: Record<string, unknown> = {
      name: name.trim(),
      pattern: pattern.trim(),
      isRegex,
      responseType,
      cooldownMs: cooldownSeconds * 1000,
    };

    if (responseType === 'fixed') {
      payload.responseText = responseText.trim();
    } else {
      payload.aiInstructions = aiInstructions.trim();
    }

    if (isEdit) {
      updateRule.mutate(
        { id: rule.id, patch: payload },
        {
          onSuccess: () => {
            toast.success('Rule updated');
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else {
      createRule.mutate(payload as Parameters<typeof createRule.mutate>[0], {
        onSuccess: () => {
          toast.success('Rule created');
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Rule' : 'Add Keyword Rule'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Greeting reply"
              required
            />
          </div>

          {/* Pattern */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Pattern</Label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Regex
                <Switch
                  size="sm"
                  checked={isRegex}
                  onCheckedChange={setIsRegex}
                />
              </label>
            </div>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={isRegex ? '\\bflight\\b' : 'flight'}
              className="font-mono text-sm"
              required
            />
          </div>

          {/* Response Type */}
          <div className="space-y-2">
            <Label>Response Type</Label>
            <Select
              value={responseType}
              onValueChange={(v) => setResponseType(v as 'fixed' | 'ai')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed text</SelectItem>
                <SelectItem value="ai">AI-generated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Response Text (fixed) */}
          {responseType === 'fixed' && (
            <div className="space-y-2">
              <Label>Response Text</Label>
              <Textarea
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="Text to send when pattern matches..."
                required
              />
            </div>
          )}

          {/* AI Instructions (ai) */}
          {responseType === 'ai' && (
            <div className="space-y-2">
              <Label>AI Instructions</Label>
              <Textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder="System prompt for the AI to generate a response..."
                required
              />
            </div>
          )}

          {/* Cooldown */}
          <div className="space-y-2">
            <Label>Cooldown (seconds)</Label>
            <Input
              type="number"
              value={cooldownSeconds}
              onChange={(e) => setCooldownSeconds(Number(e.target.value))}
              min={0}
              step={1}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
