using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using Sucvar.Application;
using Sucvar.Infrastructure.Ai;
using Sucvar.Infrastructure.Billing;
using Sucvar.Infrastructure.Persistence;

namespace Sucvar.Infrastructure;

/// <summary>Composition of the Infrastructure layer: PostgreSQL repositories, Stripe, AI providers and image processing.</summary>
public static class DependencyInjection
{
    /// <summary>Binds every Application port to its adapter and configures resilient outbound HTTP clients.</summary>
    public static IServiceCollection AddSucvarInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Supabase") ?? "";
        services.AddDbContext<SucvarDbContext>(o =>
        {
            // Explicit column mapping in OnModelCreating; NO EF migrations against the Supabase schema.
            o.UseNpgsql(connectionString, npgsql => npgsql.EnableRetryOnFailure(2));
            o.UseSnakeCaseNamingConvention();
        });

        services.AddScoped<ISubscriptionRepository, SubscriptionRepository>();
        services.AddScoped<IUsageRepository, UsageRepository>();
        services.AddScoped<IEstimateRepository, EstimateRepository>();
        services.AddScoped<IPortalRepository, PortalRepository>();
        services.AddScoped<ICompanyProfileRepository, CompanyProfileRepository>();
        services.AddScoped<IProfileRepository, ProfileRepository>();
        services.AddScoped<Sucvar.Application.Procurement.IProcurementRepository, ProcurementRepository>();
        services.AddScoped<Sucvar.Application.Admin.IAccountStatusRepository, AccountStatusRepository>();
        services.AddScoped<Sucvar.Application.Admin.IAppSettingsRepository, AppSettingsRepository>();
        services.AddScoped<Sucvar.Application.Admin.IAdminRepository, AdminRepository>();

        services.Configure<StripeOptions>(configuration.GetSection("Stripe"));
        services.AddSingleton<IStripeGateway, StripeGateway>();
        services.AddMemoryCache();
        services.AddSingleton<IWebhookIdempotencyStore, MemoryWebhookIdempotencyStore>();

        services.Configure<AiOptions>(configuration.GetSection("Ai"));
        services.AddSingleton<DemoImageProvider>();
        services.AddSingleton<ReplicateImageProvider>();
        services.AddSingleton<StableDiffusionImageProvider>();
        services.AddSingleton<IImageProviderSelector, ImageProviderSelector>();
        services.AddSingleton<IImageProcessor, SkiaImageProcessor>();

        // Resilience: retries only for safe methods (a retried POST to Replicate would bill twice).
        services.AddHttpClient(HttpClientNames.Replicate, c => c.BaseAddress = new Uri("https://api.replicate.com/"))
            .AddStandardResilienceHandler(o =>
            {
                o.Retry.DisableForUnsafeHttpMethods();
                o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(70);
                o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(90);
                o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(180);
            });
        services.AddHttpClient(HttpClientNames.StableDiffusion)
            .AddStandardResilienceHandler(o =>
            {
                o.Retry.DisableForUnsafeHttpMethods();
                o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(120);
                o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(130);
                o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(300);
            });
        services.AddHttpClient(HttpClientNames.ImageDownload)
            .AddStandardResilienceHandler(o =>
            {
                o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(25);
                o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(60);
                o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(60);
            });
        return services;
    }
}
