import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateContact, useRemoveContact } from '@/hooks/useContacts';
import type { Contact } from '@/hooks/useContacts';

interface ContactPanelProps {
  contact: Contact;
  onClose: () => void;
}

const modes = ['off', 'draft', 'auto'] as const;

const modeStyles: Record<string, string> = {
  off: 'bg-muted text-muted-foreground hover:bg-muted/80',
  draft: 'bg-blue-600 text-white hover:bg-blue-700',
  auto: 'bg-green-600 text-white hover:bg-green-700',
};

const modeInactiveStyle = 'bg-secondary text-secondary-foreground hover:bg-secondary/80';

export function ContactPanel({ contact, onClose }: ContactPanelProps) {
  const [mode, setMode] = useState(contact.mode);
  const [relationship, setRelationship] = useState(contact.relationship ?? '');
  const [customInstructions, setCustomInstructions] = useState(contact.customInstructions ?? '');

  const updateContact = useUpdateContact();
  const removeContact = useRemoveContact();

  const isSaving = updateContact.isPending;
  const isRemoving = removeContact.isPending;

  function handleModeChange(newMode: typeof mode) {
    setMode(newMode);
    updateContact.mutate(
      { jid: contact.jid, patch: { mode: newMode } },
      { onSuccess: () => toast.success('Mode updated') },
    );
  }

  function handleRelationshipBlur() {
    const trimmed = relationship.trim();
    if (trimmed === (contact.relationship ?? '')) return;
    updateContact.mutate(
      { jid: contact.jid, patch: { relationship: trimmed || null } },
      { onSuccess: () => toast.success('Saved') },
    );
  }

  function handleInstructionsBlur() {
    const trimmed = customInstructions.trim();
    if (trimmed === (contact.customInstructions ?? '')) return;
    updateContact.mutate(
      { jid: contact.jid, patch: { customInstructions: trimmed || null } },
      { onSuccess: () => toast.success('Saved') },
    );
  }

  function handleRemove() {
    removeContact.mutate(contact.jid, {
      onSuccess: () => {
        toast.success('Contact set to Off');
        onClose();
      },
    });
  }

  return (
    <div className="flex flex-col h-full">
      <SheetHeader>
        <SheetTitle className="text-lg">{contact.name ?? contact.jid}</SheetTitle>
        <SheetDescription className="text-xs font-mono truncate">{contact.jid}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 p-4 overflow-y-auto">
        {/* Mode selector */}
        <div className="space-y-2">
          <Label>Mode</Label>
          <div className="flex gap-2">
            {modes.map((m) => (
              <Button
                key={m}
                size="sm"
                variant="ghost"
                disabled={isSaving}
                className={`flex-1 capitalize ${mode === m ? modeStyles[m] : modeInactiveStyle}`}
                onClick={() => handleModeChange(m)}
              >
                {isSaving && mode === m ? <Loader2 className="size-4 animate-spin" /> : m}
              </Button>
            ))}
          </div>
        </div>

        {/* Relationship */}
        <div className="space-y-2">
          <Label htmlFor="relationship">Relationship</Label>
          <Input
            id="relationship"
            placeholder="e.g. close friend, colleague, family..."
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            onBlur={handleRelationshipBlur}
          />
        </div>

        {/* Custom instructions */}
        <div className="space-y-2">
          <Label htmlFor="instructions">Custom Instructions</Label>
          <Textarea
            id="instructions"
            placeholder="e.g. Always respond in Hebrew, keep it short..."
            rows={4}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            onBlur={handleInstructionsBlur}
          />
        </div>
      </div>

      {/* Remove button at bottom */}
      <div className="p-4 border-t">
        <Button
          variant="destructive"
          className="w-full"
          disabled={isRemoving}
          onClick={handleRemove}
        >
          {isRemoving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Set to Off
        </Button>
      </div>
    </div>
  );
}
