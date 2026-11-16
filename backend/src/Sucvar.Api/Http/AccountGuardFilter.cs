using Sucvar.Api.Auth;
using Sucvar.Application;
using Sucvar.Application.Admin;
using Sucvar.Application.Quota;

namespace Sucvar.Api.Http;

/// <summary>
/// Central ban + maintenance enforcement for the protected product routes (/api/generate, /api/analyze-materials,
/// /api/b2b/**, /api/projects/sharing, /api/checkout):
///   • authenticated caller with profiles.is_banned = true ⇒ 403 ACCOUNT_BANNED (+ reason);
///   • app_settings.system_flags.maintenance_mode = true ⇒ 503 MAINTENANCE for everyone except active admins.
/// Requests without a valid token pass through untouched: the handler answers 401 exactly as before.
/// Not applied to /api/profile, /api/billing/portal, /api/checkout/verify or the Stripe webhook, so a suspended
/// user can still see why and cancel the subscription, and payments already made are always honoured.
/// </summary>
public sealed class AccountGuardFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var config = http.RequestServices.GetRequiredService<ServerConfig>();
        if (!config.DatabaseConfigured) return await next(context);

        var (state, user) = RequestAuth.Resolve(http);
        if (state != TokenState.Valid || user is null) return await next(context);

        AccountStatus status;
        try
        {
            status = await http.RequestServices.GetRequiredService<IAccountStatusRepository>().GetAsync(user.Id, http.RequestAborted);
        }
        catch (AppException ex)
        {
            return HttpHelpers.JsonError(ex.Status, ex.Code, ex.Message);
        }

        if (status.IsBanned)
        {
            http.Response.Headers.CacheControl = "no-store";
            return HttpHelpers.JsonError(403, "ACCOUNT_BANNED", "Contul tău a fost suspendat. / Your account has been suspended.",
                new Dictionary<string, object?> { ["reason"] = status.BannedReason });
        }

        if (!status.IsActiveAdmin)
        {
            var settings = await http.RequestServices.GetRequiredService<PlatformSettingsService>().GetAsync(http.RequestAborted);
            if (settings.SystemFlags.MaintenanceMode)
            {
                http.Response.Headers.RetryAfter = "600";
                return HttpHelpers.JsonError(503, "MAINTENANCE",
                    "Platforma este în mentenanță. Revino în câteva minute. / SUCVAR is under maintenance. Please try again shortly.");
            }
        }

        return await next(context);
    }
}

public static class AccountGuardExtensions
{
    public static TBuilder RequireActiveAccount<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter<TBuilder, AccountGuardFilter>();
}
