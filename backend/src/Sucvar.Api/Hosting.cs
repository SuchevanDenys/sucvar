using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Sucvar.Api.Auth;
using Sucvar.Application;

namespace Sucvar.Api;

/// <summary>
/// Loads KEY=VALUE pairs from the nearest .env (dev convenience). Existing env vars win.
/// `dotnet run --project src/Sucvar.Api` starts in the project folder, so the search walks up the
/// parent folders (backend/.env is two levels above). Values that are still template placeholders
/// (e.g. "&lt;db-password&gt;") are ignored, so a half-filled file never looks "configured".
/// </summary>
public static class DotEnv
{
    public static string? Find(string startDirectory, int maxLevels = 4)
    {
        var dir = new DirectoryInfo(startDirectory);
        for (var i = 0; dir is not null && i <= maxLevels; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    public static bool IsPlaceholder(string value) => value.Contains('<') && value.Contains('>');

    public static void Load(string? path)
    {
        if (path is null || !File.Exists(path)) return;
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var eq = line.IndexOf('=');
            if (eq <= 0) continue;
            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim().Trim('"', '\'');
            if (value.Length == 0 || IsPlaceholder(value)) continue;
            if (Environment.GetEnvironmentVariable(key) is null) Environment.SetEnvironmentVariable(key, value);
        }
    }
}

/// <summary>
/// Accepts the monolith's variable names (STRIPE_SECRET_KEY, REPLICATE_API_TOKEN, …) as aliases of the
/// .NET configuration keys, so an existing .env.local keeps working. .NET-style keys take precedence.
/// </summary>
public static class LegacyEnvironment
{
    private static readonly (string Legacy, string Key)[] Map =
    [
        ("SUPABASE_DB_URL", "ConnectionStrings:Supabase"),
        ("NEXT_PUBLIC_SUPABASE_URL", "Supabase:Url"),
        ("SUPABASE_URL", "Supabase:Url"),
        ("SUPABASE_JWT_SECRET", "Supabase:JwtSecret"),
        ("STRIPE_SECRET_KEY", "Stripe:SecretKey"),
        ("STRIPE_WEBHOOK_SECRET", "Stripe:WebhookSecret"),
        ("AI_PROVIDER", "Ai:Provider"),
        ("REPLICATE_API_TOKEN", "Ai:ReplicateApiToken"),
        ("SD_API_URL", "Ai:SdApiUrl"),
        ("SD_API_KEY", "Ai:SdApiKey"),
        ("SD_MAX_SIDE", "Ai:SdMaxSide"),
        ("SD_SAMPLER", "Ai:SdSampler"),
        ("SD_TIMEOUT_MS", "Ai:SdTimeoutMs"),
        ("SD_CONTROLNET_MODEL", "Ai:SdControlNetModel"),
        ("SD_CONTROLNET_MODULE", "Ai:SdControlNetModule"),
        ("NEXT_PUBLIC_SITE_URL", "App:SiteUrl"),
        ("SITE_URL", "App:SiteUrl"),
        ("ALLOW_ANON_GENERATION", "App:AllowAnonGeneration"),
        ("CORS_ORIGINS", "Cors:AllowedOrigins"),
    ];

    public static void Apply(ConfigurationManager configuration)
    {
        var values = new Dictionary<string, string?>();
        foreach (var (legacy, key) in Map)
        {
            var value = Environment.GetEnvironmentVariable(legacy);
            if (!string.IsNullOrWhiteSpace(value) && string.IsNullOrWhiteSpace(configuration[key]) && !values.ContainsKey(key))
                values[key] = value.Trim().Trim('"', '\'');
        }
        if (values.Count > 0) configuration.AddInMemoryCollection(values);
    }
}

/// <summary>Reports which essential settings are present (never their values).</summary>
public sealed class ConfigurationHealthCheck(ServerConfig server, IStripeGateway stripe, IConfiguration configuration) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var data = new Dictionary<string, object>
        {
            ["database"] = server.DatabaseConfigured,
            ["supabaseJwt"] = server.JwtConfigured,
            ["stripe"] = stripe.IsConfigured,
            ["stripeWebhook"] = !string.IsNullOrWhiteSpace(configuration["Stripe:WebhookSecret"]),
            ["aiProvider"] = string.IsNullOrWhiteSpace(configuration["Ai:Provider"]) ? "auto" : configuration["Ai:Provider"]!,
        };
        var essential = server.DatabaseConfigured && server.JwtConfigured;
        return Task.FromResult(essential
            ? HealthCheckResult.Healthy("Essential configuration present.", data)
            : HealthCheckResult.Unhealthy("Missing: " + string.Join(", ", server.MissingSupabase()), data: data));
    }
}

public static class HealthResponse
{
    public static Task WriteAsync(HttpContext ctx, HealthReport report)
    {
        ctx.Response.ContentType = "application/json";
        ctx.Response.Headers.CacheControl = "no-store";
        return ctx.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            status = report.Status.ToString(),
            totalDurationMs = Math.Round(report.TotalDuration.TotalMilliseconds),
            checks = report.Entries.ToDictionary(e => e.Key, e => new
            {
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                data = e.Value.Data,
            }),
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}

/// <summary>Refuses configurations that are only acceptable on a developer machine.</summary>
public static class StartupGuards
{
    public static void Validate(IConfiguration configuration, IHostEnvironment env, ILogger logger)
    {
        if (!env.IsProduction()) return;
        if (configuration.GetValue("App:AllowAnonGeneration", false))
            throw new InvalidOperationException("App:AllowAnonGeneration=true is not allowed in Production.");
        if (configuration.GetValue("Proxy:TrustAllForwarders", false))
            throw new InvalidOperationException("Proxy:TrustAllForwarders=true is not allowed in Production (use Proxy:KnownProxies).");
        var origins = configuration["Cors:AllowedOrigins"] ?? "";
        if (origins.Contains('*') || origins.Contains("localhost", StringComparison.OrdinalIgnoreCase) || origins.Trim().Length == 0)
            throw new InvalidOperationException("Cors:AllowedOrigins must list the production frontend origin(s) explicitly.");
        if (string.IsNullOrWhiteSpace(configuration["App:SiteUrl"]))
            logger.LogWarning("App:SiteUrl is empty: Stripe redirects will use the request Origin header.");
    }
}
