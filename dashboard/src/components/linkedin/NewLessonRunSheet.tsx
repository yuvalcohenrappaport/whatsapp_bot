/**
 * NewLessonRunSheet — slide-out form for starting a lesson-mode generation run.
 *
 * CONTEXT locks honored:
 * - Project picker: dropdown from live API + "Custom..." free-text fallback
 * - Perspective: 2-option radio — "Yuval (first person)" / "Claude (collaborator)"
 * - Language: 3-option radio — English / Hebrew / Bilingual (he+en)
 * - Topic hint: optional Textarea, resets each time
 * - Validation: on blur + re-validate on submit
 * - Submit: redirect + toast on success, inline error + 60s countdown on 409
 * - localStorage: remembers last project/perspective/language
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { Loader2 } from 'lucide-react';
import { useLinkedInProjects } from '@/hooks/useLinkedInProjects';
import {
  useLinkedInStartLessonRun,
  type StartLessonRunResult,
} from '@/hooks/useLinkedInStartLessonRun';

const STORAGE_KEY = 'linkedin-new-run-defaults';
const CUSTOM_VALUE = '__custom__';

interface SavedDefaults {
  project: string;
  perspective: string;
  language: string;
}

function loadDefaults(): SavedDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedDefaults;
  } catch {
    // ignore
  }
  return { project: '', perspective: 'yuval', language: 'en' };
}

function saveDefaults(d: SavedDefaults) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

export interface NewLessonRunSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful submit. Parent handles toast + pending-run tracking. */
  onStarted: (projectName: string) => void;
}

export function NewLessonRunSheet({
  open,
  onOpenChange,
  onStarted,
}: NewLessonRunSheetProps) {
  const { projects, loading: projectsLoading } = useLinkedInProjects();
  const { startRun, loading: submitting } = useLinkedInStartLessonRun();

  // Form state
  const defaults = useRef(loadDefaults());
  const [selectValue, setSelectValue] = useState('');
  const [customProject, setCustomProject] = useState('');
  const [perspective, setPerspective] = useState('yuval');
  const [language, setLanguage] = useState('en');
  const [topicHint, setTopicHint] = useState('');

  // Errors
  const [projectError, setProjectError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 409 retry countdown
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize form from localStorage when sheet opens
  useEffect(() => {
    if (open) {
      const d = loadDefaults();
      defaults.current = d;
      // If stored project is in the list, select it; else treat as custom
      // We'll resolve this once projects load
      setSelectValue(d.project);
      setCustomProject('');
      setPerspective(d.perspective || 'yuval');
      setLanguage(d.language || 'en');
      setTopicHint('');
      setProjectError(null);
      setSubmitError(null);
      setCountdown(0);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
  }, [open]);

  // Once projects load, resolve the select value:
  // If stored project matches a known project, keep it. Otherwise set to custom.
  useEffect(() => {
    if (!open || projectsLoading || projects.length === 0) return;
    const d = defaults.current;
    if (d.project && !projects.includes(d.project)) {
      setSelectValue(CUSTOM_VALUE);
      setCustomProject(d.project);
    } else if (d.project && projects.includes(d.project)) {
      setSelectValue(d.project);
    }
  }, [open, projectsLoading, projects]);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const isCustom = selectValue === CUSTOM_VALUE;
  const resolvedProject = isCustom ? customProject.trim() : selectValue;

  function validateProject(): boolean {
    if (!resolvedProject) {
      setProjectError('Select a project');
      return false;
    }
    setProjectError(null);
    return true;
  }

  function handleProjectBlur() {
    validateProject();
  }

  function startCountdown(ms: number) {
    const seconds = Math.ceil(ms / 1000);
    setCountdown(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);
      setProjectError(null);

      if (!validateProject()) return;

      const result: StartLessonRunResult = await startRun({
        project_name: resolvedProject,
        perspective,
        language,
        topic_hint: topicHint.trim() || null,
      });

      switch (result.kind) {
        case 'started':
          saveDefaults({ project: resolvedProject, perspective, language });
          onOpenChange(false);
          onStarted(resolvedProject);
          break;
        case 'busy':
          setSubmitError('Generator is busy -- try again in a minute');
          startCountdown(result.retryAfterMs);
          break;
        case 'not_found':
          setProjectError(`Project '${resolvedProject}' not found in pm-authority`);
          break;
        case 'error':
          setSubmitError(result.message);
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedProject, perspective, language, topicHint, startRun, onOpenChange, onStarted],
  );

  const isSubmitDisabled = submitting || countdown > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Lesson Run</SheetTitle>
          <SheetDescription>
            Start a new lesson-mode generation run. The resulting post will appear in the queue.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-5 px-4 pb-4">
          {/* Project picker */}
          <div className="space-y-2">
            <Label htmlFor="project-select">Project</Label>
            <Select
              value={selectValue}
              onValueChange={(v) => {
                setSelectValue(v);
                if (v !== CUSTOM_VALUE) {
                  setCustomProject('');
                  setProjectError(null);
                }
              }}
            >
              <SelectTrigger
                id="project-select"
                onBlur={handleProjectBlur}
              >
                <SelectValue placeholder={projectsLoading ? 'Loading...' : 'Select a project'} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_VALUE}>Custom...</SelectItem>
              </SelectContent>
            </Select>
            {isCustom && (
              <Input
                placeholder="Enter project name"
                value={customProject}
                onChange={(e) => {
                  setCustomProject(e.target.value);
                  if (projectError) setProjectError(null);
                }}
                onBlur={handleProjectBlur}
                autoFocus
              />
            )}
            {projectError && (
              <p className="text-sm text-destructive">{projectError}</p>
            )}
          </div>

          {/* Perspective radio */}
          <div className="space-y-2">
            <Label>Perspective</Label>
            <RadioGroup value={perspective} onValueChange={setPerspective}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="yuval" id="perspective-yuval" />
                <Label htmlFor="perspective-yuval" className="font-normal cursor-pointer">
                  Yuval (first person)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="claude" id="perspective-claude" />
                <Label htmlFor="perspective-claude" className="font-normal cursor-pointer">
                  Claude (collaborator)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Language radio */}
          <div className="space-y-2">
            <Label>Language</Label>
            <RadioGroup value={language} onValueChange={setLanguage}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="en" id="lang-en" />
                <Label htmlFor="lang-en" className="font-normal cursor-pointer">
                  English
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="he" id="lang-he" />
                <Label htmlFor="lang-he" className="font-normal cursor-pointer">
                  Hebrew
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="he+en" id="lang-bilingual" />
                <Label htmlFor="lang-bilingual" className="font-normal cursor-pointer">
                  Bilingual (he+en)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Topic hint */}
          <div className="space-y-2">
            <Label htmlFor="topic-hint">Topic hint</Label>
            <Textarea
              id="topic-hint"
              placeholder="Optional -- steer what lesson Claude picks"
              value={topicHint}
              onChange={(e) => setTopicHint(e.target.value)}
              rows={3}
            />
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitDisabled}
          >
            {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
            {countdown > 0
              ? `Retry in ${countdown}s`
              : submitting
                ? 'Starting...'
                : 'Start Lesson Run'}
          </Button>

          {submitError && (
            <p className="text-sm text-destructive text-center">{submitError}</p>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
