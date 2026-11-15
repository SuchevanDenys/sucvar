// app/lib/b2b/company.ts — datele firmei antreprenorului (furnizorul de pe deviz / Factur-X).
// Sursa de adevăr: backend-ul .NET (`GET/PUT /api/b2b/company`, tabelul `company_profiles`, migrarea 003).
// localStorage rămâne doar cache (profil demo / offline), ca datele să nu se mai piardă la schimbarea
// dispozitivului. Serverul validează CUI (cifra de control ANAF) și IBAN (mod-97).
import { apiFetch, readJson } from '@/app/lib/api-client';
import { getAccessToken } from '@/app/lib/supabase/auth';
import type { Party } from './exports';
import { toSeller } from './portfolio';

export type CompanyResult =
  | { status: 'ok'; data: Required<Party> | null }
  | { status: 'local' | 'offline' }
  | { status: 'invalid' | 'error'; message?: string };

export async function fetchCompany(): Promise<CompanyResult> {
  try {
    const token = await getAccessToken();
    if (!token) return { status: 'local' };
    const res = await apiFetch('/api/b2b/company', { token });
    if (res.status === 401) return { status: 'local' };
    const body = await readJson<{ company?: unknown }>(res);
    if (!res.ok) return { status: 'error', message: body.error };
    return { status: 'ok', data: body.company ? toSeller(body.company) : null };
  } catch {
    return { status: 'offline' };
  }
}

export async function pushCompany(seller: Party): Promise<CompanyResult> {
  try {
    const token = await getAccessToken();
    if (!token) return { status: 'local' };
    const res = await apiFetch('/api/b2b/company', { method: 'PUT', token, json: seller });
    if (res.status === 401 || res.status === 403) return { status: 'local' };
    const body = await readJson<{ company?: unknown }>(res);
    if (res.status === 400) return { status: 'invalid', message: body.error };
    if (!res.ok) return { status: 'error', message: body.error };
    return { status: 'ok', data: toSeller(body.company) };
  } catch {
    return { status: 'offline' };
  }
}
