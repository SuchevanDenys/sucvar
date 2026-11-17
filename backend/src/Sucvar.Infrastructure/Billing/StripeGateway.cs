using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using Sucvar.Application;

namespace Sucvar.Infrastructure.Billing;

public sealed class StripeOptions
{
    public string? SecretKey { get; set; }
    public string? WebhookSecret { get; set; }
}

/// <summary>Stripe.net implementation of <see cref="IStripeGateway"/> (port of app/lib/billing/stripe.ts usage).</summary>
public sealed class StripeGateway(IOptions<StripeOptions> options) : IStripeGateway
{
    private readonly string _key = Clean(options.Value.SecretKey);
    private StripeClient? _client;

    private static string Clean(string? v) => (v ?? "").Trim().Trim('"', '\'');

    public bool IsConfigured => _key.Length > 0;

    private StripeClient Client => _client ??= IsConfigured ? new StripeClient(_key) : throw new InvalidOperationException("STRIPE_SECRET_KEY lipsește.");

    public async Task<string?> CreateCheckoutSessionAsync(CreateCheckoutRequest r, CancellationToken ct = default)
    {
        // Same metadata on the session AND on the subscription: the webhook reads both
        var metadata = new Dictionary<string, string> { ["user_id"] = r.UserId, ["plan"] = r.Plan, ["interval"] = r.Interval };
        // Proof of consent (Terms + waiver of the 14-day withdrawal right for an immediately started digital service)
        if (r.TermsAcceptedAt is { } accepted) metadata["terms_accepted_at"] = accepted.ToString("O");
        var lineItem = r.PriceId is not null
            ? new SessionLineItemOptions { Price = r.PriceId, Quantity = 1 }
            : new SessionLineItemOptions
            {
                Quantity = 1,
                PriceData = new SessionLineItemPriceDataOptions
                {
                    Currency = Domain.Plans.PaidPlans.Currency,
                    UnitAmount = r.UnitAmount,
                    Recurring = new SessionLineItemPriceDataRecurringOptions { Interval = r.Interval },
                    ProductData = new SessionLineItemPriceDataProductDataOptions { Name = r.ProductName },
                },
            };
        var create = new SessionCreateOptions
        {
            Mode = "subscription",
            ClientReferenceId = r.UserId,
            LineItems = [lineItem],
            Metadata = metadata,
            SubscriptionData = new SessionSubscriptionDataOptions { Metadata = new Dictionary<string, string>(metadata) },
            SuccessUrl = r.SuccessUrl,
            CancelUrl = r.CancelUrl,
        };
        // `customer` and `customer_email` are mutually exclusive
        if (!string.IsNullOrEmpty(r.StripeCustomerId)) create.Customer = r.StripeCustomerId;
        else create.CustomerEmail = r.Email;

        var session = await new SessionService(Client).CreateAsync(create, cancellationToken: ct);
        return session.Url;
    }

    public async Task<CheckoutSessionInfo> GetCheckoutSessionAsync(string sessionId, CancellationToken ct = default) =>
        Map(await new SessionService(Client).GetAsync(sessionId, cancellationToken: ct));

    public async Task<SubscriptionInfo> GetSubscriptionAsync(string subscriptionId, CancellationToken ct = default) =>
        Map(await new SubscriptionService(Client).GetAsync(subscriptionId, cancellationToken: ct));

    public Task CancelSubscriptionAsync(string subscriptionId, CancellationToken ct = default) =>
        new SubscriptionService(Client).CancelAsync(subscriptionId, cancellationToken: ct);

    public async Task<string> CreatePortalSessionAsync(string customerId, string returnUrl, CancellationToken ct = default)
    {
        var session = await new Stripe.BillingPortal.SessionService(Client).CreateAsync(
            new Stripe.BillingPortal.SessionCreateOptions { Customer = customerId, ReturnUrl = returnUrl }, cancellationToken: ct);
        return session.Url;
    }

    public WebhookEvent ParseWebhook(string rawBody, string signature, string secret)
    {
        Event evt;
        try
        {
            // API-version mismatch must not reject legitimate events: the payload fields we read are stable.
            evt = EventUtility.ConstructEvent(rawBody, signature, secret, throwOnApiVersionMismatch: false);
        }
        catch (StripeException ex)
        {
            throw new WebhookSignatureException(ex.Message, ex);
        }
        return Map(evt);
    }

    public static WebhookEvent Map(Event evt)
    {
        var obj = evt.Data?.Object;
        string? invoiceSub = null;
        if (obj is Invoice invoice)
        {
            var details = invoice.Parent?.SubscriptionDetails;
            invoiceSub = details?.SubscriptionId ?? details?.Subscription?.Id;
        }
        return new WebhookEvent(
            evt.Id,
            evt.Type,
            obj is Session s ? Map(s) : null,
            obj is Subscription sub ? Map(sub) : null,
            invoiceSub);
    }

    public static CheckoutSessionInfo Map(Session s) => new(
        s.Id,
        s.PaymentStatus,
        s.ClientReferenceId,
        s.Metadata ?? new Dictionary<string, string>(),
        s.CustomerId ?? s.Customer?.Id,
        s.SubscriptionId ?? s.Subscription?.Id);

    public static SubscriptionInfo Map(Subscription s)
    {
        var items = s.Items?.Data ?? [];
        return new SubscriptionInfo(
            s.Id,
            s.Status,
            s.Metadata ?? new Dictionary<string, string>(),
            s.CustomerId ?? s.Customer?.Id,
            // A missing item period deserialises as default(DateTime) (year 1 / Unix epoch): drop it instead of
            // persisting a bogus date that would instantly expire the plan.
            items.Where(i => i.CurrentPeriodEnd > DateTime.UnixEpoch)
                .Select(i => new DateTimeOffset(DateTime.SpecifyKind(i.CurrentPeriodEnd, DateTimeKind.Utc))).ToList(),
            items.FirstOrDefault()?.Price?.Recurring?.Interval,
            s.CancelAtPeriodEnd);
    }
}

/// <summary>Processed Stripe event ids, kept 48 h (Stripe retries for up to 3 days, but handlers are idempotent anyway).</summary>
public sealed class MemoryWebhookIdempotencyStore(IMemoryCache cache) : IWebhookIdempotencyStore
{
    public bool WasProcessed(string eventId) => cache.TryGetValue($"stripe-evt:{eventId}", out _);

    public void MarkProcessed(string eventId) =>
        cache.Set($"stripe-evt:{eventId}", true, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(48), Size = 1 });
}
