using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Sucvar.Application.Quota;
using Sucvar.Domain.Admin;
using Sucvar.Domain.Plans;

namespace Sucvar.Application.Admin;

public sealed record SubscribersByPlan(int Starter, int Pro, int Agency);

/// <summary>`database`: ok | down · `stripe`: ok | not_configured · `replicate`: ok | demo | not_configured.</summary>
public sealed record SystemHealth(string Database, string Stripe, string Replicate, string AiProvider);

public sealed record AdminOverview(
    int TotalUsers,
    int NewUsersLast30Days,
    int BannedUsers,
    int Admins,
    SubscribersByPlan SubscribersByPlan,
    int PayingSubscribers,
    decimal EstimatedMrrEur,
    int RendersToday,
    int RendersThisMonth,
    int TotalRenders,
    decimal EstimatedRenderCostEur,
    decimal EstimatedApiCostEur,
    decimal EstimatedNetMarginEur,
    int TotalProjects,
    int PublicProjectsCount,
    int TotalB2bEstimates,
    SystemHealth SystemHealth,
    string GeneratedAt);

/// <summary>What the admin UI shows for a user. `GenerationsLimit` null = unlimited (already includes the bonus).</summary>
public sealed record AdminUserView(
    string Id,
    string? Email,
    string? FullName,
    string? CompanyName,
    string Plan,
    string StoredPlan,
    string? Interval,
    string? CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    bool HasStripeSubscription,
    string Role,
    bool IsBanned,
    string? BannedReason,
    int GenerationsUsed,
    int? GenerationsLimit,
    int BonusGenerations,
    string? QuotaResetAt,
    int ProjectsCount,
    string? CreatedAt);

