/**
 * useLinkedInImageUpload — XHR-based upload with progress events.
 *
 * Why XHR and not fetch: the Fetch API cannot observe upload progress
 * (ReadableStream of the request body isn't observable for progress). XHR's
 * `upload.onprogress` is the simplest way to surface the percent-complete
 * needed for the drop-zone's progress overlay.
 *
 * Auth: mirrors `useLinkedInPostActions` — dashboard uses JWT bearer tokens
 * from localStorage, NOT cookie auth. Attach `Authorization: Bearer <jwt>`.
 *
 * Used by:
 *   - LinkedInImageDropZone (drag-drop image replace UX)
 *
 * Plan: 36-04
 */
import { useCallback, useRef } from 'react';
import { DashboardPostSchema, type DashboardPost } from '@/api/linkedinSchemas';

/** Discriminated error for image-upload flow. */
export type ImageUploadError =
  | { kind: 'client_mime'; message: string }
  | { kind: 'client_size'; message: string }
  | { kind: 'state_violation'; message: string }
  | { kind: 'validation_error'; message: string }
  | { kind: 'upstream_failure'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'aborted'; message: string }
  | { kind: 'unknown'; message: string };

const ALLOWED_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors pm-authority + @fastify/multipart cap

/**
 * Synchronous client-side validator. Exported as a standalone so the
 * drop-zone component can call it in its onDrop handler BEFORE creating
 * a preview or kicking off a network request.
 */
export function validateImageClientSide(file: File): ImageUploadError | null {
  if (!ALLOWED_MIME.has(file.type)) {
    return {
      kind: 'client_mime',
      message: 'Unsupported image format. Use PNG, JPEG, GIF, or WebP.',
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      kind: 'client_size',
      message: 'Image too large (max 10 MB).',
    };
  }
  return null;
}

export interface UploadProgressEvent {
  loaded: number;
  total: number;
  /** 0-100 integer percent. */
  percent: number;
}

function getToken(): string {
  return localStorage.getItem('jwt') ?? '';
}

export interface UseLinkedInImageUploadResult {
  /**
   * Kick off a multipart upload. Resolves with the updated post on 2xx;
   * rejects with an `ImageUploadError` on any other path (network, 4xx, 5xx,
   * abort, shape drift).
   */
  upload: (
    postId: string,
    file: File,
    onProgress?: (ev: UploadProgressEvent) => void,
  ) => Promise<DashboardPost>;
  /** Abort the in-flight XHR (if any). */
  abort: () => void;
  /** Re-exported for convenience. */
  validateImageClientSide: typeof validateImageClientSide;
}

export function useLinkedInImageUpload(): UseLinkedInImageUploadResult {
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback(
    (
      postId: string,
      file: File,
      onProgress?: (ev: UploadProgressEvent) => void,
    ): Promise<DashboardPost> => {
      return new Promise((resolve, reject) => {
        // Abort any in-flight upload on the same hook instance — single-user
        // dashboard, single upload at a time per hook.
        activeXhrRef.current?.abort();

        const xhr = new XMLHttpRequest();
        activeXhrRef.current = xhr;
        xhr.open(
          'POST',
          `/api/linkedin/posts/${encodeURIComponent(postId)}/upload-image`,
        );
        xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);

        xhr.upload.onprogress = (e) => {
          if (!onProgress) return;
          const total = e.total || file.size || 1;
          onProgress({
            loaded: e.loaded,
            total,
            percent: Math.min(100, Math.floor((e.loaded / total) * 100)),
          });
        };

        xhr.onload = () => {
          activeXhrRef.current = null;

          // Mirror apiFetch: a 401 clears the JWT and redirects to /login.
          if (xhr.status === 401) {
            localStorage.removeItem('jwt');
            window.location.href = '/login';
            reject({
              kind: 'unknown',
              message: 'Unauthorized',
            } as ImageUploadError);
            return;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            let json: unknown = null;
            try {
              json = JSON.parse(xhr.responseText);
            } catch {
              reject({
                kind: 'unknown',
                message: 'upstream returned unparseable body',
              } as ImageUploadError);
              return;
            }
            const parsed = DashboardPostSchema.safeParse(json);
            if (!parsed.success) {
              reject({
                kind: 'unknown',
                message: 'upstream returned unexpected shape',
              } as ImageUploadError);
              return;
            }
            resolve(parsed.data);
            return;
          }

          // Non-2xx — parse error envelope if possible
          let envelope: {
            error?: { code?: string; message?: string };
          } | null = null;
          try {
            envelope = JSON.parse(xhr.responseText);
          } catch {
            /* non-JSON response — fall through to unknown */
          }
          const code = envelope?.error?.code || 'UNKNOWN';
          const message = envelope?.error?.message || `HTTP ${xhr.status}`;
          let err: ImageUploadError;
          switch (code) {
            case 'STATE_VIOLATION':
              err = {
                kind: 'state_violation',
                message:
                  "This post can't accept an image in its current state.",
              };
              break;
            case 'VALIDATION_ERROR':
              err = { kind: 'validation_error', message };
              break;
            case 'UPSTREAM_FAILURE':
              err = {
                kind: 'upstream_failure',
                message: 'Upload failed. Retry?',
              };
              break;
            default:
              err = { kind: 'unknown', message };
          }
          reject(err);
        };

        xhr.onerror = () => {
          activeXhrRef.current = null;
          reject({
            kind: 'network',
            message: 'Network error. Retry?',
          } as ImageUploadError);
        };

        xhr.onabort = () => {
          activeXhrRef.current = null;
          reject({
            kind: 'aborted',
            message: 'upload aborted',
          } as ImageUploadError);
        };

        const form = new FormData();
        form.append('image', file, file.name);
        xhr.send(form);
      });
    },
    [],
  );

  const abort = useCallback(() => {
    activeXhrRef.current?.abort();
    activeXhrRef.current = null;
  }, []);

  return { upload, abort, validateImageClientSide };
}
