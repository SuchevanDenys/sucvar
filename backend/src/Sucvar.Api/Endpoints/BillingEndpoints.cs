using System.Text;
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

/// <summary>POST /api/checkout, POST /api/checkout/verify, POST /api/webhooks/stripe.</summary>
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

    private static IResult Fail(int status, string code, string error) => JsonError(status, code, error);

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
                return Fail(500, "NOT_CONFIGURED", config.IsProduction
                    ? "Plata nu este configurată pe server."
                    : $"Plata nu este configurată. Lipsește din configurare: {string.Join(", ", lacks)}");
            }

            // 1. User from the Supabase token (never from the body)
            var (state, user) = RequestAuth.Resolve(ctx);
            if (state == TokenState.Missing) return Fail(401, "AUTH_REQUIRED", "Autentifică-te pentru a plăti.");
            if (state == TokenState.Invalid || user is null || user.Email.Length == 0)
                return Fail(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");

            if (limiter.Check(Rules.CheckoutUser, user.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            // 2. Requested plan ('pro' | 'agency') + interval (missing → month)
            var (text, tooLarge) = await ReadBodyTextAsync(ctx, SmallBodyBytes);
            if (tooLarge is not null) return tooLarge;
            JsonElement? body = TryParseJson(text!, out var parsed) && parsed.ValueKind == JsonValueKind.Object ? parsed : null;
            var plan = Js.AsString(Js.Prop(body, "plan"));
            if (!PaidPlans.IsPaidPlan(plan)) return Fail(400, "INVALID_PLAN", "Plan invalid.");
            var intervalEl = Js.Prop(body, "interval");
            var interval = intervalEl is null ? "month" : PlanTiers.NormalizeInterval(Js.AsString(intervalEl));
            if (interval is null) return Fail(400, "INVALID_INTERVAL", "Ciclu de facturare invalid (month | year).");
            // EU consumer law: express consent to start the digital service immediately (and to lose the
            // 14-day withdrawal right) + acceptance of the Terms — checked here, not only in the UI.
            if (Js.Prop(body, "acceptTerms") is not { ValueKind: JsonValueKind.True })
                return Fail(400, "TERMS_REQUIRED", "Bifează acceptarea Termenilor și a începerii imediate a serviciului. / Please accept the Terms.");

            // 3–4. Double-billing guard + Stripe Checkout session
            var siteUrl = (config.SiteUrl is { Length: > 0 } s ? s
                : ctx.Request.Headers.Origin.ToString() is { Length: > 0 } origin ? origin
                : $"{ctx.Request.Scheme}://{ctx.Request.Host}").TrimEnd('/');
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
            if (string.IsNullOrEmpty(url)) return Fail(502, "NO_CHECKOUT_URL", "Stripe nu a returnat adresa de plată.");
            return Results.Json(new { url });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Eroare checkout");
            return Fail(500, "CHECKOUT_FAILED", "Nu s-a putut porni plata. Încearcă din nou.");
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
                return Fail(500, "NOT_CONFIGURED", "Plata nu este configurată pe server.");

            var (state, user) = RequestAuth.Resolve(ctx);
            if (state == TokenState.Missing) return Fail(401, "AUTH_REQUIRED", "Autentifică-te pentru a verifica plata.");
            if (state == TokenState.Invalid || user is null) return Fail(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");

            if (limiter.Check(Rules.VerifyUser, user.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, SmallBodyBytes);
            if (tooLarge is not null) return tooLarge;
            JsonElement? body = TryParseJson(text!, out var parsed) && parsed.ValueKind == JsonValueKind.Object ? parsed : null;
            var sessionId = Js.AsString(Js.Prop(body, "session_id"));
            if (sessionId is null || !sessionId.StartsWith("cs_", StringComparison.Ordinal)) return Fail(400, "INVALID_SESSION", "session_id invalid.");

            var session = await stripe.GetCheckoutSessionAsync(sessionId, ctx.RequestAborted);
            // OWNERSHIP first (before revealing even "not paid")
            var ownerId = session.ClientReferenceId ?? session.Metadata.GetValueOrDefault("user_id");
            if (ownerId != user.UserId) return Fail(403, "SESSION_MISMATCH", "Această sesiune de plată aparține altui cont.");

            var paid = SubscriptionService.ReadPaidSession(session);
            if (paid is null) return Results.Json(new Dictionary<string, object?> { ["paid"] = false, ["status"] = session.PaymentStatus });

            await subscriptions.ApplyPaidSessionAsync(session, paid, ctx.RequestAborted);
            return Results.Json(new { paid = true, tier = paid.Plan });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Eroare verificare checkout");
            return Fail(500, "VERIFY_FAILED", "Nu s-a putut verifica plata.");
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
            if (!stripe.IsConfigured) return Fail(500, "NOT_CONFIGURED", "Plata nu este configurată pe server.");
            var (user, error) = RequestAuth.Require(ctx, config, "Autentifică-te pentru a-ți gestiona abonamentul.");
            if (error is not null) return error;
            if (limiter.Check(Rules.BillingPortalUser, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

            var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ctx.RequestAborted);
            if (string.IsNullOrEmpty(sub.StripeCustomerId))
                return Fail(404, "NO_CUSTOMER", "Nu există încă un abonament plătit pentru acest cont.");

            var siteUrl = (config.SiteUrl is { Length: > 0 } s ? s
                : ctx.Request.Headers.Origin.ToString() is { Length: > 0 } origin ? origin
                : $"{ctx.Request.Scheme}://{ctx.Request.Host}").TrimEnd('/');
            var url = await stripe.CreatePortalSessionAsync(sub.StripeCustomerId, $"{siteUrl}/account", ctx.RequestAborted);
            return Results.Json(new { url });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] Eroare Customer Portal");
            return Fail(500, "PORTAL_FAILED", "Portalul de facturare nu a putut fi deschis. Încearcă din nou.");
        }
    }

    /// <summary>
    /// Signature is verified on the RAW body (buffered, read before any parsing) with EventUtility.ConstructEvent.
    /// 500 on processing failure ⇒ Stripe retries automatically.
    /// </summary>
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

        ctx.Request.EnableBuffering();
        string rawBody;
        using (var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true))
        {
            rawBody = await reader.ReadToEndAsync(ctx.RequestAborted);
        }
        ctx.Request.Body.Position = 0;
        if (rawBody.Length > WebhookMaxBodyBytes) return PayloadTooLarge();

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
}
