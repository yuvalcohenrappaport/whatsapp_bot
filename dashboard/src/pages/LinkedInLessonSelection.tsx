/**
 * /linkedin/queue/posts/:id/lesson — lesson selection page.
 *
 * Plan 37-01 lands this file as a stub. Plan 37-02 fleshes it out with the
 * real 4-candidate vertical stack, focus-then-confirm interaction, and the
 * locked page header (project name, perspective, language, source snippet,
 * generation timestamp).
 */
import { useParams } from 'react-router-dom';

export default function LinkedInLessonSelection() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Lesson selection</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Plan 37-02 will render the 4 candidate cards for post {id} here.
      </p>
    </div>
  );
}
