// app/lib/api-client.ts — clientul HTTP centralizat către backend-ul ASP.NET Core (.NET 10).
//
// • Browser (Client Components): baza vine din NEXT_PUBLIC_API_URL (inlinată la build).
// • Server (Server Components / Route Handlers): API_INTERNAL_URL (ex. adresa din rețeaua internă
//   Docker), cu rezervă pe NEXT_PUBLIC_API_URL.
// • Autentificare: `auth: true` atașează automat `Authorization: Bearer <access_token>` din sesiunea
//   Supabase Auth a utilizatorului (doar în browser); `token` permite trimiterea explicită a unui token.
// • Erori: backend-ul răspunde cu { error, code } (contractul monolitului); erorile cadrului ASP.NET
//   (ProblemDetails: { title, detail, status }) sunt normalizate la aceeași formă de `readJson`.

const DEFAULT_API_URL = 'http://localhost:5080';

/** `projects.id` este `text`: același șablon ca pe server (fără caractere de control, max 128). */
export const PROJECT_ID_PATTERN = /^[\w.:-]{1,128}$/;

function trimSlash(url: string): string {
  return url.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
}

/** Baza URL a API-ului, în funcție de mediul de execuție (browser vs. server). */
export function apiBaseUrl(): string {
  const publicUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (typeof window === 'undefined') {
    return trimSlash(process.env.API_INTERNAL_URL || publicUrl || DEFAULT_API_URL);
  }
  return trimSlash(publicUrl || DEFAULT_API_URL);
}

/** Originea API-ului (pentru CSP `connect-src`). */
export function apiOrigin(): string {
  try {
    return new URL(apiBaseUrl()).origin;
  } catch {
    return '';
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** true = atașează token-ul sesiunii Supabase curente (dacă există). */
  auth?: boolean;
  /** Token explicit (are prioritate față de `auth`); null/undefined = fără antet. */
  token?: string | null;
  /** Corp JSON (setează automat Content-Type). */
  json?: unknown;
  body?: BodyInit | null;
}

/** Corpul de eroare normalizat (contractul monolitului). */
export interface ApiErrorBody {
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly body: ApiErrorBody = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Limita lunară a planului gratuit (403 LIMIT_REACHED). */
  get isQuotaExceeded(): boolean {
    return this.code === 'LIMIT_REACHED';
  }
}

async function resolveToken(options: ApiFetchOptions): Promise<string | null> {
  if (options.token !== undefined) return options.token;
  if (!options.auth || typeof window === 'undefined') return null;
  // Import dinamic: modulul Supabase (browser) nu se încarcă în Server Components.
  const { getAccessToken } = await import('@/app/lib/supabase/auth');
  return getAccessToken();
}

/**
 * fetch către backend: URL absolut, Bearer token, JSON și `cache: 'no-store'` implicit.
 * Întoarce `Response` (apelanții își păstrează logica pe status), aruncă doar la erori de rețea.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { auth: _auth, token: _token, json, headers, body, ...rest } = options;
  void _auth;
  void _token;
  const finalHeaders = new Headers(headers);
  const token = await resolveToken(options);
  if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  let finalBody: BodyInit | null | undefined = body;
  if (json !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    finalBody = JSON.stringify(json);
  }
  const url = /^https?:\/\//i.test(path) ? path : `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, { cache: 'no-store', ...rest, headers: finalHeaders, body: finalBody });
}

/**
 * Citește corpul JSON fără să arunce (echivalentul `res.json().catch(() => ({}))`) și normalizează
 * ProblemDetails (`title` / `detail`) la `{ error, code }`.
 */
export async function readJson<T = ApiErrorBody>(res: Response): Promise<T & ApiErrorBody> {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!res.ok && typeof data.error !== 'string') {
    const detail = typeof data.detail === 'string' ? data.detail : typeof data.title === 'string' ? data.title : undefined;
    if (detail) data.error = detail;
    if (typeof data.code !== 'string') data.code = res.status === 401 ? 'AUTH_REQUIRED' : res.status === 429 ? 'RATE_LIMITED' : `HTTP_${res.status}`;
  }
  return data as T & ApiErrorBody;
}

/** Variantă „strictă": întoarce datele sau aruncă `ApiError` (401 / 403 / cotă / 5xx). */
export async function apiJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  const data = await readJson<T>(res);
  if (!res.ok) {
    throw new ApiError(res.status, data.code, data.error ?? `HTTP ${res.status}`, data);
  }
  return data;
}
