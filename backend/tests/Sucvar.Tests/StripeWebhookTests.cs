using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sucvar.Application;
using Sucvar.Application.Subscriptions;
using Sucvar.Infrastructure.Billing;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

public static class StripeEvents
{
    public static string CheckoutCompleted(string eventId, string userId, string plan, string paymentStatus = "paid", string subscription = "sub_new") => $$"""
    {
      "id": "{{eventId}}", "object": "event", "api_version": "2025-09-30.clover", "created": 1763200000, "livemode": false,
      "pending_webhooks": 1, "request": { "id": null, "idempotency_key": null },
      "type": "checkout.session.completed",
      "data": { "object": {
        "id": "cs_test_1", "object": "checkout.session", "mode": "subscription", "payment_status": "{{paymentStatus}}",
        "client_reference_id": "{{userId}}", "customer": "cus_123", "subscription": "{{subscription}}",
        "metadata": { "user_id": "{{userId}}", "plan": "{{plan}}", "interval": "year" }
      } }
    }
    """;

    public static string SubscriptionEvent(string eventId, string type, string subId, string status, string userId, string plan = "pro") => $$"""
    {
      "id": "{{eventId}}", "object": "event", "api_version": "2025-09-30.clover", "created": 1763200000, "livemode": false,
      "pending_webhooks": 1, "request": { "id": null, "idempotency_key": null },
      "type": "{{type}}",
      "data": { "object": {
        "id": "{{subId}}", "object": "subscription", "status": "{{status}}", "customer": "cus_123", "cancel_at_period_end": true,
        "metadata": { "user_id": "{{userId}}", "plan": "{{plan}}", "interval": "month" },
        "items": { "object": "list", "data": [
          { "id": "si_1", "object": "subscription_item", "current_period_end": 1767225600,
            "price": { "id": "price_1", "object": "price", "recurring": { "interval": "month" } } }
        ] }
      } }
    }
    """;
}

public class StripeWebhookProcessorTests
{
    private const string Secret = "whsec_unit";
    private readonly Guid _userId = Guid.NewGuid();
    private readonly FakeSubscriptionRepository _subs = new();
    private readonly FakeStripeGateway _stripe = new();
    private readonly MemoryWebhookIdempotencyStore _idempotency = new(new MemoryCache(Options.Create(new MemoryCacheOptions())));

    private StripeWebhookProcessor Create()
    {
        var subscriptions = new SubscriptionService(_subs, _stripe, TimeProvider.System, NullLogger<SubscriptionService>.Instance);
        return new StripeWebhookProcessor(subscriptions, _stripe, _idempotency, NullLogger<StripeWebhookProcessor>.Instance);
    }

    private WebhookEvent Parse(string json) => _stripe.ParseWebhook(json, StripeSigner.Sign(json, Secret), Secret);

    [Fact]
    public void Valid_signature_is_accepted_and_mapped()
    {
        var evt = Parse(StripeEvents.CheckoutCompleted("evt_1", _userId.ToString(), "agency"));
        Assert.Equal("checkout.session.completed", evt.Type);
        Assert.Equal("paid", evt.CheckoutSession!.PaymentStatus);
        Assert.Equal("sub_new", evt.CheckoutSession.SubscriptionId);
        Assert.Equal("cus_123", evt.CheckoutSession.CustomerId);
        Assert.Equal("agency", evt.CheckoutSession.Metadata["plan"]);
    }

    [Fact]
    public void Tampered_body_wrong_secret_or_stale_timestamp_are_rejected()
    {
        var json = StripeEvents.CheckoutCompleted("evt_2", _userId.ToString(), "pro");
        var signature = StripeSigner.Sign(json, Secret);
        Assert.Throws<WebhookSignatureException>(() => _stripe.ParseWebhook(json.Replace("\"pro\"", "\"agency\""), signature, Secret));
        Assert.Throws<WebhookSignatureException>(() => _stripe.ParseWebhook(json, StripeSigner.Sign(json, "whsec_other"), Secret));
        Assert.Throws<WebhookSignatureException>(() => _stripe.ParseWebhook(json, StripeSigner.Sign(json, Secret, DateTimeOffset.UtcNow.AddHours(-1)), Secret));
        Assert.Throws<WebhookSignatureException>(() => _stripe.ParseWebhook(json, "t=1,v1=deadbeef", Secret));
    }

