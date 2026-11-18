using Microsoft.Extensions.Logging;
using Sucvar.Application.Admin;
using Sucvar.Application.Subscriptions;
using Sucvar.Domain.Plans;

namespace Sucvar.Application.Quota;

/// <summary>Outcome of a quota check: either the resolved caller (Ok) or the error the endpoint must return.</summary>
public sealed record QuotaResult(
    bool Ok,
    string? UserId = null,
    string? Email = null,
    bool IsPro = false,
    bool IsAgency = false,
    string Tier = PlanTiers.Starter,
    int Status = 200,
    string? Error = null,
    string? Code = null,
    int? Used = null,
    int? Limit = null,
    // True when the caller's plan has a monthly limit: concurrent generations of that user must be serialised and the
    // usage re-counted, otherwise parallel requests (double-click, two tabs) could all pass the same check.
    bool Metered = false)
{
    public static QuotaResult Fail(int status, string code, string error, int? used = null, int? limit = null) =>
        new(false, Status: status, Code: code, Error: error, Used: used, Limit: limit);
}

/// <summary>What the API layer learnt about the caller before calling the quota check.</summary>
public enum TokenState { Missing, Invalid, Valid }

/// <summary>
/// Port of app/lib/server/quota.ts: session + plan + monthly limit, server-side.
/// Limits come from app_settings.plan_limits (defaults: 'starter' <see cref="PlanTiers.StarterMonthlyGenerations"/> per
/// UTC month, 'pro' / 'agency' unlimited) plus admin bonus credits (<see cref="QuotaPolicy"/>);
/// usage = max(projects created, ai_generations) since the month start or the last admin quota reset.
/// </summary>
public sealed class QuotaService(
    SubscriptionService subscriptions,
    IUsageRepository usage,
    IAccountStatusRepository accounts,
    PlatformSettingsService settings,
    TimeProvider clock,
    ILogger<QuotaService> logger)
{
    /// <summary>First instant of the UTC calendar month containing <paramref name="now"/> (quota window start).</summary>
    public static DateTimeOffset MonthStartUtc(DateTimeOffset now) => new(now.UtcDateTime.Year, now.UtcDateTime.Month, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// Decides whether the caller may start a generation. Fails closed: if usage cannot be counted the request is refused
    /// (500 <c>QUOTA_CHECK_FAILED</c>) rather than allowed for free.
    /// </summary>
    /// <param name="token">What the API layer saw in the Authorization header.</param>
    /// <param name="user">The caller when <paramref name="token"/> is <see cref="TokenState.Valid"/>.</param>
    /// <param name="allowAnonymous">Development-only switch (<c>App:AllowAnonGeneration</c>); refused in Production at startup.</param>
    /// <param name="serverConfigured">Whether database + JWT validation are configured on this instance.</param>
    /// <param name="missingConfig">Names of the missing settings, logged and (outside Production) returned to help setup.</param>
    /// <param name="isProduction">Hides configuration details from the error message in Production.</param>
    /// <param name="ct">Request cancellation.</param>
    public async Task<QuotaResult> CheckAsync(
        TokenState token, AuthUser? user, bool allowAnonymous, bool serverConfigured, string? missingConfig, bool isProduction,
        CancellationToken ct = default)
    {
        var anonOk = new QuotaResult(true);

        if (!serverConfigured)
        {
            if (allowAnonymous) return anonOk;
            logger.LogError("[SUCVAR] Config lipsă pe server: {Missing}", missingConfig);
            var detail = isProduction ? "" : $" Lipsește din configurare: {missingConfig} (repornește serverul după modificare).";
            return QuotaResult.Fail(500, "NOT_CONFIGURED", $"Verificarea contului nu este configurată pe server.{detail}");
        }

        if (token == TokenState.Missing)
        {
            return allowAnonymous ? anonOk : QuotaResult.Fail(401, "AUTH_REQUIRED", "Autentifică-te pentru a genera proiecte.");
        }
        if (token == TokenState.Invalid || user is null)
        {
            return QuotaResult.Fail(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");
        }

        var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ct);
        var isPaid = PlanTiers.IsUnlimitedTier(sub.Tier);
        var platform = await settings.GetAsync(ct);
        var unlimited = new QuotaResult(true, user.UserId, user.Email, isPaid, sub.Tier == PlanTiers.Agency, sub.Tier);
        if (platform.PlanLimits.LimitFor(sub.Tier) is null) return unlimited;

        int used;
        int limit;
        try
        {
            var userId = user.Id;
            var account = await accounts.GetAsync(userId, ct);
            limit = QuotaPolicy.Limit(sub.Tier, platform, account)!.Value;
            var since = QuotaPolicy.Since(MonthStartUtc(clock.GetUtcNow()), account.QuotaResetAt);
            used = await usage.CountUsedSinceAsync(userId, since, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Numărare consum eșuată");
            return QuotaResult.Fail(500, "QUOTA_CHECK_FAILED", "Nu s-a putut verifica limita lunară.");
        }

        if (used >= limit)
        {
            return QuotaResult.Fail(403, "LIMIT_REACHED", isPaid
                ? $"Ai atins limita de {limit} generări din această lună a planului tău."
                : $"Ai folosit cele {limit} generări gratuite din această lună. Treci la planul Professional.", used, limit);
        }
        return unlimited with { Metered = true };
    }

    /// <summary>Called AFTER a successful generation. Never throws.</summary>
    public async Task RecordGenerationAsync(string? userId, string? provider = null, string? mode = null, CancellationToken ct = default)
    {
        if (userId is null || !Guid.TryParse(userId, out var id)) return;
        try
        {
            await usage.LogGenerationAsync(id, provider, mode, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[SUCVAR] Jurnalul de generări nu a putut fi scris");
        }
    }
}
