import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

export interface KeywordRule {
  id: string;
  groupJid: string;
  name: string;
  pattern: string;
  isRegex: boolean;
  responseType: 'fixed' | 'ai';
  responseText: string | null;
  aiInstructions: string | null;
  enabled: boolean;
  cooldownMs: number;
  matchCount: number;
  lastTriggeredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateKeywordRuleInput {
  name: string;
  pattern: string;
  isRegex?: boolean;
  responseType: 'fixed' | 'ai';
  responseText?: string;
  aiInstructions?: string;
  cooldownMs?: number;
}

export function useKeywordRules(groupJid: string) {
  return useQuery({
    queryKey: ['keyword-rules', groupJid],
    queryFn: () =>
      apiFetch<KeywordRule[]>(
        `/api/groups/${encodeURIComponent(groupJid)}/keyword-rules`,
      ),
    enabled: !!groupJid,
  });
}

export function useCreateKeywordRule(groupJid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateKeywordRuleInput) =>
      apiFetch(`/api/groups/${encodeURIComponent(groupJid)}/keyword-rules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keyword-rules', groupJid] }),
  });
}

export function useUpdateKeywordRule(groupJid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<CreateKeywordRuleInput & { enabled: boolean }>;
    }) =>
      apiFetch(`/api/keyword-rules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keyword-rules', groupJid] }),
  });
}

export function useDeleteKeywordRule(groupJid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/keyword-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keyword-rules', groupJid] }),
  });
}
