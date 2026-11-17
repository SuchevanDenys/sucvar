using Sucvar.Application.Admin;
using Sucvar.Application.Quota;
using Sucvar.Application.Subscriptions;
using Sucvar.Domain;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Plans;
using Sucvar.Domain.Profile;

namespace Sucvar.Application.Profile;

/// <summary>Identity data that only exists in the JWT (Google sign-in puts name/avatar in user_metadata).</summary>
public sealed record TokenIdentity(string? FullName, string? AvatarUrl);

public sealed record ProfileAccount(string UserId, string Email, string? FullName, string? AvatarUrl, string Initials, string? CreatedAt);

public sealed record ProfileSubscription(string Tier, string? Interval, string? CurrentPeriodEnd, bool CancelAtPeriodEnd, bool CanManageBilling,
    int? DaysRemaining = null);

/// <summary>`GenerationsLimit` null = unlimited (pro / agency by default); it already includes `BonusGenerations`.</summary>
public sealed record ProfileUsage(int GenerationsUsed, int? GenerationsLimit, string PeriodStart, int ProjectsTotal, int ProjectsPublic, int EstimatesTotal,
    int BonusGenerations = 0);

public sealed record ProfileView(
    ProfileAccount Account,
    CompanyProfile? Company,
    bool CanEditCompany,
    ProfileDefaults Defaults,
    ProfileSubscription Subscription,
    ProfileUsage Usage,
    IReadOnlyList<ProfileProject> Projects,
    bool Migrated,
    string Role = Sucvar.Domain.Admin.Roles.User,
    bool IsBanned = false,
    string? BannedReason = null);

/// <summary>
/// GET/PUT /api/profile: one aggregate for the account page — identity, company + B2B defaults,
/// subscription, AI quota (same rule as QuotaService: max(projects, ai_generations) this UTC month) and
/// the project portfolio with public-link / client-approval status. Every query filters on the token's user id.
/// </summary>
public sealed class ProfileService(
    IProfileRepository profiles,
    ICompanyProfileRepository companies,
    IUsageRepository usage,
    SubscriptionService subscriptions,
    IAccountStatusRepository accounts,
    PlatformSettingsService settings,
    TimeProvider clock)
{
    public const int PortfolioLimit = 50;

    public async Task<ProfileView> GetAsync(AuthUser user, TokenIdentity token, CancellationToken ct = default)
    {
        var userId = user.Id;
        var row = await profiles.GetAsync(userId, ct);
        var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ct);
        var company = await companies.GetAsync(userId, ct);
        var stats = await profiles.GetStatsAsync(userId, ct);
        var projects = await profiles.ListProjectsAsync(userId, PortfolioLimit, ct);

        var account = await accounts.GetAsync(userId, ct);
        var platform = await settings.GetAsync(ct);
        var since = QuotaPolicy.Since(QuotaService.MonthStartUtc(clock.GetUtcNow()), account.QuotaResetAt);
        var used = await usage.CountUsedSinceAsync(userId, since, ct);

        var fullName = Clean(row?.FullName) ?? Clean(token.FullName);
        var avatar = Clean(row?.AvatarUrl) ?? Clean(token.AvatarUrl);
        var email = Clean(user.Email) ?? Clean(row?.Email) ?? "";

        return new ProfileView(
            new ProfileAccount(user.UserId, email, fullName, avatar, Initials.From(fullName, email), IsoTime.Format(row?.CreatedAt)),
            company,
            PlanTiers.HasB2bAccess(sub.Tier),
            row?.Defaults ?? ProfileDefaults.Initial,
            new ProfileSubscription(sub.Tier, sub.Interval, IsoTime.Format(sub.CurrentPeriodEnd), sub.CancelAtPeriodEnd, !string.IsNullOrEmpty(sub.StripeCustomerId),
                PlanTiers.DaysRemaining(sub.CurrentPeriodEnd, clock.GetUtcNow())),
            new ProfileUsage(used, QuotaPolicy.Limit(sub.Tier, platform, account), IsoTime.Format(since),
                stats.ProjectsTotal, stats.ProjectsPublic, stats.EstimatesTotal, account.BonusGenerations),
            projects,
            row?.Migrated ?? true,
            account.Role,
            account.IsBanned,
            account.IsBanned ? account.BannedReason : null);
    }

    /// <summary>
    /// Saves identity / defaults (profiles) and, when provided, the company (company_profiles).
    /// Company writes keep the B2B rule: effective 'agency' plan (403 AGENCY_REQUIRED otherwise).
    /// </summary>
    public async Task UpdateAsync(AuthUser user, ProfileUpdate update, CancellationToken ct = default)
    {
        var userId = user.Id;
        CompanyProfile? company = null;
        if (update.Company is { } companyJson)
        {
            var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ct);
            if (!PlanTiers.HasB2bAccess(sub.Tier))
                throw new AppException(403, "AGENCY_REQUIRED", "Datele firmei se pot salva doar cu planul Agency.");
            var parsed = CompanyProfileParser.Parse(companyJson);
            if (!parsed.Ok) throw new AppException(400, parsed.Code!, parsed.Error!);
            company = parsed.Value;
        }

        if (update.HasIdentity || update.Defaults is not null) await profiles.UpdateAsync(userId, user.Email, update, ct);
        if (company is not null) await companies.UpsertAsync(userId, company, ct);
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
