/**
 * EditPostDialog — bilingual modal editor for a LinkedIn post.
 *
 * - Tabs (NOT side-by-side): Hebrew (rtl) + English (ltr).
 *   Default tab = Hebrew if `post.content_he !== null`, else English.
 *   Hebrew tab is hidden entirely for English-only posts.
 * - Character counter per tab ("N / 3000"). Turns red at ≥3000 as a
 *   warning; does NOT gate Save (CONTEXT §2).
 * - Save button disabled when the ACTIVE tab's content is `.trim() === ''`.
 * - On save error the modal stays open with an inline red banner; on
 *   success the modal closes and `onSaved` fires for the optimistic patch.
 * - Cancel / Esc / close-X all dismiss silently (no unsaved-changes prompt).
 *
 * Plan: 36-02
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { LinkedInPost } from './postStatus';
import {
  useLinkedInPostActions,
  actionErrorToToastText,
  type PostActionError,
} from '@/hooks/useLinkedInPostActions';

const CONTENT_LIMIT = 3000;

export interface EditPostDialogProps {
  post: LinkedInPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the updated post when save succeeds (parent patches optimistic state). */
  onSaved: (updated: {
    id: string;
    content: string;
    content_he: string | null;
  }) => void;
}

type TabId = 'he' | 'en';

export function EditPostDialog({
  post,
  open,
  onOpenChange,
  onSaved,
}: EditPostDialogProps) {
  const { editPost } = useLinkedInPostActions();
  const hasHebrew = post !== null && post.content_he !== null;
  const [tab, setTab] = useState<TabId>(hasHebrew ? 'he' : 'en');
  const [enDraft, setEnDraft] = useState('');
  const [heDraft, setHeDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the dialog (re)opens with a post.
  useEffect(() => {
    if (open && post) {
      setEnDraft(post.content);
      setHeDraft(post.content_he ?? '');
      setTab(post.content_he !== null ? 'he' : 'en');
      setError(null);
      setSaving(false);
    }
  }, [open, post]);

  if (!post) return null;

  const activeContent = tab === 'he' ? heDraft : enDraft;
  const activeCount = activeContent.length;
  const countClass =
    activeCount >= CONTENT_LIMIT ? 'text-red-500' : 'text-muted-foreground';
  const saveDisabled = activeContent.trim() === '' || saving;

  async function handleSave() {
    if (saveDisabled || !post) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        content: enDraft,
        content_he: hasHebrew ? heDraft : null,
      };
      const updated = await editPost(post.id, body);
      onSaved({
        id: updated.id,
        content: updated.content,
        content_he: updated.content_he,
      });
      onOpenChange(false);
    } catch (err) {
      const typed = err as PostActionError;
      setError(actionErrorToToastText(typed, 'edit'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList>
            {hasHebrew && <TabsTrigger value="he">Hebrew · עברית</TabsTrigger>}
            <TabsTrigger value="en">English</TabsTrigger>
          </TabsList>

          {hasHebrew && (
            <TabsContent value="he">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">
                  Hebrew content
                </label>
                <span className={'text-xs ' + countClass}>
                  {heDraft.length} / {CONTENT_LIMIT}
                </span>
              </div>
              <Textarea
                dir="rtl"
                lang="he"
                value={heDraft}
                onChange={(e) => setHeDraft(e.target.value)}
                className="min-h-[260px] font-sans"
                disabled={saving}
              />
              {heDraft.trim() === '' && (
                <p className="text-xs text-red-500 mt-1">
                  Content cannot be empty
                </p>
              )}
            </TabsContent>
          )}

          <TabsContent value="en">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">
                English content
              </label>
              <span className={'text-xs ' + countClass}>
                {enDraft.length} / {CONTENT_LIMIT}
              </span>
            </div>
            <Textarea
              dir="ltr"
              lang="en"
              value={enDraft}
              onChange={(e) => setEnDraft(e.target.value)}
              className="min-h-[260px] font-sans"
              disabled={saving}
            />
            {enDraft.trim() === '' && (
              <p className="text-xs text-red-500 mt-1">
                Content cannot be empty
              </p>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveDisabled}>
            {saving && <Loader2 className="size-4 animate-spin mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
