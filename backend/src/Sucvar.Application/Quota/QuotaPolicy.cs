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
    /// <summary>Monthly allowance for <paramref name="tier"/> including bonus credits; <c>null</c> = unlimited.</summary>
    public static int? Limit(string tier, PlatformSettings settings, int bonusGenerations) =>
        settings.PlanLimits.LimitFor(tier) is { } baseLimit ? baseLimit + Math.Max(0, bonusGenerations) : null;

    public static int? Limit(string tier, PlatformSettings settings, AccountStatus status) => Limit(tier, settings, status.BonusGenerations);

    /// <summary>Start of the counting window: an admin quota reset inside the month moves it forward.</summary>
    public static DateTimeOffset Since(DateTimeOffset monthStart, DateTimeOffset? quotaResetAt) =>
        quotaResetAt is { } reset && reset > monthStart ? reset : monthStart;
}

/// <summary>Single definition of "generations used", shared by enforcement and the account page.</summary>
public static class UsageRepositoryExtensions
{
    /// <summary>
    /// Generations consumed since <paramref name="since"/> = <c>max(projects created, ai_generations rows)</c>.
    /// </summary>
    /// <remarks>
    /// Both sources are counted because neither is complete on its own: <c>ai_generations</c> did not exist before the
    /// journal was introduced, and a render that was never saved as a project would otherwise be free. Taking the
    /// maximum (not the sum) avoids double-counting a render that was both logged and saved. The two queries run
    /// sequentially on purpose — they share one scoped <c>DbContext</c>, which does not support concurrent use.
    /// </remarks>
    public static async Task<int> CountUsedSinceAsync(this IUsageRepository usage, Guid userId, DateTimeOffset since, CancellationToken ct = default)
    {
        var projects = await usage.CountProjectsSinceAsync(userId, since, ct);
        var logged = await usage.CountGenerationsSinceAsync(userId, since, ct);
        return Math.Max(projects, logged);
    }
}
