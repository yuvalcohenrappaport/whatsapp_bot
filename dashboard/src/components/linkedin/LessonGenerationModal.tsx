/**
 * Modal overlay shown during the pick-lesson → variant-generation wait.
 *
 * CONTEXT §Area 3 Scenario A: locked to the current page, no nav-away while
 * pm-authority is generating the 2 variants. The only escape hatch is the
 * browser back button. Escape key + outside click are explicitly suppressed.
 *
 * Two visual modes:
 *   - 'running' → spinner + "Generating variants…" copy + context.
 *   - 'failed'  → error copy + a single "Back to queue" button.
 *
 * Plan 37-02 Task 2 — replaces the Plan 37-01 stub body.
 */
import { Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface LessonGenerationModalProps {
  open: boolean;
  status: 'running' | 'failed';
  errorMessage?: string;
  onBackToQueue: () => void;
}

export function LessonGenerationModal({
  open,
  status,
  errorMessage,
  onBackToQueue,
}: LessonGenerationModalProps) {
  return (
    <Dialog
      open={open}
      // Locked during generation; browser back button is the escape hatch.
      // Failure mode provides an explicit 'Back to queue' button instead of
      // wiring dismiss into the Dialog primitive.
      onOpenChange={() => {
        /* no-op */
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        {status === 'running' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="size-5 animate-spin text-blue-600" />
                Generating variants…
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              pm-authority is generating the two post variants from your
              chosen lesson. This usually takes 10-60 seconds. Please
              don&apos;t close the tab — we&apos;ll navigate you to the
              variant view when generation completes. (The browser back
              button is the only escape hatch.)
            </p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertCircle className="size-5" />
                Generation failed
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {errorMessage ?? 'Something went wrong during variant generation.'}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onBackToQueue}>
                Back to queue
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
