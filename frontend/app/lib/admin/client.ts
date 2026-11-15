// app/lib/admin/client.ts — apelurile panoului /admin către /api/admin/** (backend .NET, politica AdminOnly).
// Toate cererile poartă token-ul Supabase; erorile urmează contractul { error, code } (ApiError).
import { apiFetch, apiJson, readJson } from '@/app/lib/api-client';
import type { ClientStatus } from '@/app/lib/database.types';
import type { PlanTier } from '@/app/types';
import type { AccountRole } from '@/app/lib/profile/client';

export type HealthState = 'ok' | 'down' | 'not_configured' | 'demo';

export interface AdminOverview {
  totalUsers: number;
  newUsersLast30Days: number;
  bannedUsers: number;
  admins: number;
  subscribersByPlan: Record<PlanTier, number>;
  payingSubscribers: number;
  estimatedMrrEur: number;
  rendersToday: number;
  rendersThisMonth: number;
  totalRenders: number;
  estimatedRenderCostEur: number;
  estimatedApiCostEur: number;
  estimatedNetMarginEur: number;
  totalProjects: number;
  publicProjectsCount: number;
  totalB2bEstimates: number;
  systemHealth: { database: HealthState; stripe: HealthState; replicate: HealthState; aiProvider: string };
  generatedAt: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  fullName: string | null;
  companyName: string | null;
  /** Planul efectiv (o perioadă plătită expirată apare ca 'starter'). */
  plan: PlanTier;
  storedPlan: PlanTier;
  interval: 'month' | 'year' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeSubscription: boolean;
  role: AccountRole;
  isBanned: boolean;
  bannedReason: string | null;
  generationsUsed: number;
  /** null = nelimitat; include creditele bonus. */
  generationsLimit: number | null;
  bonusGenerations: number;
  quotaResetAt: string | null;
  projectsCount: number;
  createdAt: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminPublicProject {
  id: string;
  title: string;
  mode: string;
  ownerId: string | null;
  ownerEmail: string | null;
  clientStatus: ClientStatus;
  clientFeedback: string | null;
  clientReviewedAt: string | null;
  createdAt: string;
  thumbnail: string | null;
}

export type AuditAction =
  | 'user.update_plan'
  | 'user.adjust_quota'
  | 'user.toggle_ban'
  | 'user.change_role'
  | 'project.unpublish'
  | 'settings.update';

export interface AuditLogEntry {
  id: string;
  adminUserId: string;
  adminEmail: string | null;
  action: AuditAction;
  targetType: 'user' | 'project' | 'settings';
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformSettings {
  planLimits: Record<PlanTier, { monthlyGenerations: number | null }>;
  pricingDisplay: { currency: 'EUR' | 'RON'; annualDiscountPct: number } & Record<PlanTier, { monthlyEur: number }>;
  systemFlags: { maintenanceMode: boolean; allowNewRegistrations: boolean; estimatedRenderCostEur: number };
}

export interface SettingsView {
  settings: PlatformSettings;
  /** false = migrarea 005 nu a fost rulată (setările nu se pot salva). */
  migrated: boolean;
}

export interface UserFilters {
  q?: string;
  plan?: PlanTier | '';
  role?: AccountRole | '';
  banned?: 'true' | 'false' | '';
  page?: number;
  pageSize?: number;
}

export interface UserPatch {
  plan?: PlanTier;
  quotaDelta?: number;
  resetQuota?: boolean;
  role?: AccountRole;
  isBanned?: boolean;
  bannedReason?: string | null;
}

function query(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const fetchOverview = () => apiJson<AdminOverview>('/api/admin/overview', { auth: true });

export const fetchUsers = (f: UserFilters) =>
  apiJson<Paged<AdminUser>>(`/api/admin/users${query({ q: f.q?.trim(), plan: f.plan, role: f.role, banned: f.banned, page: f.page, pageSize: f.pageSize })}`, { auth: true });

export const updateUser = (id: string, patch: UserPatch) =>
  apiJson<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', auth: true, json: patch }).then((r) => r.user);

export const fetchPublicProjects = (q: string, page: number) =>
  apiJson<Paged<AdminPublicProject>>(`/api/admin/public-projects${query({ q: q.trim(), page })}`, { auth: true });

export const unpublishProject = (id: string) =>
  apiJson<{ unpublished: boolean }>(`/api/admin/public-projects/${encodeURIComponent(id)}/unpublish`, { method: 'POST', auth: true });

export const fetchAuditLogs = (page: number) => apiJson<Paged<AuditLogEntry>>(`/api/admin/audit-logs${query({ page })}`, { auth: true });

export const fetchSettings = () => apiJson<SettingsView>('/api/admin/settings', { auth: true });

export const saveSettings = (patch: Partial<PlatformSettings>) =>
  apiJson<SettingsView>('/api/admin/settings', { method: 'PUT', auth: true, json: patch });

// ── Public status (anonim): flag-urile vizibile în UI ───────────────────────────
export interface PublicStatus {
  maintenanceMode: boolean;
  allowNewRegistrations: boolean;
}

export const DEFAULT_STATUS: PublicStatus = { maintenanceMode: false, allowNewRegistrations: true };

/** Nu aruncă: dacă API-ul nu răspunde, UI-ul păstrează comportamentul implicit (înregistrări deschise). */
export async function fetchPublicStatus(): Promise<PublicStatus> {
  try {
    const res = await apiFetch('/api/public/status');
    if (!res.ok) return DEFAULT_STATUS;
    const body = await readJson<Partial<PublicStatus>>(res);
    return {
      maintenanceMode: body.maintenanceMode === true,
      allowNewRegistrations: body.allowNewRegistrations !== false,
    };
  } catch {
    return DEFAULT_STATUS;
  }
}
