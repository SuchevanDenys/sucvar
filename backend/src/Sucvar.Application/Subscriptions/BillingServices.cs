using Microsoft.Extensions.Logging;
using Sucvar.Domain.Plans;

namespace Sucvar.Application.Subscriptions;

public enum WebhookOutcome { Processed, Duplicate, Ignored }

/// <summary>
/// Port of the switch in app/api/webhooks/stripe/route.ts. Signature verification happens
/// before this (gateway); exceptions bubble up so the endpoint answers 500 and Stripe retries.
/// Idempotency: the handlers are naturally idempotent, and processed event ids are remembered.
/// </summary>
public sealed class StripeWebhookProcessor(
    SubscriptionService subscriptions,
    IStripeGateway stripe,
    IWebhookIdempotencyStore idempotency,
    ILogger<StripeWebhookProcessor> logger)
{
    public async Task<WebhookOutcome> ProcessAsync(WebhookEvent evt, CancellationToken ct = default)
    {
        if (idempotency.WasProcessed(evt.Id)) return WebhookOutcome.Duplicate;
        var outcome = await DispatchAsync(evt, ct);
        idempotency.MarkProcessed(evt.Id); // only after success: a failed event is retried by Stripe
        return outcome;
    }

    private async Task<WebhookOutcome> DispatchAsync(WebhookEvent evt, CancellationToken ct)
    {
        switch (evt.Type)
        {
            case "checkout.session.completed":
            {
                var session = evt.CheckoutSession;
                if (session is null || session.PaymentStatus != "paid") return WebhookOutcome.Ignored;
                var paid = SubscriptionService.ReadPaidSession(session);
                if (paid is null)
                {
                    logger.LogError("[SUCVAR] checkout.session.completed fără user_id / plan valid: {Id}", session.Id);
                    return WebhookOutcome.Ignored; // retrying would not help
                }
                await subscriptions.ApplyPaidSessionAsync(session, paid, ct);
                return WebhookOutcome.Processed;
            }
            case "customer.subscription.updated":
            {
                var sub = evt.Subscription;
                if (sub is null) return WebhookOutcome.Ignored;
                if (sub.Status is "active" or "trialing") await subscriptions.SyncActiveSubscriptionAsync(sub, ct);
                else if (sub.Status is "canceled" or "unpaid" or "incomplete_expired") await subscriptions.DowngradeBySubscriptionAsync(sub.Id, ct);
                // past_due / incomplete: Stripe retries the payment, plan unchanged
                return WebhookOutcome.Processed;
            }
            case "invoice.paid":
            {
                if (string.IsNullOrEmpty(evt.InvoiceSubscriptionId)) return WebhookOutcome.Ignored;
                var sub = await stripe.GetSubscriptionAsync(evt.InvoiceSubscriptionId, ct);
                if (sub.Status is "active" or "trialing") await subscriptions.SyncActiveSubscriptionAsync(sub, ct);
                return WebhookOutcome.Processed;
            }
            case "customer.subscription.deleted":
            {
                if (evt.Subscription is null) return WebhookOutcome.Ignored;
                await subscriptions.DowngradeBySubscriptionAsync(evt.Subscription.Id, ct);
                return WebhookOutcome.Processed;
            }
            default:
                return WebhookOutcome.Ignored;
        }
    }
}

public sealed record CheckoutConflict(string Code, string Error, string CurrentTier, string Redirect);

/// <summary>Port of the business half of POST /api/checkout.</summary>
public sealed class CheckoutService(SubscriptionService subscriptions, IStripeGateway stripe)
{
    /// <summary>Returns either a conflict (409) or the Stripe checkout URL (null = Stripe returned none).</summary>
    public async Task<(CheckoutConflict? Conflict, string? Url)> CreateAsync(
        AuthUser user, string plan, string interval, string siteUrl, Func<string, string?> env, CancellationToken ct = default,
        DateTimeOffset? termsAcceptedAt = null)
    {
        var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ct);
        if (!PlanTiers.CanPurchase(sub.Tier, sub.Interval, plan, interval))
        {
            var same = sub.Tier == plan;
            return (new CheckoutConflict(
                same ? "ALREADY_SUBSCRIBED" : "PLAN_INCLUDED",
                same
                    ? "Ai deja acest plan activ (sau unul anual echivalent). / You already have this plan active."
                    : $"Planul tău curent ({sub.Tier}) îl include deja pe {plan}. / Your current plan ({sub.Tier}) already includes {plan}.",
                sub.Tier,
                sub.Tier == PlanTiers.Agency ? "/b2b" : "/generate"), null);
        }

        var details = PaidPlans.Plans[plan];
        var priceId = (env(PaidPlans.PriceEnvKey(plan, interval)) ?? "").Trim().Trim('"', '\'');
        var url = await stripe.CreateCheckoutSessionAsync(new CreateCheckoutRequest(
            user.UserId,
            user.Email,
            sub.StripeCustomerId,
            plan,
            interval,
            priceId.Length > 0 ? priceId : null,
            PaidPlans.UnitAmountFor(plan, interval),
            interval == "year" ? $"{details.Name} (anual)" : details.Name,
            $"{siteUrl}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}",
            $"{siteUrl}/checkout?plan={plan}&interval={interval}&canceled=1",
            termsAcceptedAt), ct);
        return (null, url);
    }
}
