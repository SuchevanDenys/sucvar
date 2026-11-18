using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Scalar.AspNetCore;
using Serilog;
using Sucvar.Api;
using Sucvar.Api.Auth;
using Sucvar.Api.Endpoints;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Infrastructure;

var dotEnvPath = DotEnv.Find(Directory.GetCurrentDirectory());
DotEnv.Load(dotEnvPath);

var builder = WebApplication.CreateBuilder(args);
LegacyEnvironment.Apply(builder.Configuration);

builder.Host.UseSerilog((ctx, services, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .WriteTo.Console());

// Kestrel: the largest legitimate body is /api/generate (6 MB photo + 100 KB); per-route caps are enforced in handlers.
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = StudioEndpoints.GenerateMaxBodyBytes + 64_000);

builder.Services.AddSucvarApplication();
builder.Services.AddSucvarInfrastructure(builder.Configuration);
builder.Services.AddSupabaseJwt(builder.Configuration);
builder.Services.AddAdminAuthorization();
builder.Services.AddSingleton<ServerConfig>();
builder.Services.Configure<ProxyOptions>(builder.Configuration.GetSection("Proxy"));
builder.Services.AddSingleton<FixedWindowRateLimitStore>();
builder.Services.AddSingleton<GenerationGate>();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();

// CORS for the decoupled Next.js frontend (Authorization header allowed; Retry-After readable).
var origins = (builder.Configuration["Cors:AllowedOrigins"] ?? "http://localhost:3000")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(origins)
    .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
    .WithHeaders("Authorization", "Content-Type")
    .WithExposedHeaders("Retry-After")
    .SetPreflightMaxAge(TimeSpan.FromHours(1))));

// Native rate limiter: coarse global safety net per client IP. The exact per-route rules of the
// monolith (IP before auth, user after auth, per-project) run inside the handlers.
builder.Services.AddRateLimiter(o =>
{
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(HttpHelpers.ClientIp(ctx), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue("RateLimiting:GlobalPerMinute", 600),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
    o.OnRejected = async (context, ct) =>
    {
        var retry = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var r) ? (int)Math.Ceiling(r.TotalSeconds) : 60;
        await HttpHelpers.TooManyRequests(context.HttpContext, Math.Max(1, retry)).ExecuteAsync(context.HttpContext);
    };
});

var healthChecks = builder.Services.AddHealthChecks()
    .AddCheck<ConfigurationHealthCheck>("configuration", tags: ["config"]);
var connectionString = builder.Configuration.GetConnectionString("Supabase");
if (!string.IsNullOrWhiteSpace(connectionString))
    healthChecks.AddNpgSql(connectionString, name: "postgres", tags: ["db"], timeout: TimeSpan.FromSeconds(5));

var app = builder.Build();
StartupGuards.Validate(app.Configuration, app.Environment, app.Logger);
app.Logger.LogInformation("[SUCVAR] .env: {Path}", dotEnvPath ?? "(none — using environment variables / appsettings)");

// Middleware order matters: the exception handler wraps everything so even pipeline failures keep the { error, code }
// envelope; CORS runs before the rate limiter so rejected cross-origin calls still carry CORS headers the browser can
// read (Retry-After); authentication precedes authorization so the AdminOnly policy sees the validated principal.
app.UseExceptionHandler(handler => handler.Run(async ctx =>
{
    var error = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var result = error is AppException appEx
        ? HttpHelpers.JsonError(appEx.Status, appEx.Code, appEx.Message)
        : HttpHelpers.JsonError(500, "INTERNAL_ERROR", "Operația a eșuat. Încearcă din nou.");
    await result.ExecuteAsync(ctx);
}));
app.UseSerilogRequestLogging();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapStudioEndpoints();
app.MapBillingEndpoints();
app.MapB2bEndpoints();
app.MapPortalEndpoints();
app.MapProfileEndpoints();
app.MapAdminEndpoints();
app.MapHealthChecks("/health", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    ResponseWriter = HealthResponse.WriteAsync,
}).AllowAnonymous().DisableRateLimiting();

app.Run();

public partial class Program;
