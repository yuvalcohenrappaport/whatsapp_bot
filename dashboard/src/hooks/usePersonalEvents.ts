import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

export interface PersonalEvent {
  id: string;
  sourceChatJid: string;
  sourceChatName: string | null;
  senderJid: string;
  senderName: string | null;
  sourceMessageText: string;
  title: string;
  eventDate: number;
  location: string | null;
  description: string | null;
  isAllDay: boolean | null;
  status: string;
  createdAt: number;
}

interface EventsResponse {
  events: PersonalEvent[];
}

export function usePersonalEvents(status: 'pending' | 'approved' | 'rejected') {
  return useQuery({
    queryKey: ['personal-events', status],
    queryFn: () =>
      apiFetch<EventsResponse>(`/api/personal-calendar/events?status=${status}`).then(
        (r) => r.events,
      ),
    refetchInterval: 15_000,
  });
}

export function usePersonalEventsCount() {
  const { data } = usePersonalEvents('pending');
  return data?.length ?? 0;
}

export function useApproveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/personal-calendar/pending/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal-events'] });
    },
  });
}

export function useRejectEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/personal-calendar/pending/${id}/reject`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal-events'] });
    },
  });
}
