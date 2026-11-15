using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Application.Quota;

namespace Sucvar.Api.Auth;

public sealed class SupabaseOptions
{
    /// <summary>Project URL, e.g. https://abcd.supabase.co (JWKS + issuer are derived from it).</summary>
    public string? Url { get; set; }
    /// <summary>Legacy symmetric secret (HS256) — fallback when the project still signs with a shared secret.</summary>
    public string? JwtSecret { get; set; }
    public string Audience { get; set; } = "authenticated";

    public string? NormalizedUrl => NormalizeUrl(Url);
    public string? Issuer => NormalizedUrl is { } u ? $"{u}/auth/v1" : null;
    public bool HasJwtConfig => NormalizedUrl is not null || !string.IsNullOrWhiteSpace(JwtSecret);

    /// <summary>Accepts a project URL or the dashboard URL (port of normalizeSupabaseUrl).</summary>
    public static string? NormalizeUrl(string? raw)
    {
        var trimmed = (raw ?? "").Trim().Trim('"', '\'');
        if (trimmed.Length == 0) return null;
        var m = System.Text.RegularExpressions.Regex.Match(trimmed, @"supabase\.com/dashboard/project/([a-z0-9]+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (m.Success) return $"https://{m.Groups[1].Value}.supabase.co";
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ? uri.GetLeftPart(UriPartial.Authority) : null;
    }
}

/// <summary>Loads only the JWKS document (Supabase: /auth/v1/.well-known/jwks.json). Never throws: HS256 can still work.</summary>
internal sealed class JwksRetriever(string issuer, ILogger logger) : IConfigurationRetriever<OpenIdConnectConfiguration>
{
    public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(string address, IDocumentRetriever retriever, CancellationToken cancel)
    {
        var config = new OpenIdConnectConfiguration { Issuer = issuer, JwksUri = address };
        try
        {
            var json = await retriever.GetDocumentAsync(address, cancel);
            foreach (var key in new JsonWebKeySet(json).GetSigningKeys()) config.SigningKeys.Add(key);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[SUCVAR] JWKS indisponibil ({Address}); se folosește doar JwtSecret (HS256) dacă e configurat.", address);
        }
        return config;
    }
}

public static class SupabaseAuthExtensions
{
    public static IServiceCollection AddSupabaseJwt(this IServiceCollection services, IConfiguration configuration)
    {
        var supabase = configuration.GetSection("Supabase").Get<SupabaseOptions>() ?? new SupabaseOptions();
        services.Configure<SupabaseOptions>(configuration.GetSection("Supabase"));

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
        {
            options.MapInboundClaims = false; // keep `sub` (user id) and `email` as-is
            options.RequireHttpsMetadata = supabase.NormalizedUrl?.StartsWith("https://") ?? true;
            var keys = new List<SecurityKey>();
            if (!string.IsNullOrWhiteSpace(supabase.JwtSecret))
                keys.Add(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(supabase.JwtSecret.Trim())));

            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateAudience = true,
                ValidAudience = supabase.Audience,
                ValidateIssuer = supabase.Issuer is not null,
                ValidIssuer = supabase.Issuer,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(30),
                ValidateIssuerSigningKey = true,
                IssuerSigningKeys = keys,
                ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.RsaSha256, SecurityAlgorithms.HmacSha256],
                NameClaimType = "sub",
            };

            if (supabase.Issuer is { } issuer)
            {
                // Asymmetric signing keys (ES256 / RS256) from the project's JWKS, cached and auto-refreshed.
                var logger = LoggerFactory.Create(b => b.AddConsole()).CreateLogger("SupabaseJwks");
                options.ConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
                    $"{issuer}/.well-known/jwks.json",
                    new JwksRetriever(issuer, logger),
                    new HttpDocumentRetriever { RequireHttps = options.RequireHttpsMetadata })
                {
                    AutomaticRefreshInterval = TimeSpan.FromHours(1),
                    RefreshInterval = TimeSpan.FromMinutes(5),
                };
            }
        });
        services.AddAuthorization();
        return services;
    }
}

/// <summary>Resolves the caller from the already-validated JWT (identity comes ONLY from the token).</summary>
public static class RequestAuth
{
    public static (TokenState State, AuthUser? User) Resolve(HttpContext ctx)
    {
        if (HttpHelpers.BearerToken(ctx).Length == 0) return (TokenState.Missing, null);
        var principal = ctx.User;
        var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
        if (principal.Identity?.IsAuthenticated != true || string.IsNullOrEmpty(sub) || !Guid.TryParse(sub, out _))
            return (TokenState.Invalid, null);
        var email = (principal.FindFirstValue("email") ?? "").ToLowerInvariant();
        return (TokenState.Valid, new AuthUser(sub, email));
    }

    /// <summary>
    /// Port of authenticate(): 500 NOT_CONFIGURED · 401 AUTH_REQUIRED · 401 AUTH_INVALID, or the user.
    /// </summary>
    public static (AuthUser? User, IResult? Error) Require(HttpContext ctx, ServerConfig config,
        string requiredMessage = "Autentifică-te pentru a continua.")
    {
        if (!config.DatabaseConfigured || !config.JwtConfigured)
            return (null, HttpHelpers.JsonError(500, "NOT_CONFIGURED", "Serverul nu este configurat (Supabase)."));
        var (state, user) = Resolve(ctx);
        return state switch
        {
            TokenState.Missing => (null, HttpHelpers.JsonError(401, "AUTH_REQUIRED", requiredMessage)),
            TokenState.Invalid => (null, HttpHelpers.JsonError(401, "AUTH_INVALID", "Sesiune invalidă. Autentifică-te din nou.")),
            _ => (user, null),
        };
    }
}

/// <summary>What is configured on this server (the .NET equivalent of getAdmin()'s `missing` list).</summary>
public sealed class ServerConfig(IConfiguration configuration, IHostEnvironment env)
{
    public bool DatabaseConfigured => !string.IsNullOrWhiteSpace(configuration.GetConnectionString("Supabase"));
    public bool JwtConfigured => (configuration.GetSection("Supabase").Get<SupabaseOptions>() ?? new()).HasJwtConfig;
    public bool IsProduction => env.IsProduction();
    public bool AllowAnonGeneration => configuration.GetValue("App:AllowAnonGeneration", false);
    public string? SiteUrl => configuration["App:SiteUrl"];

    public IReadOnlyList<string> MissingSupabase()
    {
        var missing = new List<string>();
        if (!DatabaseConfigured) missing.Add("ConnectionStrings__Supabase");
        if (!JwtConfigured) missing.Add("Supabase__Url | Supabase__JwtSecret");
        return missing;
    }
}
