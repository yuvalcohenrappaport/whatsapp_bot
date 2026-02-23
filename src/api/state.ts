import type { WASocket } from '@whiskeysockets/baileys';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'qr_pending';

interface BotState {
  connection: ConnectionStatus;
  qr: string | null;
  sock: WASocket | null;
  listeners: Set<(state: BotState) => void>;
}

const state: BotState = {
  connection: 'disconnected',
  qr: null,
  sock: null,
  listeners: new Set(),
};

export function updateState(patch: Partial<Omit<BotState, 'listeners'>>): void {
  Object.assign(state, patch);
  state.listeners.forEach((fn) => fn(state));
}

export function subscribe(fn: (state: BotState) => void): () => void {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}

export function getState() {
  return { connection: state.connection, qr: state.qr, sock: state.sock };
}
