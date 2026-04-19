import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

interface Settings {
  aiProvider: 'gemini' | 'local';
  globalPersona: string | null;
  localModelOnline: boolean;
}

export function useSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<Settings>('/api/settings'),
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: (aiProvider: 'gemini' | 'local') =>
      apiFetch<Settings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ aiProvider }),
      }),
    onMutate: async (aiProvider) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const prev = queryClient.getQueryData<Settings>(['settings']);
      queryClient.setQueryData<Settings>(['settings'], (old) =>
        old
          ? { ...old, aiProvider }
          : { aiProvider, globalPersona: null, localModelOnline: false },
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['settings'], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ globalPersona: string }>('/api/settings/persona/regenerate', {
        method: 'POST',
      }),
    onSuccess: ({ globalPersona }) => {
      queryClient.setQueryData<Settings>(['settings'], (old) =>
        old ? { ...old, globalPersona } : old,
      );
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    setProvider: mutation.mutate,
    isSwitching: mutation.isPending,
    regeneratePersona: regenerateMutation.mutate,
    isRegeneratingPersona: regenerateMutation.isPending,
  };
}
