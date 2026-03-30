import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

export interface ScheduledMessageRecipient {
  id: string;
  scheduledMessageId: string;
  recipientJid: string;
  name: string;
}

export interface ScheduledMessage {
  id: string;
  content: string;
  scheduledAt: number;
  type: 'text' | 'voice' | 'ai';
  status: 'pending' | 'notified' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'expired';
  failCount: number;
  createdAt: number;
  cronExpression: string | null;
  updatedAt: number;
  recipients: ScheduledMessageRecipient[];
}

interface ScheduledMessagesResponse {
  messages: ScheduledMessage[];
}

interface CreateScheduledMessageInput {
  recipientJid: string;
  content: string;
  scheduledAt: number;
  type: string;
  cadence?: 'daily' | 'weekly' | 'monthly';
}

interface EditScheduledMessageInput {
  id: string;
  content: string;
  scheduledAt: number;
  cadence?: 'daily' | 'weekly' | 'monthly' | null;
}

export function useScheduledMessages(tab?: string) {
  return useQuery({
    queryKey: ['scheduled-messages', tab ?? 'all'],
    queryFn: () =>
      apiFetch<ScheduledMessagesResponse>(
        `/api/scheduled-messages${tab ? `?tab=${tab}` : ''}`,
      ).then((r) => r.messages),
    refetchInterval: 15_000,
  });
}

export function useCreateScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateScheduledMessageInput) =>
      apiFetch('/api/scheduled-messages', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
    },
  });
}

export function useEditScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content, scheduledAt, cadence }: EditScheduledMessageInput) =>
      apiFetch(`/api/scheduled-messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content, scheduledAt, cadence }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
    },
  });
}

export function useCancelScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/scheduled-messages/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
    },
  });
}
