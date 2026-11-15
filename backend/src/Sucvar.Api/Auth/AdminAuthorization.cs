using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Sucvar.Api.Http;
using Sucvar.Application.Admin;

namespace Sucvar.Api.Auth;

public static class AdminPolicies
{
    /// <summary>Valid Supabase JWT + profiles.role = 'admin' + profiles.is_banned = false, checked in PostgreSQL on every request.</summary>
    public const string AdminOnly = "AdminOnly";
}

public sealed class AdminRequirement : IAuthorizationRequirement;

/// <summary>Failure codes carried in <see cref="AuthorizationFailureReason.Message"/> and turned into JSON errors.</summary>
public static class AdminFailures
{
    public const string AdminRequired = "ADMIN_REQUIRED";
    public const string AccountBanned = "ACCOUNT_BANNED";
    public const string Unavailable = "ADMIN_CHECK_FAILED";
}

/// <summary>
/// Database-backed admin check. The role is NEVER read from the JWT (Supabase tokens carry no app role and a
/// stale token must not keep admin rights): every request re-reads `profiles.role` / `is_banned`, so a demotion
/// or ban takes effect immediately.
/// </summary>
public sealed class AdminAuthorizationHandler(IAccountStatusRepository accounts, ILogger<AdminAuthorizationHandler> logger)
    : AuthorizationHandler<AdminRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, AdminRequirement requirement)
    {
        var sub = context.User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        if (context.User.Identity?.IsAuthenticated != true || !Guid.TryParse(sub, out var userId))
        {
            context.Fail(new AuthorizationFailureReason(this, AdminFailures.AdminRequired));
            return;
        }

        AccountStatus status;
        try
        {
            var ct = (context.Resource as HttpContext)?.RequestAborted ?? CancellationToken.None;
            status = await accounts.GetAsync(userId, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] AdminOnly: verificarea rolului a eșuat");
            context.Fail(new AuthorizationFailureReason(this, AdminFailures.Unavailable));
            return;
        }

        if (status.IsBanned) context.Fail(new AuthorizationFailureReason(this, AdminFailures.AccountBanned));
        else if (status.IsActiveAdmin) context.Succeed(requirement);
        else context.Fail(new AuthorizationFailureReason(this, AdminFailures.AdminRequired));
    }
}

/// <summary>
/// Keeps the API error contract <c>{ error, code }</c> for policy failures (the framework default is an empty
/// 401/403). Policies without <see cref="AdminRequirement"/> keep the default behaviour.
/// </summary>
public sealed class JsonAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Succeeded || !policy.Requirements.OfType<AdminRequirement>().Any())
        {
            await _default.HandleAsync(next, context, policy, authorizeResult);
            return;
        }

        context.Response.Headers.CacheControl = "no-store";
        IResult result;
        if (authorizeResult.Challenged)
        {
            result = HttpHelpers.BearerToken(context).Length == 0
                ? HttpHelpers.JsonError(401, "AUTH_REQUIRED", "Autentifică-te pentru a continua.")
                : HttpHelpers.JsonError(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");
        }
        else
        {
            var code = authorizeResult.AuthorizationFailure?.FailureReasons.Select(r => r.Message).FirstOrDefault() ?? AdminFailures.AdminRequired;
            result = code switch
            {
                AdminFailures.AccountBanned => HttpHelpers.JsonError(403, "ACCOUNT_BANNED", "Contul tău a fost suspendat. / Your account has been suspended."),
                AdminFailures.Unavailable => HttpHelpers.JsonError(503, AdminFailures.Unavailable, "Verificarea drepturilor de administrator a eșuat. Încearcă din nou."),
                _ => HttpHelpers.JsonError(403, "ADMIN_REQUIRED", "Acces restricționat: doar administratorii. / Administrators only."),
            };
        }
        await result.ExecuteAsync(context);
    }
}

public static class AdminAuthorizationExtensions
{
    public static IServiceCollection AddAdminAuthorization(this IServiceCollection services)
    {
        services.AddAuthorizationBuilder()
            .AddPolicy(AdminPolicies.AdminOnly, p => p.RequireAuthenticatedUser().AddRequirements(new AdminRequirement()));
        services.AddScoped<IAuthorizationHandler, AdminAuthorizationHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, JsonAuthorizationResultHandler>();
        return services;
    }
}
