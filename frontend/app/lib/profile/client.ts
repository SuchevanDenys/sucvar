// app/lib/profile/client.ts — apelurile paginii de profil (/account) către `GET` / `PUT /api/profile`.
// Un singur agregat de la backend: identitate, firmă + setări B2B, abonament, cotă AI și portofoliu.
import { apiFetch, readJson } from '@/app/lib/api-client';
import type { ClientStatus } from '@/app/lib/database.types';
import type { Party } from '@/app/lib/b2b/exports';
import type { BomItem } from '@/app/lib/procurement';
import type { PlanTier } from '@/app/types';

export type Currency = 'EUR' | 'RON';

export interface ProfileDefaults {
  currency: Currency;
  vatRate: number;
  marginPercent: number;
}

export interface ProfileProject {
  id: string;
  title: string;
  mode: string;
  spaceType: string;
  styleId: string;
  createdAt: string;
  hasImage: boolean;
  isPublic: boolean;
  clientStatus: ClientStatus;
  clientFeedback: string | null;
  clientReviewedAt: string | null;
  /** Lista de materiale & linkuri (salvată în proiect sau recalculată pe server din parametrii Studio). */
  procurementItems?: BomItem[] | null;
  procurementTotal?: number;
  procurementPersisted?: boolean;
}

export interface ProfileView {
  account: { userId: string; email: string; fullName: string | null; avatarUrl: string | null; initials: string; createdAt: string | null };
  company: Required<Party> | null;
  canEditCompany: boolean;
  defaults: ProfileDefaults;
  subscription: { tier: PlanTier; interval: 'month' | 'year' | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; canManageBilling: boolean };
  /** `generationsLimit` null = nelimitat; include deja creditele bonus acordate de un administrator. */
  usage: {
    generationsUsed: number;
    generationsLimit: number | null;
    periodStart: string;
    projectsTotal: number;
    projectsPublic: number;
    estimatesTotal: number;
    bonusGenerations: number;
  };
  projects: ProfileProject[];
  /** false = migrarea 004 nu a fost rulată (avatar și setările implicite nu se pot salva încă). */
  migrated: boolean;
  /** Rolul din `profiles.role` (migrarea 005), verificat pe server — sursa pentru link-ul ADMIN și poarta /b2b. */
  role: AccountRole;
  isBanned: boolean;
  bannedReason: string | null;
}

export type AccountRole = 'user' | 'admin';

export interface ProfileUpdateBody {
  fullName?: string | null;
  avatarUrl?: string | null;
  defaults?: ProfileDefaults;
  company?: Party;
}

export type ProfileResult =
  | { status: 'ok'; data: ProfileView }
  | { status: 'auth' }
  | { status: 'error'; message: string; code?: string };

async function toResult(res: Response): Promise<ProfileResult> {
  if (res.status === 401) return { status: 'auth' };
  const body = await readJson<ProfileView>(res);
  if (!res.ok) return { status: 'error', message: body.error ?? `HTTP ${res.status}`, code: body.code };
  return { status: 'ok', data: body };
}

const NETWORK_ERROR: ProfileResult = { status: 'error', message: 'Conexiunea cu serverul a eșuat. / Could not reach the server.' };

export async function fetchProfile(): Promise<ProfileResult> {
  try {
    return await toResult(await apiFetch('/api/profile', { auth: true }));
  } catch {
    return NETWORK_ERROR;
  }
}

export async function updateProfile(body: ProfileUpdateBody): Promise<ProfileResult> {
  try {
    return await toResult(await apiFetch('/api/profile', { method: 'PUT', auth: true, json: body }));
  } catch {
    return NETWORK_ERROR;
  }
}

export interface ProjectProcurement {
  projectId: string;
  items: BomItem[];
  total: number;
  currency: 'EUR';
  persisted: boolean;
}

/** POST /api/projects/{id}/procurement — recalculează lista din parametrii Studio și o salvează în proiect. */
export async function backfillProcurement(projectId: string): Promise<ProjectProcurement | null> {
  try {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/procurement`, { method: 'POST', auth: true });
    if (!res.ok) return null;
    return (await readJson<{ procurement: ProjectProcurement }>(res)).procurement ?? null;
  } catch {
    return null;
  }
}
