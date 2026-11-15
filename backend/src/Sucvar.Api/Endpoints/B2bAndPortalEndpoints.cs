using System.Text.Json;
using FluentValidation;
using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Application.B2b;
using Sucvar.Application.Portal;
using Sucvar.Application.Procurement;
using Sucvar.Domain;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Portal;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>/api/b2b/estimates (GET, PUT, DELETE).</summary>
public static class B2bEndpoints
{
    public const int MaxBodyBytes = 400_000;

    public static IEndpointRouteBuilder MapB2bEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/b2b/estimates").WithTags("B2B").RequireActiveAccount();
        group.MapGet("", List).WithName("ListEstimates");
        group.MapPut("", Save).WithName("SaveEstimate");
        group.MapDelete("", Delete).WithName("DeleteEstimate");
        app.MapGet("/api/b2b/company", GetCompany).WithTags("B2B").WithName("GetCompany").RequireActiveAccount();
        app.MapPut("/api/b2b/company", PutCompany).WithTags("B2B").WithName("SaveCompany").RequireActiveAccount();
        return app;
    }

    public const int CompanyMaxBodyBytes = 4_000;

    /// <summary>Own company profile; readable after the plan expires (like DELETE), so no agency check.</summary>
    private static async Task<IResult> GetCompany(HttpContext ctx, ServerConfig config, ICompanyProfileRepository companies, ILogger<EstimateService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { company = await companies.GetAsync(Guid.Parse(user!.UserId), ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HandleError(ex, logger, "/api/b2b/company");
        }
    }

    /// <summary>Writes require the effective 'agency' plan — the same rule as quote writes.</summary>
    private static async Task<IResult> PutCompany(HttpContext ctx, ServerConfig config, EstimateService estimates, ICompanyProfileRepository companies,
        FixedWindowRateLimitStore limiter, ILogger<EstimateService> logger)
    {
        try
        {
            var (user, error) = await RequireAgency(ctx, config, estimates);
            if (error is not null) return error;
            if (limiter.Check(Rules.CompanyWrite, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, CompanyMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
            var parsed = CompanyProfileParser.Parse(body);
            if (!parsed.Ok) return JsonError(400, parsed.Code!, parsed.Error!);

            return Results.Json(new { company = await companies.UpsertAsync(Guid.Parse(user.UserId), parsed.Value!, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HandleError(ex, logger, "/api/b2b/company");
        }
    }

    internal static IResult HandleError(Exception ex, ILogger logger, string route)
    {
        if (ex is AppException app) return JsonError(app.Status, app.Code, app.Message);
        logger.LogError(ex, "[SUCVAR] {Route}", route);
        return JsonError(500, "INTERNAL_ERROR", "Operația a eșuat. Încearcă din nou.");
    }

    /// <summary>
    /// Server-side EnterpriseGate: auth + effective 'agency' plan (RLS is bypassed, so it is enforced HERE).
    /// Active administrators (profiles.role = 'admin', checked in the database) are also allowed — the same rule
    /// the frontend gate applies from GET /api/profile (replaces the old NEXT_PUBLIC_ADMIN_EMAILS UX-only bypass).
    /// </summary>
    private static async Task<(AuthUser? User, IResult? Error)> RequireAgency(HttpContext ctx, ServerConfig config, EstimateService estimates)
    {
        var (user, error) = RequestAuth.Require(ctx, config);
        if (error is not null) return (null, error);
        var (allowed, tier) = await estimates.CheckAgencyAsync(user!, ctx.RequestAborted);
        if (!allowed)
        {
            var accounts = ctx.RequestServices.GetRequiredService<Sucvar.Application.Admin.IAccountStatusRepository>();
            allowed = (await accounts.GetAsync(Guid.Parse(user!.UserId), ctx.RequestAborted)).IsActiveAdmin;
        }
        if (!allowed)
        {
            return (null, JsonError(403, "AGENCY_REQUIRED", "Portalul B2B necesită planul Agency.",
                new Dictionary<string, object?> { ["currentTier"] = tier }));
        }
        return (user, null);
    }

    private static async Task<IResult> List(HttpContext ctx, ServerConfig config, EstimateService estimates, ILogger<EstimateService> logger)
    {
        try
        {
            var (user, error) = await RequireAgency(ctx, config, estimates);
            if (error is not null) return error;
            return Results.Json(new { estimates = await estimates.ListAsync(user!, 50, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HandleError(ex, logger, "/api/b2b/estimates");
        }
    }

    private static async Task<IResult> Save(HttpContext ctx, ServerConfig config, EstimateService estimates, FixedWindowRateLimitStore limiter, ILogger<EstimateService> logger)
    {
        try
        {
            var (user, error) = await RequireAgency(ctx, config, estimates);
            if (error is not null) return error;
            if (limiter.Check(Rules.EstimatesWrite, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, MaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
            var parsed = EstimateParser.Parse(body);
            if (!parsed.Ok) return JsonError(400, "INVALID_ESTIMATE", parsed.Error!);

            return Results.Json(new { estimate = await estimates.SaveAsync(user, parsed.Value!, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HandleError(ex, logger, "/api/b2b/estimates");
        }
    }

    private static async Task<IResult> Delete(HttpContext ctx, ServerConfig config, EstimateService estimates, ILogger<EstimateService> logger)
    {
        try
        {
            // Deleting stays allowed after the plan expires (only authentication required)
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            var id = ctx.Request.Query["id"].ToString();
            if (!EstimateParser.UuidPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "id invalid.");
            var removed = await estimates.DeleteAsync(user!, Guid.Parse(id), ctx.RequestAborted);
            return removed ? Results.Json(new { deleted = true }) : JsonError(404, "NOT_FOUND", "Devizul nu există.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HandleError(ex, logger, "/api/b2b/estimates");
        }
    }
}

/// <summary>/api/projects/sharing (owner) and /api/public/projects/{id}[/review] (anonymous portal).</summary>
public static class PortalEndpoints
{
    public const int SharingMaxBodyBytes = 1_000;
    public const int ReviewMaxBodyBytes = 4_000;

    public static IEndpointRouteBuilder MapPortalEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/projects/sharing", ListSharing).WithTags("Portal").WithName("ListSharing").RequireActiveAccount();
        app.MapPatch("/api/projects/sharing", SetSharing).WithTags("Portal").WithName("SetSharing").RequireActiveAccount();
        app.MapGet("/api/projects/{id}/procurement", GetProcurement).WithTags("Portal").WithName("GetProjectProcurement").RequireActiveAccount();
        app.MapPost("/api/projects/{id}/procurement", BackfillProcurement).WithTags("Portal").WithName("BackfillProjectProcurement").RequireActiveAccount();
        app.MapGet("/api/public/projects/{id}", GetPublic).WithTags("Portal").WithName("GetPublicProject").AllowAnonymous();
        app.MapPost("/api/public/projects/{id}/review", Review).WithTags("Portal").WithName("ReviewPublicProject").AllowAnonymous();
        return app;
    }

    private static async Task<IResult> ListSharing(HttpContext ctx, ServerConfig config, PortalService portal, ILogger<PortalService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            string? id = ctx.Request.Query.ContainsKey("id") ? ctx.Request.Query["id"].ToString() : null;
            if (id is not null && !EstimateParser.ProjectIdPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "id invalid.");
            var (migrated, items) = await portal.ListSharingAsync(user!, string.IsNullOrEmpty(id) ? null : id, ctx.RequestAborted);
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { migrated, items });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/projects/sharing");
        }
    }

    private static async Task<IResult> SetSharing(HttpContext ctx, ServerConfig config, PortalService portal, FixedWindowRateLimitStore limiter, ILogger<PortalService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            if (limiter.Check(Rules.SharingWrite, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, SharingMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
            var projectId = Js.AsString(Js.Prop(body, "projectId"));
            if (projectId is null || !EstimateParser.ProjectIdPattern().IsMatch(projectId)) return JsonError(400, "INVALID_ID", "projectId invalid.");
            var isPublic = Js.Prop(body, "isPublic");
            if (isPublic is not { ValueKind: JsonValueKind.True or JsonValueKind.False })
                return JsonError(400, "INVALID_BODY", "isPublic trebuie să fie boolean.");

            return Results.Json(new { sharing = await portal.SetPublicAsync(user, projectId, isPublic.Value.GetBoolean(), ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/projects/sharing");
        }
    }

    /// <summary>Owner only: the project's material list + retailer links (saved, or recomputed when missing).</summary>
    private static async Task<IResult> GetProcurement(string id, HttpContext ctx, ServerConfig config, ProcurementService procurement, ILogger<ProcurementService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            if (!EstimateParser.ProjectIdPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "id invalid.");
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { procurement = await procurement.GetAsync(user!, id, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/projects/procurement");
        }
    }

    /// <summary>Owner only: recompute the list from the saved Studio parameters and store it (backfill for older projects).</summary>
    private static async Task<IResult> BackfillProcurement(string id, HttpContext ctx, ServerConfig config, ProcurementService procurement,
        FixedWindowRateLimitStore limiter, ILogger<ProcurementService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            if (limiter.Check(Rules.ProcurementWrite, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);
            if (!EstimateParser.ProjectIdPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "id invalid.");
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { procurement = await procurement.BackfillAsync(user, id, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/projects/procurement");
        }
    }

    /// <summary>Anonymous: only is_public rows, strict projection, identical 404 for private/missing.</summary>
    private static IResult NotConfigured() =>
        JsonError(500, "NOT_CONFIGURED", "Baza de date nu este configurată pe server (ConnectionStrings__Supabase).");

    private static async Task<IResult> GetPublic(string id, HttpContext ctx, FixedWindowRateLimitStore limiter, PortalService portal, ServerConfig config, ILogger<PortalService> logger)
    {
        if (limiter.Check(Rules.PortalRead, ClientIp(ctx)) is { } wait) return TooManyRequests(ctx, wait);
        if (!EstimateParser.ProjectIdPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "Link invalid.");
        if (!config.DatabaseConfigured) return NotConfigured();
        try
        {
            var project = await portal.GetPublicProjectAsync(id, ctx.RequestAborted);
            if (project is null) return JsonError(404, "NOT_FOUND", "Proiect privat sau inexistent.");
            // no-store: revoking the link must take effect immediately
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { project });
        }
        catch (AppException ex)
        {
            return JsonError(ex.Status, ex.Code, ex.Message);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] /api/public/projects GET");
            return JsonError(500, "INTERNAL_ERROR", "Proiectul nu a putut fi încărcat.");
        }
    }

    private static async Task<IResult> Review(
        string id, HttpContext ctx, FixedWindowRateLimitStore limiter, PortalService portal,
        IValidator<ReviewRequest> validator, ServerConfig config, ILogger<PortalService> logger)
    {
        if (!EstimateParser.ProjectIdPattern().IsMatch(id)) return JsonError(400, "INVALID_ID", "Link invalid.");

        var ip = ClientIp(ctx);
        var wait = limiter.Check(Rules.PortalReviewIp, ip) ?? limiter.Check(Rules.PortalReviewProject, $"{ip}:{id}");
        if (wait is { } w) return TooManyRequests(ctx, w);

        if (!(ctx.Request.ContentType ?? "").Contains("application/json", StringComparison.OrdinalIgnoreCase))
            return JsonError(415, "UNSUPPORTED_MEDIA_TYPE", "Se așteaptă JSON.");
        var (text, tooLarge) = await ReadBodyTextAsync(ctx, ReviewMaxBodyBytes);
        if (tooLarge is not null) return tooLarge;

        if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
        if (body.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) return JsonError(400, "INVALID_BODY", "Cerere invalidă.");

        var statusEl = Js.Prop(body, "status");
        var status = Js.AsString(statusEl);
        var feedbackEl = Js.Prop(body, "feedback");
        if (feedbackEl is { } f && f.ValueKind is not (JsonValueKind.Null or JsonValueKind.String))
        {
            if (status is null || !ClientStatuses.Decisions.Contains(status)) return JsonError(400, "INVALID_STATUS", "Status invalid.");
            return JsonError(400, "INVALID_FEEDBACK", "Mesaj invalid.");
        }
        var request = new ReviewRequest(status, PublicProjection.CleanFeedback(Js.AsString(feedbackEl)));
        var validation = await validator.ValidateAsync(request, ctx.RequestAborted);
        if (!validation.IsValid)
        {
            var first = validation.Errors[0];
            return JsonError(400, first.ErrorCode, first.ErrorMessage);
        }

        if (!config.DatabaseConfigured) return NotConfigured();
        try
        {
            var result = await portal.SubmitReviewAsync(id, request.Status!, request.Feedback, ctx.RequestAborted);
            if (result is null) return JsonError(404, "NOT_FOUND", "Proiect privat sau inexistent.");
            ctx.Response.Headers.CacheControl = "no-store";
            return Results.Json(result);
        }
        catch (AppException ex)
        {
            return JsonError(ex.Status, ex.Code, ex.Message);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] /api/public/projects review");
            return JsonError(500, "INTERNAL_ERROR", "Răspunsul nu a putut fi trimis.");
        }
    }
}
