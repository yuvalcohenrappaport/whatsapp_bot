import {
  ConfidentialClientApplication,
  type ICachePlugin,
  type TokenCacheContext,
} from '@azure/msal-node';
import pino from 'pino';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/queries/settings.js';

const logger = pino({ level: config.LOG_LEVEL });

const MSAL_CACHE_KEY = 'msal_token_cache';
const MS_TODO_LIST_ID_KEY = 'ms_todo_list_id';
const MS_USER_INFO_KEY = 'ms_user_info';

const SCOPES = ['Tasks.ReadWrite', 'User.Read', 'offline_access'];

// Module-level cached connection state
let connectedCache: boolean | null = null;

const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
    const cached = getSetting(MSAL_CACHE_KEY);
    if (cached) {
      ctx.tokenCache.deserialize(cached);
    }
  },
  async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
    if (ctx.cacheHasChanged) {
      setSetting(MSAL_CACHE_KEY, ctx.tokenCache.serialize());
    }
  },
};

// Only create MSAL client if all MS env vars are set
let msalClient: ConfidentialClientApplication | null = null;

if (config.MS_CLIENT_ID && config.MS_CLIENT_SECRET && config.MS_OAUTH_REDIRECT_URI) {
  msalClient = new ConfidentialClientApplication({
    auth: {
      clientId: config.MS_CLIENT_ID,
      clientSecret: config.MS_CLIENT_SECRET,
      authority: 'https://login.microsoftonline.com/consumers',
    },
    cache: { cachePlugin },
  });
  logger.info('Microsoft To Do: MSAL client initialized');
} else {
  logger.info('Microsoft To Do: not configured (MS_CLIENT_ID, MS_CLIENT_SECRET, or MS_OAUTH_REDIRECT_URI missing)');
}

export function isMicrosoftConfigured(): boolean {
  return msalClient !== null;
}

export async function isMicrosoftConnected(): Promise<boolean> {
  if (!msalClient) return false;
  if (connectedCache !== null) return connectedCache;

  try {
    const accounts = await msalClient.getTokenCache().getAllAccounts();
    connectedCache = accounts.length > 0;
    return connectedCache;
  } catch {
    connectedCache = false;
    return false;
  }
}

export async function getAuthUrl(): Promise<string | null> {
  if (!msalClient) return null;

  return msalClient.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: config.MS_OAUTH_REDIRECT_URI!,
  });
}

export async function handleAuthCallback(
  code: string,
): Promise<{ success: boolean; error?: string }> {
  if (!msalClient) {
    return { success: false, error: 'Microsoft auth not configured' };
  }

  try {
    const tokenResponse = await msalClient.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: config.MS_OAUTH_REDIRECT_URI!,
    });

    // Fetch user info from Graph API /me
    if (tokenResponse?.accessToken) {
      try {
        const res = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${tokenResponse.accessToken}` },
        });
        if (res.ok) {
          const profile = (await res.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
          const userInfo = {
            email: profile.mail || profile.userPrincipalName || '',
            name: profile.displayName || '',
          };
          setSetting(MS_USER_INFO_KEY, JSON.stringify(userInfo));
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to fetch Microsoft user info');
      }
    }

    connectedCache = true;
    logger.info('Microsoft To Do: OAuth callback successful');
    return { success: true };
  } catch (err) {
    logger.error({ err }, 'Microsoft OAuth callback failed');
    return { success: false, error: String(err) };
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!msalClient) return null;

  try {
    const accounts = await msalClient.getTokenCache().getAllAccounts();
    if (accounts.length === 0) return null;

    const tokenResponse = await msalClient.acquireTokenSilent({
      account: accounts[0],
      scopes: ['Tasks.ReadWrite'],
    });

    return tokenResponse?.accessToken ?? null;
  } catch (err: unknown) {
    const errorName = err instanceof Error ? err.name : '';
    if (errorName === 'InteractionRequiredAuthError') {
      logger.warn('Microsoft To Do: interaction required, user needs to re-authorize');
    } else {
      logger.error({ err }, 'Microsoft To Do: failed to acquire token silently');
    }
    return null;
  }
}

export async function disconnectMicrosoft(): Promise<void> {
  if (msalClient) {
    try {
      const accounts = await msalClient.getTokenCache().getAllAccounts();
      for (const account of accounts) {
        await msalClient.getTokenCache().removeAccount(account);
      }
    } catch (err) {
      logger.warn({ err }, 'Error removing MSAL accounts');
    }
  }

  // Clear all Microsoft-related settings
  setSetting(MSAL_CACHE_KEY, '');
  setSetting(MS_TODO_LIST_ID_KEY, '');
  setSetting(MS_USER_INFO_KEY, '');

  connectedCache = false;
  logger.info('Microsoft To Do: disconnected');
}

export function getMicrosoftUserInfo(): { email: string; name: string } | null {
  const raw = getSetting(MS_USER_INFO_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { email: string; name: string };
  } catch {
    return null;
  }
}