    [Fact]
    public async Task Checkout_completed_activates_plan_with_period_and_cancels_previous_subscription()
    {
        _subs.SetTier(_userId, "pro", subscriptionId: "sub_old");
        _stripe.Subscriptions["sub_new"] = new SubscriptionInfo("sub_new", "active", new Dictionary<string, string>(), "cus_123",
            [DateTimeOffset.FromUnixTimeSeconds(1798761600), DateTimeOffset.FromUnixTimeSeconds(1767225600)], "year", false);

        var outcome = await Create().ProcessAsync(Parse(StripeEvents.CheckoutCompleted("evt_3", _userId.ToString(), "agency")));

        Assert.Equal(WebhookOutcome.Processed, outcome);
        var profile = _subs.Profiles[_userId];
        Assert.Equal("agency", profile.SubscriptionTier);
        Assert.Equal("sub_new", profile.StripeSubscriptionId);
        Assert.Equal("cus_123", profile.StripeCustomerId);
        Assert.Equal("year", profile.BillingInterval);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1767225600), profile.CurrentPeriodEnd); // earliest item end
        Assert.Equal(["sub_old"], _stripe.Canceled);
    }

    [Fact]
    public async Task Duplicate_events_are_processed_once()
    {
        _stripe.Subscriptions["sub_new"] = new SubscriptionInfo("sub_new", "active", new Dictionary<string, string>(), "cus_123", [], "month", false);
        var processor = Create();
        var evt = Parse(StripeEvents.CheckoutCompleted("evt_dup", _userId.ToString(), "pro"));
        Assert.Equal(WebhookOutcome.Processed, await processor.ProcessAsync(evt));
        Assert.Equal(WebhookOutcome.Duplicate, await processor.ProcessAsync(evt));
        Assert.Single(_subs.Activations);
    }

    [Fact]
    public async Task Unpaid_or_incomplete_sessions_change_nothing()
    {
        var processor = Create();
        Assert.Equal(WebhookOutcome.Ignored, await processor.ProcessAsync(Parse(StripeEvents.CheckoutCompleted("evt_u", _userId.ToString(), "pro", "unpaid"))));
        Assert.Equal(WebhookOutcome.Ignored, await processor.ProcessAsync(Parse(StripeEvents.CheckoutCompleted("evt_b", _userId.ToString(), "gold"))));
        Assert.Empty(_subs.Activations);
    }

    [Fact]
    public async Task Subscription_updated_syncs_period_and_scheduled_cancel()
    {
        _subs.SetTier(_userId, "pro", subscriptionId: "sub_A");
        await Create().ProcessAsync(Parse(StripeEvents.SubscriptionEvent("evt_upd", "customer.subscription.updated", "sub_A", "active", _userId.ToString())));
        var p = _subs.Profiles[_userId];
        Assert.True(p.CancelAtPeriodEnd);
        Assert.Equal("month", p.BillingInterval);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1767225600), p.CurrentPeriodEnd);
    }

    [Fact]
    public async Task Stale_subscription_events_do_not_touch_the_new_plan()
    {
        _subs.SetTier(_userId, "agency", subscriptionId: "sub_NEW");
        var processor = Create();
        await processor.ProcessAsync(Parse(StripeEvents.SubscriptionEvent("evt_old_upd", "customer.subscription.updated", "sub_OLD", "active", _userId.ToString())));
        await processor.ProcessAsync(Parse(StripeEvents.SubscriptionEvent("evt_old_del", "customer.subscription.deleted", "sub_OLD", "canceled", _userId.ToString())));
        Assert.Equal("agency", _subs.Profiles[_userId].SubscriptionTier);
        Assert.Empty(_subs.Activations);

        await processor.ProcessAsync(Parse(StripeEvents.SubscriptionEvent("evt_new_del", "customer.subscription.deleted", "sub_NEW", "canceled", _userId.ToString())));
        Assert.Equal("starter", _subs.Profiles[_userId].SubscriptionTier);
        Assert.Null(_subs.Profiles[_userId].StripeSubscriptionId);
    }
}

/// <summary>POST /api/webhooks/stripe over HTTP: raw-body signature check and status codes.</summary>
public class StripeWebhookEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public StripeWebhookEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private static HttpRequestMessage Request(string json, string? signature)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/webhooks/stripe") { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (signature is not null) req.Headers.TryAddWithoutValidation("Stripe-Signature", signature);
        return req;
    }

    [Fact]
    public async Task Missing_and_invalid_signatures_are_400()
    {
        var client = _factory.CreateClient();
        var json = StripeEvents.CheckoutCompleted("evt_http_1", Guid.NewGuid().ToString(), "pro");

        var missing = await client.SendAsync(Request(json, null));
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal("Lipsește semnătura Stripe.", (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var invalid = await client.SendAsync(Request(json, StripeSigner.Sign(json, "whsec_wrong")));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("Semnătură invalidă.", (await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Valid_event_is_applied_and_acknowledged()
    {
        var userId = Guid.NewGuid();
        _factory.Stripe.Subscriptions["sub_http"] = new SubscriptionInfo("sub_http", "active", new Dictionary<string, string>(), "cus_123",
            [DateTimeOffset.UtcNow.AddDays(30)], "month", false);
        var json = StripeEvents.CheckoutCompleted("evt_http_2", userId.ToString(), "pro", subscription: "sub_http");

        var res = await _factory.CreateClient().SendAsync(Request(json, StripeSigner.Sign(json, SucvarApiFactory.WebhookSecret)));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("""{"received":true}""", await res.Content.ReadAsStringAsync());
        Assert.Equal("pro", _factory.Subscriptions.Profiles[userId].SubscriptionTier);
    }
}
