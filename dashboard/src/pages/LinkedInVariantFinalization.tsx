/**
 * /linkedin/queue/posts/:id/variant — variant finalization page.
 *
 * Plan 37-01 lands this file as a stub. Plan 37-03 fleshes it out with the
 * desktop 50/50 side-by-side variant grid, collapsible image prompts,
 * VariantImageSlot pending UX, and the focus-then-confirm StickyConfirmBar.
 */
import { useParams } from 'react-router-dom';

export default function LinkedInVariantFinalization() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Variant finalization</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Plan 37-03 will render the 2 full-post variants for post {id} here.
      </p>
    </div>
  );
}
