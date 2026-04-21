/**
 * NewPostDialog — modal composer for a fully-manual LinkedIn post.
 *
 * Six fields: title, project, language (en/he/he+en), perspective (yuval/claude),
 * content, and content_he (visible only when language != 'en'). Submits to
 * POST /api/linkedin/posts via useLinkedInCreatePost; on success the parent
 * fires a toast and the existing SSE stream delivers the new PENDING_REVIEW
 * post to the queue within ~3s (no optimistic patch).
 *
 * Validation:
 *   - Title required (1-200)
 *   - Content required
 *   - Content (Hebrew) required when language in {he, he+en}
 *   - Project required
 *   Inline errors surface on blur + on submit; upstream 400 VALIDATION_ERROR
 *   field errors (e.g. from pm-authority's @model_validator) merge into the
 *   same state map so Zod proxy + Pydantic upstream paths both light up the
 *   correct field.
 *
 * Persistence (localStorage key `linkedin-new-post-defaults`):
 *   { language, project_name, perspective }
 *   Text fields always reset empty.
 *
 * Plan: 48-03
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useLinkedInProjects } from '@/hooks/useLinkedInProjects';
import {
  useLinkedInCreatePost,
  type CreatePostResult,
} from '@/hooks/useLinkedInCreatePost';
import type { DashboardPost } from '@/api/linkedinSchemas';

const STORAGE_KEY = 'linkedin-new-post-defaults';
const CUSTOM_VALUE = '__custom__';
const TITLE_MAX = 200;

type Language = 'en' | 'he' | 'he+en';
type Perspective = 'yuval' | 'claude';

interface SavedDefaults {
  language: Language;
  project_name: string;
  perspective: Perspective;
}

function loadDefaults(): SavedDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedDefaults;
  } catch {
    // ignore
  }
  return { language: 'en', project_name: '', perspective: 'yuval' };
}

function saveDefaults(d: SavedDefaults) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // ignore
  }
}

export interface NewPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fires after pm-authority confirms creation. Parent doesn't need an
   * optimistic patch — the SSE stream already surfaces PENDING_REVIEW posts
   * on the next poll cycle (~3s).
   */
  onCreated: (post: DashboardPost) => void;
}