/// <summary>
/// /api/admin/**: platform KPIs, user & subscription management, public-portal moderation, audit log.
/// Every mutation is written together with its admin_audit_logs row (one transaction in the repository).
/// Self-protection: an admin can never ban or demote their own account (400 SELF_PROTECTION).
/// </summary>
public sealed class AdminService(
    IAdminRepository repository,
    PlatformSettingsService settings,
    IStripeGateway stripe,
    IImageProviderSelector ai,
    TimeProvider clock,
    ILogger<AdminService> logger)
{
    public const int UsersDefaultPageSize = 25;
    public const int UsersMaxPageSize = 100;
    public const int ProjectsDefaultPageSize = 12;
    public const int ProjectsMaxPageSize = 24;
    public const int AuditDefaultPageSize = 50;
    public const int AuditMaxPageSize = 100;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ── Overview ───────────────────────────────────────────────────────────────

    public async Task<AdminOverview> GetOverviewAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var monthStart = QuotaService.MonthStartUtc(now);
        var dayStart = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var platform = await settings.GetAsync(ct);

        var databaseOk = await SafePingAsync(ct);
        var counts = AdminOverviewCounts.Empty;
        if (databaseOk)
        {
            try
            {
                counts = await repository.GetOverviewCountsAsync(now, monthStart, dayStart, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "[SUCVAR] admin overview: numărare eșuată");
                databaseOk = false;
            }
        }

        var pricing = platform.PricingDisplay;
        var yearlyFactor = 1 - pricing.AnnualDiscountPct / 100m; // annual price expressed per month
        var mrr = pricing.Pro.MonthlyEur * (counts.PayingProMonthly + counts.PayingProYearly * yearlyFactor)
                + pricing.Agency.MonthlyEur * (counts.PayingAgencyMonthly + counts.PayingAgencyYearly * yearlyFactor);
        var renderCost = platform.SystemFlags.EstimatedRenderCostEur;
        var apiCost = counts.RendersThisMonth * renderCost;

        var (provider, _) = ai.Select();
        var replicate = provider.Id switch
        {
            "replicate" => "ok",
            "demo" => "demo",
            _ => "not_configured",
        };

        return new AdminOverview(
            counts.TotalUsers,
            counts.NewUsersLast30Days,
            counts.BannedUsers,
            counts.Admins,
            new SubscribersByPlan(counts.StarterUsers, counts.ProUsers, counts.AgencyUsers),
            counts.PayingProMonthly + counts.PayingProYearly + counts.PayingAgencyMonthly + counts.PayingAgencyYearly,
            Money(mrr),
            counts.RendersToday,
            counts.RendersThisMonth,
            counts.TotalRenders,
            renderCost,
            Money(apiCost),
            Money(mrr - apiCost),
            counts.TotalProjects,
            counts.PublicProjects,
            counts.TotalB2bEstimates,
            new SystemHealth(databaseOk ? "ok" : "down", stripe.IsConfigured ? "ok" : "not_configured", replicate, provider.Id),
            Iso(now)!);
    }

    private async Task<bool> SafePingAsync(CancellationToken ct)
    {
        try
        {
            return await repository.PingAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[SUCVAR] admin overview: baza de date indisponibilă");
            return false;
        }
    }

    // ── Users ──────────────────────────────────────────────────────────────────

    public async Task<PagedResult<AdminUserView>> ListUsersAsync(AdminUserQuery query, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var platform = await settings.GetAsync(ct);
        var rows = await repository.ListUsersAsync(query, now, QuotaService.MonthStartUtc(now), ct);
        return new PagedResult<AdminUserView>(rows.Items.Select(r => ToView(r, platform, now)).ToList(), rows.Total, rows.Page, rows.PageSize);
    }

    public async Task<AdminUserView> UpdateUserAsync(AuthUser admin, Guid targetId, AdminUserPatch patch, CancellationToken ct = default)
    {
        var adminId = Guid.Parse(admin.UserId);
        if (targetId == adminId && (patch.IsBanned == true || patch.Role == Roles.User))
        {
            throw new AppException(400, "SELF_PROTECTION",
                "Nu îți poți bloca propriul cont și nici nu îți poți retrage rolul de administrator.");
        }

        var now = clock.GetUtcNow();
        var monthStart = QuotaService.MonthStartUtc(now);
        var row = await repository.GetUserAsync(targetId, monthStart, ct)
                  ?? throw new AppException(404, "NOT_FOUND", "Utilizatorul nu există.");
        var platform = await settings.GetAsync(ct);
        var before = ToView(row, platform, now);
        var target = targetId.ToString();
        var audit = new List<AuditEntry>();
        AuditEntry Entry(string action, object details) =>
            new(adminId, admin.Email, action, AuditTargets.User, target, JsonSerializer.Serialize(details, Json));

        // Plan: a grant must take effect immediately — an expired period would otherwise make the
        // effective tier 'starter' again, so the period end is cleared (manual / complimentary plan).
        string? tier = null;
        var clearPeriod = false;
        if (patch.Plan is { } plan && (plan != before.Plan || plan != before.StoredPlan))
        {
            tier = plan;
            clearPeriod = plan == PlanTiers.Starter || (row.CurrentPeriodEnd is { } end && end < now);
            audit.Add(Entry(AuditActions.UpdatePlan, new
            {
                email = row.Email,
                from = before.Plan,
                to = plan,
                storedFrom = before.StoredPlan,
                stripeManaged = row.HasStripeSubscription,
            }));
        }

        if (patch.QuotaDelta is not null || patch.ResetQuota)
        {
            var bonusAfter = patch.QuotaDelta is { } d ? Math.Clamp(row.BonusGenerations + d, 0, 100_000) : row.BonusGenerations;
            audit.Add(Entry(AuditActions.AdjustQuota, new
            {
                email = row.Email,
                delta = patch.QuotaDelta,
                reset = patch.ResetQuota,
                bonusBefore = row.BonusGenerations,
                bonusAfter,
                usedBefore = row.GenerationsUsed,
            }));
        }

        string? role = null;
        if (patch.Role is { } r && r != row.Role)
        {
            role = r;
            audit.Add(Entry(AuditActions.ChangeRole, new { email = row.Email, from = row.Role, to = r }));
        }

        bool? banned = null;
        string? reason = null;
        if (patch.IsBanned is { } ban && (ban != row.IsBanned || (ban && patch.BannedReason != row.BannedReason)))
        {
            banned = ban;
            reason = ban ? patch.BannedReason : null;
            audit.Add(Entry(AuditActions.ToggleBan, new { email = row.Email, isBanned = ban, reason, previousReason = row.BannedReason }));
        }

        var changes = new AdminUserChanges(tier, clearPeriod, patch.QuotaDelta, patch.ResetQuota, role, banned, reason);
        if (changes.IsEmpty) return before;

        await repository.ApplyUserChangesAsync(targetId, changes, audit, ct);
        logger.LogInformation("[SUCVAR] admin {Admin} → user {Target}: {Actions}", admin.UserId, target, string.Join(", ", audit.Select(a => a.Action)));

        var after = await repository.GetUserAsync(targetId, monthStart, ct)
                    ?? throw new AppException(404, "NOT_FOUND", "Utilizatorul nu există.");
        return ToView(after, platform, now);
    }

    public static AdminUserView ToView(AdminUserRow r, PlatformSettings platform, DateTimeOffset now)
    {
        var effective = PlanTiers.ResolveEffectiveTier(r.SubscriptionTier, r.CurrentPeriodEnd, now);
        var paid = effective != PlanTiers.Starter;
        return new AdminUserView(
            r.Id.ToString(),
            r.Email,
            r.FullName,
            string.IsNullOrWhiteSpace(r.CompanyName) ? null : r.CompanyName,
            effective,
            PlanTiers.NormalizeTier(r.SubscriptionTier),
            paid ? PlanTiers.NormalizeInterval(r.BillingInterval) : null,
            Iso(r.CurrentPeriodEnd),
            paid && r.CancelAtPeriodEnd,
            r.HasStripeSubscription,
            Roles.IsValid(r.Role) ? r.Role : Roles.User,
            r.IsBanned,
            r.IsBanned ? r.BannedReason : null,
            r.GenerationsUsed,
            QuotaPolicy.Limit(effective, platform, r.BonusGenerations),
            r.BonusGenerations,
            Iso(r.QuotaResetAt),
            r.ProjectsCount,
            Iso(r.CreatedAt));
    }

    // ── Public portals ─────────────────────────────────────────────────────────

    public Task<PagedResult<AdminPublicProject>> ListPublicProjectsAsync(string? search, int page, int pageSize, CancellationToken ct = default) =>
        repository.ListPublicProjectsAsync(search, page, pageSize, ct);

    public async Task UnpublishAsync(AuthUser admin, string projectId, CancellationToken ct = default)
    {
        var adminId = Guid.Parse(admin.UserId);
        var entry = new AuditEntry(adminId, admin.Email, AuditActions.UnpublishProject, AuditTargets.Project, projectId,
            JsonSerializer.Serialize(new { isPublic = false }, Json));
        if (!await repository.UnpublishProjectAsync(projectId, entry, ct))
            throw new AppException(404, "NOT_FOUND", "Proiectul nu există sau nu este public.");
        logger.LogInformation("[SUCVAR] admin {Admin} project.unpublish {Project}", admin.UserId, projectId);
    }

    // ── Audit log ──────────────────────────────────────────────────────────────

    public Task<PagedResult<AuditLogEntry>> ListAuditLogsAsync(int page, int pageSize, CancellationToken ct = default) =>
        repository.ListAuditLogsAsync(page, pageSize, ct);

    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    private static string? Iso(DateTimeOffset? d) =>
        d?.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", CultureInfo.InvariantCulture);
}
