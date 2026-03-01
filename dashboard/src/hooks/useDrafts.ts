import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

export interface Draft {
  id: string;
  contactJid: string;
  contactName: string | null;
  inboundMessage: { body: string; timestamp: number } | null;
  body: string;
  createdAt: number;
}

export function useDrafts() {
  return useQuery({
    queryKey: ['drafts'],
    queryFn: () => apiFetch<Draft[]>('/api/drafts'),
    refetchInterval: 15_000,
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiFetch(`/api/drafts/${id}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] });
    },
  });
}

export function useRejectDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/drafts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] });
    },
  });
}

export function useClearDrafts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch('/api/drafts', { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts'] });
    },
  });
}