export function NewPostDialog({
  open,
  onOpenChange,
  onCreated,
}: NewPostDialogProps) {
  const { projects, loading: projectsLoading } = useLinkedInProjects();
  const { createPost, loading: submitting } = useLinkedInCreatePost();

  const defaultsRef = useRef<SavedDefaults>(loadDefaults());

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contentHe, setContentHe] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [perspective, setPerspective] = useState<Perspective>('yuval');
  const [selectValue, setSelectValue] = useState('');
  const [customProject, setCustomProject] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset fields when dialog opens; hydrate radios + project from localStorage.
  useEffect(() => {
    if (open) {
      const d = loadDefaults();
      defaultsRef.current = d;
      setTitle('');
      setContent('');
      setContentHe('');
      setLanguage(d.language);
      setPerspective(d.perspective);
      setSelectValue(d.project_name);
      setCustomProject('');
      setErrors({});
      setSubmitError(null);
    }
  }, [open]);

  // After projects load, reconcile stored project_name against the live list.
  useEffect(() => {
    if (!open || projectsLoading) return;
    const d = defaultsRef.current;
    if (!d.project_name) return;
    if (projects.includes(d.project_name)) {
      setSelectValue(d.project_name);
    } else {
      setSelectValue(CUSTOM_VALUE);
      setCustomProject(d.project_name);
    }
  }, [open, projectsLoading, projects]);

  const isCustom = selectValue === CUSTOM_VALUE;
  const resolvedProject = isCustom ? customProject.trim() : selectValue;
  const needsHebrew = language === 'he' || language === 'he+en';

  function clearError(field: string) {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateAll(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Title is required';
    else if (title.trim().length > TITLE_MAX)
      next.title = `Title must be ≤${TITLE_MAX} characters`;
    if (!content.trim()) next.content = 'Content is required';
    if (needsHebrew && !contentHe.trim())
      next.content_he = 'Hebrew content is required for this language';
    if (!resolvedProject) next.project_name = 'Select a project';
    return next;
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      const validation = validateAll();
      if (Object.keys(validation).length > 0) {
        setErrors(validation);
        return;
      }
      setErrors({});

      const result: CreatePostResult = await createPost({
        title: title.trim(),
        content,
        content_he: needsHebrew ? contentHe : null,
        language,
        project_name: resolvedProject,
        perspective,
      });

      switch (result.kind) {
        case 'created':
          saveDefaults({
            language,
            project_name: resolvedProject,
            perspective,
          });
          onOpenChange(false);
          onCreated(result.post);
          break;
        case 'validation':
          setErrors(result.fieldErrors);
          if (Object.keys(result.fieldErrors).length === 0) {
            setSubmitError(result.message);
          }
          break;
        case 'not_found':
          setErrors({ project_name: result.message });
          break;
        case 'error':
          setSubmitError(result.message);
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      title,
      content,
      contentHe,
      language,
      perspective,
      resolvedProject,
      needsHebrew,
      createPost,
      onCreated,
      onOpenChange,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Post</DialogTitle>
          <DialogDescription>
            Compose a LinkedIn post. It will land in the queue as Pending Review.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="np-title">Title</Label>
              {title.length > 150 && (
                <span className="text-xs text-muted-foreground">
                  {title.length} / {TITLE_MAX}
                </span>
              )}
            </div>
            <Input
              id="np-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) clearError('title');
              }}
              onBlur={() => {
                if (!title.trim())
                  setErrors((p) => ({ ...p, title: 'Title is required' }));
              }}
              maxLength={TITLE_MAX + 20}
              autoFocus
            />
            {errors.title && (
              <p className="text-sm text-destructive mt-1">{errors.title}</p>
            )}
          </div>

          {/* Project */}
          <div className="space-y-2">
            <Label htmlFor="np-project">Project</Label>
            <Select
              value={selectValue}
              onValueChange={(v) => {
                setSelectValue(v);
                if (v !== CUSTOM_VALUE) setCustomProject('');
                if (errors.project_name) clearError('project_name');
              }}
            >
              <SelectTrigger id="np-project">
                <SelectValue
                  placeholder={
                    projectsLoading ? 'Loading…' : 'Select a project'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
              </SelectContent>
            </Select>
            {isCustom && (
              <Input
                placeholder="Enter project name"
                value={customProject}
                onChange={(e) => {
                  setCustomProject(e.target.value);
                  if (errors.project_name) clearError('project_name');
                }}
                onBlur={() => {
                  if (!resolvedProject)
                    setErrors((p) => ({
                      ...p,
                      project_name: 'Select a project',
                    }));
                }}
                autoFocus
              />
            )}
            {errors.project_name && (
              <p className="text-sm text-destructive mt-1">
                {errors.project_name}
              </p>
            )}
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label>Language</Label>
            <RadioGroup
              value={language}
              onValueChange={(v) => {
                setLanguage(v as Language);
                // Clear stale content_he error when switching away from he/he+en.
                if (v === 'en' && errors.content_he) clearError('content_he');
              }}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="en" id="np-lang-en" />
                <Label htmlFor="np-lang-en" className="font-normal cursor-pointer">
                  English
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="he" id="np-lang-he" />
                <Label htmlFor="np-lang-he" className="font-normal cursor-pointer">
                  Hebrew
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="he+en" id="np-lang-bi" />
                <Label htmlFor="np-lang-bi" className="font-normal cursor-pointer">
                  Bilingual (he+en)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Perspective */}
          <div className="space-y-2">
            <Label>Perspective</Label>
            <RadioGroup
              value={perspective}
              onValueChange={(v) => setPerspective(v as Perspective)}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="yuval" id="np-persp-yuval" />
                <Label
                  htmlFor="np-persp-yuval"
                  className="font-normal cursor-pointer"
                >
                  Yuval (first person)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="claude" id="np-persp-claude" />
                <Label
                  htmlFor="np-persp-claude"
                  className="font-normal cursor-pointer"
                >
                  Claude (collaborator)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="np-content">
              {language === 'he' ? 'Content (Hebrew fallback)' : 'Content'}
            </Label>
            <Textarea
              id="np-content"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (errors.content) clearError('content');
              }}
              onBlur={() => {
                if (!content.trim())
                  setErrors((p) => ({ ...p, content: 'Content is required' }));
              }}
              rows={8}
              dir={language === 'he' ? 'rtl' : 'ltr'}
              lang={language === 'he' ? 'he' : 'en'}
            />
            {errors.content && (
              <p className="text-sm text-destructive mt-1">{errors.content}</p>
            )}
          </div>

          {/* Content (Hebrew) */}
          {needsHebrew && (
            <div className="space-y-2">
              <Label htmlFor="np-content-he">Content (Hebrew)</Label>
              <Textarea
                id="np-content-he"
                value={contentHe}
                onChange={(e) => {
                  setContentHe(e.target.value);
                  if (errors.content_he) clearError('content_he');
                }}
                onBlur={() => {
                  if (!contentHe.trim())
                    setErrors((p) => ({
                      ...p,
                      content_he: 'Hebrew content is required for this language',
                    }));
                }}
                rows={8}
                dir="rtl"
                lang="he"
              />
              {errors.content_he && (
                <p className="text-sm text-destructive mt-1">
                  {errors.content_he}
                </p>
              )}
            </div>
          )}

          {submitError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
              {submitError}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus className="size-4 mr-2" />
                  Create Post
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
