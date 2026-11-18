using System.Text.Json;
using Microsoft.Extensions.Options;
using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Application.Quota;
using Sucvar.Application.Subscriptions;
using Sucvar.Domain;
using Sucvar.Domain.Plans;
using Sucvar.Infrastructure.Billing;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>
/// Stripe billing: <c>POST /api/checkout</c>, <c>/api/checkout/verify</c>, <c>/api/billing/portal</c> and the
/// <c>/api/webhooks/stripe</c> receiver.
/// </summary>
/// <remarks>
/// A plan is activated through two independent paths that converge on the same idempotent write
/// (<see cref="SubscriptionService"/>): the signed webhook (authoritative, retried by Stripe) and <c>/verify</c>, called
/// by the success page so the user sees the new plan immediately even when the webhook is delayed or not configured
/// locally. Verify and the portal deliberately skip <c>RequireActiveAccount</c>: a payment already taken must always be
/// honoured, and a suspended user must still be able to cancel their subscription.
/// </remarks>
public static class BillingEndpoints
{
    private const int SmallBodyBytes = 2_000;
    private const int WebhookMaxBodyBytes = 1_000_000;

    public static IEndpointRouteBuilder MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/checkout", Checkout).WithTags("Billing").WithName("Checkout").RequireActiveAccount();
        app.MapPost("/api/checkout/verify", Verify).WithTags("Billing").WithName("CheckoutVerify");
        app.MapPost("/api/billing/portal", Portal).WithTags("Billing").WithName("BillingPortal");
        app.MapPost("/api/webhooks/stripe", Webhook).WithTags("Billing").WithName("StripeWebhook").AllowAnonymous();
        return app;
    }

    private static async Task<IResult> Checkout(
        HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config, IStripeGateway stripe,
        CheckoutService checkout, IConfiguration configuration, ILogger<CheckoutService> logger)
    {
        try
        {
            if (limiter.Check(Rules.CheckoutIp, ClientIp(ctx)) is { } ipWait) return TooManyRequests(ctx, ipWait);

            var lacks = new List<string>();
            if (!stripe.IsConfigured) lacks.Add("Stripe__SecretKey");
            lacks.AddRange(config.MissingSupabase());
            if (lacks.Count > 0)
            {
                logger.LogError("[SUCVAR] Config lipsă pentru checkout: {Lacks}", string.Join(", ", lacks));
                return JsonError(500, "NOT_CONFIGURED", config.IsProduction
                    ? "Plata nu este configurată pe server."
                    : $"Plata nu este configurată. Lipsește din configurare: {string.Join(", ", lacks)}");
            }

            // 1. User from the Supabase token (never from the body)
            var (state, user) = RequestAuth.Resolve(ctx);
            if (state == TokenState.Missing) return JsonError(401, "AUTH_REQUIRED", "Autentifică-te pentru a plăti.");
            if (state == TokenState.Invalid || user is null || user.Email.Length == 0)
                return JsonError(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");

            if (limiter.Check(Rules.CheckoutUser, user.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            // 2. Requested plan ('pro' | 'agency') + interval (missing → month)
            var (text, tooLarge) = await ReadBodyTextAsync(ctx, SmallBodyBytes);
            if (tooLarge is not null) return tooLarge;
            JsonElement? body = TryParseJson(text!, out var parsed) && parsed.ValueKind == JsonValueKind.Object ? parsed : null;
            var plan = Js.AsString(Js.Prop(body, "plan"));
            if (!PaidPlans.IsPaidPlan(plan)) return JsonError(400, "INVALID_PLAN", "Plan invalid.");
            var intervalEl = Js.Prop(body, "interval");
            var interval = intervalEl is null ? "month" : PlanTiers.NormalizeInterval(Js.AsString(intervalEl));
            if (interval is null) return JsonError(400, "INVALID_INTERVAL", "Ciclu de facturare invalid (month | year).");
            // EU consumer law: express consent to start the digital service immediately (and to lose the
            // 14-day withdrawal right) + acceptance of the Terms — checked here, not only in the UI.
            if (Js.Prop(body, "acceptTerms") is not { ValueKind: JsonValueKind.True })
                return JsonError(400, "TERMS_REQUIRED", "Bifează acceptarea Termenilor și a începerii imediate a serviciului. / Please accept the Terms.");

            // 3–4. Double-billing guard + Stripe Checkout session
            var siteUrl = RedirectBase(ctx, config);
            var (conflict, url) = await checkout.CreateAsync(user, plan!, interval, siteUrl, key => configuration[key], ctx.RequestAborted,
                DateTimeOffset.UtcNow);
            if (conflict is not null)
            {
                return Results.Json(new Dictionary<string, object?>
                {
                    ["code"] = conflict.Code,
                    ["error"] = conflict.Error,
                    ["currentTier"] = conflict.CurrentTier,
                    ["redirect"] = conflict.Redirect,
                }, statusCode: 409);
            }
            if (string.IsNullOrEmpty(url)) return JsonError(502, "NO_CHECKOUT_URL", "Stripe nu a returnat adresa de plată.");
            return Results.Json(new { url });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Eroare checkout");
            return JsonError(500, "CHECKOUT_FAILED", "Nu s-a putut porni plata. Încearcă din nou.");
        }
    }

    private static async Task<IResult> Verify(
        HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config, IStripeGateway stripe,
        SubscriptionService subscriptions, ILogger<CheckoutService> logger)
    {
        try
        {
            if (limiter.Check(Rules.VerifyIp, ClientIp(ctx)) is { } ipWait) return TooManyRequests(ctx, ipWait);
            if (!stripe.IsConfigured || !config.DatabaseConfigured || !config.JwtConfigured)
                return JsonError(500, "NOT_CONFIGURED", "Plata nu este configurată pe server.");

            var (state, user) = RequestAuth.Resolve(ctx);
            if (state == TokenState.Missing) return JsonError(401, "AUTH_REQUIRED", "Autentifică-te pentru a verifica plata.");
            if (state == TokenState.Invalid || user is null) return JsonError(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");

            if (limiter.Check(Rules.VerifyUser, user.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, SmallBodyBytes);
            if (tooLarge is not null) return tooLarge;
            JsonElement? body = TryParseJson(text!, out var parsed) && parsed.ValueKind == JsonValueKind.Object ? parsed : null;
            var sessionId = Js.AsString(Js.Prop(body, "session_id"));
            if (sessionId is null || !sessionId.StartsWith("cs_", StringComparison.Ordinal)) return JsonError(400, "INVALID_SESSION", "session_id invalid.");

            var session = await stripe.GetCheckoutSessionAsync(sessionId, ctx.RequestAborted);
            // OWNERSHIP first (before revealing even "not paid")
            var ownerId = session.ClientReferenceId ?? session.Metadata.GetValueOrDefault("user_id");
            if (ownerId != user.UserId) return JsonError(403, "SESSION_MISMATCH", "Această sesiune de plată aparține altui cont.");

            var paid = SubscriptionService.ReadPaidSession(session);
            if (paid is null) return Results.Json(new Dictionary<string, object?> { ["paid"] = false, ["status"] = session.PaymentStatus });

            await subscriptions.ApplyPaidSessionAsync(session, paid, ctx.RequestAborted);
            return Results.Json(new { paid = true, tier = paid.Plan });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Eroare verificare checkout");
            return JsonError(500, "VERIFY_FAILED", "Nu s-a putut verifica plata.");
        }
    }

    /// <summary>
    /// Self-service subscription management (Stripe Customer Portal): change card, cancel, download invoices.
    /// The customer id comes from the caller's own profile — never from the request body.
    /// Cancellations/renewals come back through the existing webhook (customer.subscription.updated/deleted).
    /// </summary>
    private static async Task<IResult> Portal(
        HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config, IStripeGateway stripe,
        SubscriptionService subscriptions, ILogger<CheckoutService> logger)
    {
        try
        {
            if (!stripe.IsConfigured) return JsonError(500, "NOT_CONFIGURED", "Plata nu este configurată pe server.");
            var (user, error) = RequestAuth.Require(ctx, config, "Autentifică-te pentru a-ți gestiona abonamentul.");
            if (error is not null) return error;
            if (limiter.Check(Rules.BillingPortalUser, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

            var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ctx.RequestAborted);
            if (string.IsNullOrEmpty(sub.StripeCustomerId))
                return JsonError(404, "NO_CUSTOMER", "Nu există încă un abonament plătit pentru acest cont.");

            var siteUrl = RedirectBase(ctx, config);
            var url = await stripe.CreatePortalSessionAsync(sub.StripeCustomerId, $"{siteUrl}/account", ctx.RequestAborted);
            return Results.Json(new { url });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Eroare Customer Portal");
            return JsonError(500, "PORTAL_FAILED", "Portalul de facturare nu a putut fi deschis. Încearcă din nou.");
        }
    }

    /// <summary>
    /// Stripe event receiver. The signature is verified on the RAW body (buffered and read before any parsing): the
    /// HMAC covers the exact bytes Stripe sent, so re-serialised JSON would never validate.
    /// </summary>
    /// <remarks>
    /// Delivery is at-least-once. <see cref="StripeWebhookProcessor"/> remembers processed event ids and the handlers
    /// themselves are idempotent (they write absolute state, never increments), so a replay is acknowledged with 200
    /// and changes nothing. Any processing failure returns 500 on purpose so that Stripe retries the event.
    /// </remarks>
    private static async Task<IResult> Webhook(
        HttpContext ctx, IStripeGateway stripe, IOptions<StripeOptions> options, StripeWebhookProcessor processor,
        ILogger<StripeWebhookProcessor> logger)
    {
        var secret = (options.Value.WebhookSecret ?? "").Trim();
        if (!stripe.IsConfigured || secret.Length == 0)
        {
            logger.LogError("[SUCVAR] Webhook Stripe neconfigurat (Stripe__SecretKey / Stripe__WebhookSecret).");
            return Results.Json(new { error = "Webhook neconfigurat." }, statusCode: 500);
        }

        var signature = ctx.Request.Headers["Stripe-Signature"].ToString();
        if (signature.Length == 0) return Results.Json(new { error = "Lipsește semnătura Stripe." }, statusCode: 400);

        // Bounded read (anonymous endpoint): stops at the cap instead of buffering whatever the caller sends.
        var (rawText, tooLarge) = await ReadBodyTextAsync(ctx, WebhookMaxBodyBytes);
        if (tooLarge is not null) return tooLarge;
        var rawBody = rawText!;

        WebhookEvent evt;
        try
        {
            evt = stripe.ParseWebhook(rawBody, signature, secret);
        }
        catch (WebhookSignatureException ex)
        {
            logger.LogError(ex, "[SUCVAR] Semnătură webhook invalidă");
            return Results.Json(new { error = "Semnătură invalidă." }, statusCode: 400);
        }

        try
        {
            await processor.ProcessAsync(evt, ctx.RequestAborted);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Procesare webhook eșuată");
            return Results.Json(new { error = "Procesare eșuată." }, statusCode: 500);
        }
        return Results.Json(new { received = true });
    }

    /// <summary>
    /// Base URL for Stripe's success / cancel / return redirects: <c>App:SiteUrl</c>, else the request's Origin, else this
    /// host. The Origin header is trusted only when it is a configured CORS origin, so a scripted caller cannot point
    /// the redirects of a checkout or portal session at an arbitrary site.
    /// </summary>
    private static string RedirectBase(HttpContext ctx, ServerConfig config)
    {
        if (config.SiteUrl is { Length: > 0 } site) return site.TrimEnd('/');
        var origin = ctx.Request.Headers.Origin.ToString();
        var configuration = ctx.RequestServices.GetRequiredService<IConfiguration>();
        return (origin.Length > 0 && IsAllowedOrigin(origin, configuration) ? origin : $"{ctx.Request.Scheme}://{ctx.Request.Host}").TrimEnd('/');
    }

    /// <summary>True when <paramref name="origin"/> is listed in <c>Cors:AllowedOrigins</c> (same default as Program.cs).</summary>
    private static bool IsAllowedOrigin(string origin, IConfiguration configuration) =>
        (configuration["Cors:AllowedOrigins"] ?? "http://localhost:3000")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(allowed => string.Equals(allowed.TrimEnd('/'), origin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase));
}
