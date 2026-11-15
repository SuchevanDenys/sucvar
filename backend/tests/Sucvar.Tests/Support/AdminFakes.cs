using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Sucvar.Application;
using Sucvar.Application.Admin;
using Sucvar.Domain.Admin;

namespace Sucvar.Tests.Support;

public sealed class FakeAccountStatusRepository : IAccountStatusRepository
{
    public Dictionary<Guid, AccountStatus> Rows { get; } = new();
    public bool Throw { get; set; }
    public int Calls { get; private set; }

    public Task<AccountStatus> GetAsync(Guid userId, CancellationToken ct = default)
    {
        Calls++;
        if (Throw) throw new AppException(500, "DB_ERROR", "db down");
        return Task.FromResult(Rows.GetValueOrDefault(userId) ?? AccountStatus.Default);
    }

    public void Set(Guid userId, string role = Roles.User, bool banned = false, string? reason = null, int bonus = 0, DateTimeOffset? resetAt = null) =>
        Rows[userId] = new AccountStatus(role, banned, reason, bonus, resetAt, true);
}

public sealed class FakeAppSettingsRepository : IAppSettingsRepository
{
    /// <summary>null = table missing (migration 005 not applied).</summary>
    public Dictionary<string, string>? Rows { get; set; } = PlatformSettings.Keys.ToDictionary(k => k, k => SettingsCodec.ToStorage(PlatformSettings.Defaults, k));
    public List<AuditEntry> Audit { get; } = new();

    public Task<IReadOnlyDictionary<string, string>?> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyDictionary<string, string>?>(Rows is null ? null : new Dictionary<string, string>(Rows));

    public Task SaveAsync(IReadOnlyDictionary<string, string> values, Guid adminUserId, AuditEntry audit, CancellationToken ct = default)
    {
        if (Rows is null) throw new AppException(503, "MIGRATION_REQUIRED", "005");
        foreach (var (k, v) in values) Rows[k] = v;
        Audit.Add(audit);
        return Task.CompletedTask;
    }

    public void Set(PlatformSettings settings)
    {
        Rows = PlatformSettings.Keys.ToDictionary(k => k, k => SettingsCodec.ToStorage(settings, k));
    }
}

/// <summary>In-memory profiles + projects + audit journal, with the same semantics as AdminRepository.</summary>
public sealed class FakeAdminRepository : IAdminRepository
{
    public Dictionary<Guid, AdminUserRow> Users { get; } = new();
    public Dictionary<string, (AdminPublicProject Project, bool IsPublic)> Projects { get; } = new();
    public List<AuditEntry> Audit { get; } = new();
    public List<(Guid UserId, AdminUserChanges Changes)> Applied { get; } = new();
    public bool PingOk { get; set; } = true;
    public AdminOverviewCounts Counts { get; set; } = AdminOverviewCounts.Empty;

    public static AdminUserRow NewUser(Guid id, string email, string tier = "starter", string role = Roles.User, bool banned = false,
        DateTimeOffset? periodEnd = null, bool stripe = false, int bonus = 0, int used = 0) =>
        new(id, email, null, null, tier, null, periodEnd, false, stripe, role, banned, banned ? "spam" : null, bonus, null, used, 0,
            new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));

    public Task<bool> PingAsync(CancellationToken ct = default) => Task.FromResult(PingOk);

    public Task<AdminOverviewCounts> GetOverviewCountsAsync(DateTimeOffset now, DateTimeOffset monthStart, DateTimeOffset dayStart, CancellationToken ct = default) =>
        Task.FromResult(Counts);

    public Task<PagedResult<AdminUserRow>> ListUsersAsync(AdminUserQuery query, DateTimeOffset now, DateTimeOffset monthStart, CancellationToken ct = default)
    {
        var all = Users.Values
            .Where(u => query.Search is null || (u.Email ?? "").Contains(query.Search, StringComparison.OrdinalIgnoreCase))
            .Where(u => query.Role is null || u.Role == query.Role)
            .Where(u => query.Banned is null || u.IsBanned == query.Banned)
            .Where(u => query.Plan is null || Sucvar.Domain.Plans.PlanTiers.ResolveEffectiveTier(u.SubscriptionTier, u.CurrentPeriodEnd, now) == query.Plan)
            .ToList();
        return Task.FromResult(new PagedResult<AdminUserRow>(
            all.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToList(), all.Count, query.Page, query.PageSize));
    }

    public Task<AdminUserRow?> GetUserAsync(Guid userId, DateTimeOffset monthStart, CancellationToken ct = default) =>
        Task.FromResult(Users.GetValueOrDefault(userId));

    public Task ApplyUserChangesAsync(Guid userId, AdminUserChanges changes, IReadOnlyList<AuditEntry> audit, CancellationToken ct = default)
    {
        if (!Users.TryGetValue(userId, out var u)) throw new AppException(404, "NOT_FOUND", "Utilizatorul nu există.");
        Applied.Add((userId, changes));
        if (changes.Tier is { } tier)
        {
            u = u with { SubscriptionTier = tier };
            if (tier == "starter") u = u with { CurrentPeriodEnd = null, BillingInterval = null, CancelAtPeriodEnd = false };
            else if (changes.ClearPeriod) u = u with { CurrentPeriodEnd = null };
        }
        if (changes.QuotaDelta is { } d) u = u with { BonusGenerations = Math.Clamp(u.BonusGenerations + d, 0, 100_000) };
        if (changes.ResetQuota) u = u with { GenerationsUsed = 0, QuotaResetAt = DateTimeOffset.UtcNow };
        if (changes.Role is { } role) u = u with { Role = role };
        if (changes.IsBanned is { } banned) u = u with { IsBanned = banned, BannedReason = banned ? changes.BannedReason : null };
        Users[userId] = u;
        Audit.AddRange(audit);
        return Task.CompletedTask;
    }

    public Task<PagedResult<AdminPublicProject>> ListPublicProjectsAsync(string? search, int page, int pageSize, CancellationToken ct = default)
    {
        var all = Projects.Values.Where(p => p.IsPublic).Select(p => p.Project).ToList();
        return Task.FromResult(new PagedResult<AdminPublicProject>(all.Skip((page - 1) * pageSize).Take(pageSize).ToList(), all.Count, page, pageSize));
    }

    public Task<bool> UnpublishProjectAsync(string projectId, AuditEntry audit, CancellationToken ct = default)
    {
        if (!Projects.TryGetValue(projectId, out var p) || !p.IsPublic) return Task.FromResult(false);
        Projects[projectId] = (p.Project, false);
        Audit.Add(audit);
        return Task.FromResult(true);
    }

    public Task<PagedResult<AuditLogEntry>> ListAuditLogsAsync(int page, int pageSize, CancellationToken ct = default)
    {
        var all = Audit.AsEnumerable().Reverse().Select((a, i) => new AuditLogEntry(i.ToString(), a.AdminUserId.ToString(), a.AdminEmail, a.Action,
            a.TargetType, a.TargetId, JsonDocument.Parse(a.DetailsJson).RootElement.Clone(), "2026-11-15T12:00:00.000000+00:00")).ToList();
        return Task.FromResult(new PagedResult<AuditLogEntry>(all.Skip((page - 1) * pageSize).Take(pageSize).ToList(), all.Count, page, pageSize));
    }
}

public static class SettingsFactory
{
    public static PlatformSettingsService Create(FakeAppSettingsRepository repo, TimeProvider clock) =>
        new(repo, new SettingsCache(), clock, NullLogger<PlatformSettingsService>.Instance);
}
