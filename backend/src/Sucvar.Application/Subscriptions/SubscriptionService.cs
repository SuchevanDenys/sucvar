using Microsoft.Extensions.Logging;
using Sucvar.Domain.Plans;

namespace Sucvar.Application.Subscriptions;

/// <summary>Plan state with the EFFECTIVE tier (an expired subscription shows as 'starter').</summary>
public sealed record EffectiveSubscription(
    string Tier,
    string? Interval,
    DateTimeOffset? CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    bool ProfileLoaded)
{
    public static EffectiveSubscription Starter(bool loaded) => new(PlanTiers.Starter, null, null, false, null, null, loaded);
}

/// <summary>The (user, plan) pair extracted from a paid Checkout Session.</summary>
public sealed record PaidSession(string UserId, string Plan);

/// <summary>
/// Port of app/lib/server/subscription.ts + the profile half of db.ts. Both confirmation paths
/// (webhook and /api/checkout/verify) go through here and write the same columns idempotently.
/// </summary>
public sealed class SubscriptionService(
    ISubscriptionRepository repository,
    IStripeGateway stripe,
    TimeProvider clock,
    ILogger<SubscriptionService> logger)
{
    /// <summary>
    /// Current plan with expiry applied. Fails safe: any read error yields 'starter', so an outage can never grant paid
    /// features. Callers that must distinguish "free user" from "unknown" check <see cref="EffectiveSubscription.ProfileLoaded"/>.
    /// </summary>
    public async Task<EffectiveSubscription> GetEffectiveSubscriptionAsync(string userId, CancellationToken ct = default)
    {
        try
        {
            if (!Guid.TryParse(userId, out var id)) return EffectiveSubscription.Starter(true);
            var profile = await repository.GetProfileAsync(id, ct);
            if (profile is null) return EffectiveSubscription.Starter(true);
            var tier = PlanTiers.ResolveEffectiveTier(profile.SubscriptionTier, profile.CurrentPeriodEnd, clock.GetUtcNow());
            var starter = tier == PlanTiers.Starter;
            return new EffectiveSubscription(
                tier,
                starter ? null : PlanTiers.NormalizeInterval(profile.BillingInterval),
                starter ? null : profile.CurrentPeriodEnd,
                !starter && profile.CancelAtPeriodEnd,
                profile.StripeCustomerId,
                profile.StripeSubscriptionId,
                true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fail-safe: when the plan cannot be read, starter rules apply (no rights "on trust")
            logger.LogError(ex, "[SUCVAR] Citire abonament eșuată, se aplică starter");
            return EffectiveSubscription.Starter(false);
        }
    }

    /// <summary>readPeriod: earliest item current_period_end; interval from the price, metadata as fallback.</summary>
    public static SubscriptionPeriod ReadPeriod(SubscriptionInfo subscription) => new(
        subscription.ItemPeriodEnds.Count > 0 ? subscription.ItemPeriodEnds.Min() : null,
        PlanTiers.NormalizeInterval(subscription.PriceInterval) ?? PlanTiers.NormalizeInterval(subscription.Metadata.GetValueOrDefault("interval")),
        subscription.CancelAtPeriodEnd);

    /// <summary>(userId, plan) from a PAID session; null if unpaid or data missing.</summary>
    public static PaidSession? ReadPaidSession(CheckoutSessionInfo session)
    {
        if (session.PaymentStatus != "paid") return null;
        var userId = session.ClientReferenceId ?? session.Metadata.GetValueOrDefault("user_id");
        var plan = session.Metadata.GetValueOrDefault("plan");
        if (string.IsNullOrEmpty(userId) || !PaidPlans.IsPaidPlan(plan)) return null;
        return new PaidSession(userId, plan!);
    }

    private async Task<string?> ActivatePlanAsync(Guid userId, string tier, string? customerId, string? subscriptionId, SubscriptionPeriod? period, CancellationToken ct)
    {
        var previous = await repository.GetCurrentSubscriptionIdAsync(userId, ct);
        await repository.ActivateProfilePlanAsync(userId, new ActivationPatch(tier, customerId, subscriptionId, period), ct);
        logger.LogInformation("[SUCVAR] {UserId} -> {Tier}", userId, tier);
        return previous;
    }

    /// <summary>Activates the plan and cancels the previous subscription after an upgrade. Idempotent.</summary>
    public async Task ApplyPaidSessionAsync(CheckoutSessionInfo session, PaidSession paid, CancellationToken ct = default)
    {
        if (!Guid.TryParse(paid.UserId, out var userId)) throw new AppException(400, "INVALID_USER", "user_id invalid în sesiunea Stripe.");
        SubscriptionPeriod? period = null;
        if (session.SubscriptionId is { } subId)
        {
            period = ReadPeriod(await stripe.GetSubscriptionAsync(subId, ct));
        }
        var previous = await ActivatePlanAsync(userId, paid.Plan, session.CustomerId, session.SubscriptionId, period, ct);
        if (previous is not null && session.SubscriptionId is not null && previous != session.SubscriptionId)
        {
            try
            {
                await stripe.CancelSubscriptionAsync(previous, ct);
                logger.LogInformation("[SUCVAR] Abonament vechi anulat: {Sub}", previous);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "[SUCVAR] Nu s-a putut anula abonamentul vechi");
            }
        }
    }

    /// <summary>Applies an ACTIVE subscription (renewal, cycle change, scheduled cancel). Ignores superseded ones.</summary>
    public async Task<bool> SyncActiveSubscriptionAsync(SubscriptionInfo subscription, CancellationToken ct = default)
    {
        var userIdRaw = subscription.Metadata.GetValueOrDefault("user_id");
        var plan = subscription.Metadata.GetValueOrDefault("plan");
        if (string.IsNullOrEmpty(userIdRaw) || !PaidPlans.IsPaidPlan(plan) || !Guid.TryParse(userIdRaw, out var userId)) return false;
        var current = await repository.GetCurrentSubscriptionIdAsync(userId, ct);
        if (current is not null && current != subscription.Id) return false;
        await ActivatePlanAsync(userId, plan!, subscription.CustomerId, subscription.Id, ReadPeriod(subscription), ct);
        return true;
    }

    /// <summary>Returns the owner of <paramref name="subscriptionId"/> to starter — only if it is still their current subscription.</summary>
    public async Task DowngradeBySubscriptionAsync(string subscriptionId, CancellationToken ct = default)
    {
        var userId = await repository.DowngradeBySubscriptionIdAsync(subscriptionId, ct);
        if (userId is not null) logger.LogInformation("[SUCVAR] {UserId} -> starter", userId);
        else logger.LogInformation("[SUCVAR] Abonament {Sub} ignorat (nu mai este cel curent).", subscriptionId);
    }
}
