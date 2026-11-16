using System.Text.Json;
using Sucvar.Domain.Admin;

namespace Sucvar.Application.Admin;

/// <summary>
/// Admin / moderation columns of `profiles` (migration 005). <c>Migrated</c> = false when 005 is not applied:
/// everyone is then a regular, non-banned user with no bonus credits (the API keeps working as before).
/// </summary>
public sealed record AccountStatus(string Role, bool IsBanned, string? BannedReason, int BonusGenerations, DateTimeOffset? QuotaResetAt, bool Migrated)
{
    public static readonly AccountStatus Default = new(Roles.User, false, null, 0, null, true);
    public static readonly AccountStatus NotMigrated = Default with { Migrated = false };
    public bool IsActiveAdmin => Role == Roles.Admin && !IsBanned;
}

/// <summary>
/// Reads the moderation state that authorisation depends on. Queried on every admin request and by the account guard,
/// never cached in the JWT, so a ban or demotion takes effect on the very next request.
/// </summary>
public interface IAccountStatusRepository
{
    /// <summary>Missing row → <see cref="AccountStatus.Default"/>; missing 005 columns → <see cref="AccountStatus.NotMigrated"/>.</summary>
    Task<AccountStatus> GetAsync(Guid userId, CancellationToken ct = default);
}

/// <summary>One row of admin_audit_logs to write. <c>DetailsJson</c> is a JSON object.</summary>
public sealed record AuditEntry(Guid AdminUserId, string? AdminEmail, string Action, string TargetType, string TargetId, string DetailsJson);

/// <summary>A stored audit row as returned to the admin UI (<c>Details</c> parsed back to JSON).</summary>
public sealed record AuditLogEntry(
    string Id, string AdminUserId, string? AdminEmail, string Action, string TargetType, string TargetId, JsonElement Details, string CreatedAt);

/// <summary>One page of a server-side paginated listing; <c>Total</c> is the unpaged count.</summary>
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

/// <summary>Persistence port for <c>app_settings</c> (key → jsonb), the runtime-editable platform configuration.</summary>
public interface IAppSettingsRepository
{
    /// <summary>key → jsonb text; null when the table does not exist yet (migration 005 missing).</summary>
    Task<IReadOnlyDictionary<string, string>?> GetAllAsync(CancellationToken ct = default);
    /// <summary>Upserts the given keys and writes the audit row in ONE transaction. 503 MIGRATION_REQUIRED without 005.</summary>
    Task SaveAsync(IReadOnlyDictionary<string, string> values, Guid adminUserId, AuditEntry audit, CancellationToken ct = default);
}

// ── Users ────────────────────────────────────────────────────────────────────────

/// <summary>Filters for the admin user list; null members mean "no filter".</summary>
public sealed record AdminUserQuery(string? Search, string? Plan, string? Role, bool? Banned, int Page, int PageSize);

/// <summary>Raw row; the service derives the effective plan and the generation limit.</summary>
public sealed record AdminUserRow(
    Guid Id,
    string? Email,
    string? FullName,
    string? CompanyName,
    string? SubscriptionTier,
    string? BillingInterval,
    DateTimeOffset? CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    bool HasStripeSubscription,
    string Role,
    bool IsBanned,
    string? BannedReason,
    int BonusGenerations,
    DateTimeOffset? QuotaResetAt,
    int GenerationsUsed,
    int ProjectsCount,
    DateTimeOffset? CreatedAt);

/// <summary>
/// Columns to write. <c>Tier</c> != null also normalises the billing period so the grant takes effect
/// (see AdminService.UpdateUserAsync). <c>QuotaDelta</c> is applied relatively (bonus_generations + delta, clamped ≥ 0).
/// </summary>
public sealed record AdminUserChanges(
    string? Tier, bool ClearPeriod, int? QuotaDelta, bool ResetQuota, string? Role, bool? IsBanned, string? BannedReason)
{
    public bool IsEmpty => Tier is null && QuotaDelta is null && !ResetQuota && Role is null && IsBanned is null;
}

// ── Overview ─────────────────────────────────────────────────────────────────────

/// <summary>Raw KPI counters computed in SQL; monetary figures are derived from them in <see cref="AdminService"/>.</summary>
public sealed record AdminOverviewCounts(
    int TotalUsers,
    int NewUsersLast30Days,
    int BannedUsers,
    int Admins,
    int StarterUsers,
    int ProUsers,
    int AgencyUsers,
    int PayingProMonthly,
    int PayingProYearly,
    int PayingAgencyMonthly,
    int PayingAgencyYearly,
    int RendersToday,
    int RendersThisMonth,
    int TotalRenders,
    int TotalProjects,
    int PublicProjects,
    int TotalB2bEstimates)
{
    public static readonly AdminOverviewCounts Empty = new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

// ── Public portals ───────────────────────────────────────────────────────────────

/// <summary>A public portal as seen by moderators (owner identity included — admin-only projection).</summary>
public sealed record AdminPublicProject(
    string Id,
    string Title,
    string Mode,
    string? OwnerId,
    string? OwnerEmail,
    string ClientStatus,
    string? ClientFeedback,
    string? ClientReviewedAt,
    string CreatedAt,
    string? Thumbnail);

/// <summary>Persistence port for the back-office. Mutations always receive their audit rows and commit them atomically.</summary>
public interface IAdminRepository
{
    Task<bool> PingAsync(CancellationToken ct = default);
    Task<AdminOverviewCounts> GetOverviewCountsAsync(DateTimeOffset now, DateTimeOffset monthStart, DateTimeOffset dayStart, CancellationToken ct = default);
    Task<PagedResult<AdminUserRow>> ListUsersAsync(AdminUserQuery query, DateTimeOffset now, DateTimeOffset monthStart, CancellationToken ct = default);
    Task<AdminUserRow?> GetUserAsync(Guid userId, DateTimeOffset monthStart, CancellationToken ct = default);
    /// <summary>Writes the profile columns and ALL audit rows in one transaction.</summary>
    Task ApplyUserChangesAsync(Guid userId, AdminUserChanges changes, IReadOnlyList<AuditEntry> audit, CancellationToken ct = default);
    Task<PagedResult<AdminPublicProject>> ListPublicProjectsAsync(string? search, int page, int pageSize, CancellationToken ct = default);
    /// <summary>is_public = false + audit row, atomically. False when the project is missing or already private.</summary>
    Task<bool> UnpublishProjectAsync(string projectId, AuditEntry audit, CancellationToken ct = default);
    Task<PagedResult<AuditLogEntry>> ListAuditLogsAsync(int page, int pageSize, CancellationToken ct = default);
}
