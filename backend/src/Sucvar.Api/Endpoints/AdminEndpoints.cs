using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Application.Admin;
using Sucvar.Domain.Admin;
using Sucvar.Domain.B2b;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>
/// /api/admin/** — every route requires the <see cref="AdminPolicies.AdminOnly"/> policy (role re-checked in PostgreSQL
/// on each request). Mutations are rate limited per admin and journaled in admin_audit_logs.
/// </summary>
public static class AdminEndpoints
{
    public const int PatchMaxBodyBytes = 2_000;
    public const int SettingsMaxBodyBytes = 4_000;
    public const int SearchMaxLength = 100;

    public static readonly RateLimitRule AdminWrite = new("admin:write", 120, 600);

    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin").WithTags("Admin").RequireAuthorization(AdminPolicies.AdminOnly);
        admin.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "private, no-store";
            return await next(context);
        });
        admin.MapGet("/overview", Overview).WithName("AdminOverview");
        admin.MapGet("/users", ListUsers).WithName("AdminListUsers");
        admin.MapPatch("/users/{id}", UpdateUser).WithName("AdminUpdateUser");
        admin.MapGet("/public-projects", ListPublicProjects).WithName("AdminListPublicProjects");
        admin.MapPost("/public-projects/{id}/unpublish", Unpublish).WithName("AdminUnpublishProject");
        admin.MapGet("/audit-logs", AuditLogs).WithName("AdminAuditLogs");
        admin.MapGet("/settings", GetSettings).WithName("AdminGetSettings");
        admin.MapPut("/settings", PutSettings).WithName("AdminUpdateSettings");

        // Public, non-sensitive flags for the UI (login page: hide sign-up; banner: maintenance).
        app.MapGet("/api/public/status", PublicStatus).WithTags("Portal").WithName("PublicStatus").AllowAnonymous();
        return app;
    }

    private static AuthUser Caller(HttpContext ctx) =>
        RequestAuth.Resolve(ctx).User ?? throw new AppException(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.");

    private static int? QueryInt(HttpContext ctx, string name)
    {
        var raw = ctx.Request.Query[name].ToString();
        if (raw.Length == 0) return null;
        return int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var v)
            ? v
            : throw new AppException(400, "INVALID_QUERY", $"Parametrul {name} trebuie să fie un număr întreg pozitiv.");
    }

    private static string? QuerySearch(HttpContext ctx)
    {
        var q = ctx.Request.Query["q"].ToString().Trim();
        if (q.Length > SearchMaxLength) throw new AppException(400, "INVALID_QUERY", $"Căutarea poate avea maximum {SearchMaxLength} de caractere.");
        return q.Length == 0 ? null : q;
    }

    private static async Task<IResult> Overview(HttpContext ctx, AdminService admin, ILogger<AdminService> logger)
    {
        try
        {
            return Results.Json(await admin.GetOverviewAsync(ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/overview");
        }
    }

    private static async Task<IResult> ListUsers(HttpContext ctx, AdminService admin, ILogger<AdminService> logger)
    {
        try
        {
            var plan = ctx.Request.Query["plan"].ToString().Trim().ToLowerInvariant();
            if (plan.Length > 0 && !AdminUserPatchParser.Plans.Contains(plan)) return JsonError(400, "INVALID_QUERY", "Plan invalid (starter | pro | agency).");
            var role = ctx.Request.Query["role"].ToString().Trim().ToLowerInvariant();
            if (role.Length > 0 && !Roles.IsValid(role)) return JsonError(400, "INVALID_QUERY", "Rol invalid (user | admin).");
            var bannedRaw = ctx.Request.Query["banned"].ToString().Trim().ToLowerInvariant();
            bool? banned = bannedRaw switch
            {
                "" => null,
                "true" => true,
                "false" => false,
                _ => throw new AppException(400, "INVALID_QUERY", "banned trebuie să fie true sau false."),
            };
            var (page, size) = Paging.Normalize(QueryInt(ctx, "page"), QueryInt(ctx, "pageSize"), AdminService.UsersDefaultPageSize, AdminService.UsersMaxPageSize);

            var result = await admin.ListUsersAsync(
                new AdminUserQuery(QuerySearch(ctx), plan.Length > 0 ? plan : null, role.Length > 0 ? role : null, banned, page, size), ctx.RequestAborted);
            return Results.Json(result);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/users");
        }
    }

    private static async Task<IResult> UpdateUser(string id, HttpContext ctx, AdminService admin, FixedWindowRateLimitStore limiter, ILogger<AdminService> logger)
    {
        try
        {
            var caller = Caller(ctx);
            if (limiter.Check(AdminWrite, caller.UserId) is { } wait) return TooManyRequests(ctx, wait);
            if (!Guid.TryParse(id, out var targetId)) return JsonError(400, "INVALID_ID", "id invalid.");

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, PatchMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
            var parsed = AdminUserPatchParser.Parse(body);
            if (!parsed.Ok) return JsonError(400, parsed.Code!, parsed.Error!);

            return Results.Json(new { user = await admin.UpdateUserAsync(caller, targetId, parsed.Value!, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/users/{id}");
        }
    }

    private static async Task<IResult> ListPublicProjects(HttpContext ctx, AdminService admin, ILogger<AdminService> logger)
    {
        try
        {
            var (page, size) = Paging.Normalize(QueryInt(ctx, "page"), QueryInt(ctx, "pageSize"), AdminService.ProjectsDefaultPageSize, AdminService.ProjectsMaxPageSize);
            return Results.Json(await admin.ListPublicProjectsAsync(QuerySearch(ctx), page, size, ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/public-projects");
        }
    }

    private static async Task<IResult> Unpublish(string id, HttpContext ctx, AdminService admin, FixedWindowRateLimitStore limiter, ILogger<AdminService> logger)
    {
        try
        {
            var caller = Caller(ctx);
            if (limiter.Check(AdminWrite, caller.UserId) is { } wait) return TooManyRequests(ctx, wait);
            if (!EstimateParser.ProjectIdPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "id invalid.");
            await admin.UnpublishAsync(caller, id, ctx.RequestAborted);
            return Results.Json(new { unpublished = true, projectId = id });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/public-projects/{id}/unpublish");
        }
    }

    private static async Task<IResult> AuditLogs(HttpContext ctx, AdminService admin, ILogger<AdminService> logger)
    {
        try
        {
            var (page, size) = Paging.Normalize(QueryInt(ctx, "page"), QueryInt(ctx, "pageSize"), AdminService.AuditDefaultPageSize, AdminService.AuditMaxPageSize);
            return Results.Json(await admin.ListAuditLogsAsync(page, size, ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/audit-logs");
        }
    }

    private static async Task<IResult> GetSettings(HttpContext ctx, PlatformSettingsService settings, ILogger<AdminService> logger)
    {
        try
        {
            return Results.Json(await settings.GetViewAsync(ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/settings");
        }
    }

    private static async Task<IResult> PutSettings(HttpContext ctx, PlatformSettingsService settings, FixedWindowRateLimitStore limiter, ILogger<AdminService> logger)
    {
        try
        {
            var caller = Caller(ctx);
            if (limiter.Check(AdminWrite, caller.UserId) is { } wait) return TooManyRequests(ctx, wait);
            var (text, tooLarge) = await ReadBodyTextAsync(ctx, SettingsMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
            return Results.Json(await settings.UpdateAsync(caller, body, ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/admin/settings");
        }
    }

    private static async Task<IResult> PublicStatus(HttpContext ctx, ServerConfig config, PlatformSettingsService settings)
    {
        var flags = config.DatabaseConfigured ? (await settings.GetAsync(ctx.RequestAborted)).SystemFlags : PlatformSettings.Defaults.SystemFlags;
        ctx.Response.Headers.CacheControl = "public, max-age=30";
        return Results.Json(new { maintenanceMode = flags.MaintenanceMode, allowNewRegistrations = flags.AllowNewRegistrations });
    }
}
