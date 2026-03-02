import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

export interface Contact {
  jid: string;
  name: string | null;
  mode: 'off' | 'draft' | 'auto';
  relationship: string | null;
  customInstructions: string | null;
  voiceReplyEnabled: boolean;
  lastMessage: { body: string; timestamp: number } | null;
}

export interface RecentChat {
  jid: string;
  lastMessage: { body: string; timestamp: number } | null;
  alreadyContact: boolean;
}

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => apiFetch<Contact[]>('/api/contacts'),
  });
}

export function useRecentChats() {
  return useQuery({
    queryKey: ['recent-chats'],
    queryFn: () => apiFetch<RecentChat[]>('/api/contacts/recent'),
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jid, patch }: { jid: string; patch: Partial<Pick<Contact, 'mode' | 'relationship' | 'customInstructions' | 'voiceReplyEnabled'>> }) =>
      apiFetch(`/api/contacts/${encodeURIComponent(jid)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useAddContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jid, name }: { jid: string; name?: string }) =>
      apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ jid, name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['recent-chats'] });
    },
  });
}

export function useRemoveContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jid: string) =>
      apiFetch(`/api/contacts/${encodeURIComponent(jid)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
