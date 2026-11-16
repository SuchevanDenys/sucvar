using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Application.B2b;
using Sucvar.Domain.B2b;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>
/// B2B agency portal: <c>/api/b2b/estimates</c> (GET, PUT, DELETE) and <c>/api/b2b/company</c> (GET, PUT).
/// </summary>
/// <remarks>
/// The API connects to PostgreSQL with a privileged role, so Supabase RLS does not protect these tables: ownership is
/// enforced by filtering on the token's user id in every repository query, and the plan gate is enforced here by
/// <see cref="RequireAgency"/>. Reads of one's own data and deletes stay available after a plan expires, so a former
/// customer can always retrieve or remove what they created.
/// </remarks>
public static class B2bEndpoints
{
    /// <summary>A devis may carry up to 500 line items; 400 KB comfortably bounds that payload.</summary>
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

    /// <summary>Company identity is a handful of short text fields.</summary>
    public const int CompanyMaxBodyBytes = 4_000;

    /// <summary>Own company profile; readable after the plan expires (like DELETE), so no agency check.</summary>
    private static async Task<IResult> GetCompany(HttpContext ctx, ServerConfig config, ICompanyProfileRepository companies, ILogger<EstimateService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config);
            if (error is not null) return error;
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { company = await companies.GetAsync(user!.Id, ctx.RequestAborted) });
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
            if (!TryParseJson(text!, out var body)) return InvalidJson();
            var parsed = CompanyProfileParser.Parse(body);
            if (!parsed.Ok) return JsonError(400, parsed.Code!, parsed.Error!);

            return Results.Json(new { company = await companies.UpsertAsync(user.Id, parsed.Value!, ctx.RequestAborted) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HandleError(ex, logger, "/api/b2b/company");
        }
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
            allowed = (await accounts.GetAsync(user!.Id, ctx.RequestAborted)).IsActiveAdmin;
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
            if (!TryParseJson(text!, out var body)) return InvalidJson();
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
