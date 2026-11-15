using System.Text.Json;
using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application.Profile;
using Sucvar.Domain.Profile;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>GET / PUT /api/profile — the account page aggregate (identity, company, subscription, quota, portfolio).</summary>
public static class ProfileEndpoints
{
    public const int MaxBodyBytes = 6_000;

    public static IEndpointRouteBuilder MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/profile", Get).WithTags("Profile").WithName("GetProfile");
        app.MapPut("/api/profile", Put).WithTags("Profile").WithName("UpdateProfile");
        return app;
    }

    /// <summary>Google sign-in stores name/picture in the token's `user_metadata` claim (JSON).</summary>
    public static TokenIdentity ReadTokenIdentity(HttpContext ctx)
    {
        var raw = ctx.User.FindFirst("user_metadata")?.Value;
        if (string.IsNullOrEmpty(raw)) return new TokenIdentity(null, null);
        try
        {
            using var doc = JsonDocument.Parse(raw);
            string? Pick(params string[] names) => names
                .Select(n => doc.RootElement.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null)
                .FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
            var avatar = Pick("avatar_url", "picture");
            // Same rule as PUT: only https avatars are ever rendered
            if (avatar is not null && !(Uri.TryCreate(avatar, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps)) avatar = null;
            return new TokenIdentity(Pick("full_name", "name"), avatar);
        }
        catch (JsonException)
        {
            return new TokenIdentity(null, null);
        }
    }

    private static async Task<IResult> Get(HttpContext ctx, ServerConfig config, ProfileService profiles, ILogger<ProfileService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config, "Autentifică-te pentru a vedea profilul.");
            if (error is not null) return error;
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(await profiles.GetAsync(user!, ReadTokenIdentity(ctx), ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/profile");
        }
    }

    private static async Task<IResult> Put(HttpContext ctx, ServerConfig config, ProfileService profiles, FixedWindowRateLimitStore limiter, ILogger<ProfileService> logger)
    {
        try
        {
            var (user, error) = RequestAuth.Require(ctx, config, "Autentifică-te pentru a modifica profilul.");
            if (error is not null) return error;
            if (limiter.Check(Rules.ProfileWrite, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, MaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");
            var parsed = ProfileUpdateParser.Parse(body);
            if (!parsed.Ok) return JsonError(400, parsed.Code!, parsed.Error!);

            await profiles.UpdateAsync(user, parsed.Value!, ctx.RequestAborted);
            ctx.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(await profiles.GetAsync(user, ReadTokenIdentity(ctx), ctx.RequestAborted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return B2bEndpoints.HandleError(ex, logger, "/api/profile");
        }
    }
}
