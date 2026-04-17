/**
 * Fetches the list of pm-authority project names for the New Lesson Run form dropdown.
 * Calls GET /api/linkedin/projects once on mount, returns {projects, loading, error, refresh}.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/api/client';

interface UseLinkedInProjectsResult {
  projects: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLinkedInProjects(): UseLinkedInProjectsResult {
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ projects: string[] }>('/api/linkedin/projects');
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchProjects(); }, [fetchProjects]);

  return { projects, loading, error, refresh: fetchProjects };
}
