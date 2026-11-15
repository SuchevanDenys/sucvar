using Sucvar.Application.Admin;
using Sucvar.Domain.Admin;

namespace Sucvar.Application.Quota;

/// <summary>
/// Generation quota rules shared by QuotaService (enforcement), ProfileService (account page) and AdminService:
/// limit = app_settings.plan_limits[tier] (null = unlimited) + admin-granted bonus credits;
/// usage is counted from the later of the UTC month start and the last admin quota reset.
/// </summary>
public static class QuotaPolicy
{
    public static int? Limit(string tier, PlatformSettings settings, int bonusGenerations) =>
        settings.PlanLimits.LimitFor(tier) is { } baseLimit ? baseLimit + Math.Max(0, bonusGenerations) : null;

    public static int? Limit(string tier, PlatformSettings settings, AccountStatus status) => Limit(tier, settings, status.BonusGenerations);

    public static DateTimeOffset Since(DateTimeOffset monthStart, DateTimeOffset? quotaResetAt) =>
        quotaResetAt is { } reset && reset > monthStart ? reset : monthStart;
}
