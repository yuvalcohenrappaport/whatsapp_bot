import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

export interface Reminder {
  id: string;
  task: string;
  fireAt: number;
  status: string;
  calendarEventId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface RemindersResponse {
  reminders: Reminder[];
}

interface ReminderStats {
  pending: number;
  fired: number;
  cancelled: number;
}

export function useReminders(status: string) {
  return useQuery({
    queryKey: ['reminders', status],
    queryFn: () =>
      apiFetch<RemindersResponse>(`/api/reminders?status=${status}`).then(
        (r) => r.reminders,
      ),
    refetchInterval: 15_000,
  });
}

export function useCancelReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/reminders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      qc.invalidateQueries({ queryKey: ['reminder-stats'] });
    },
  });
}

export function useReminderStats() {
  return useQuery({
    queryKey: ['reminder-stats'],
    queryFn: () => apiFetch<ReminderStats>('/api/reminders/stats'),
    refetchInterval: 30_000,
  });
}
