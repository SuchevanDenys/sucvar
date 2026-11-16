using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using Sucvar.Application.Admin;
using Sucvar.Application.B2b;
using Sucvar.Application.Portal;
using Sucvar.Application.Quota;
using Sucvar.Application.Subscriptions;

namespace Sucvar.Application;

/// <summary>Composition of the Application layer (use-case services and validators).</summary>
public static class DependencyInjection
{
    /// <summary>Registers application services. Infrastructure adapters are registered separately by the host.</summary>
    public static IServiceCollection AddSucvarApplication(this IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<SubscriptionService>();
        services.AddScoped<CheckoutService>();
        services.AddScoped<StripeWebhookProcessor>();
        services.AddScoped<QuotaService>();
        services.AddScoped<EstimateService>();
        services.AddScoped<PortalService>();
        services.AddScoped<Profile.ProfileService>();
        services.AddScoped<Procurement.ProcurementService>();
        services.AddSingleton<SettingsCache>();
        services.AddScoped<PlatformSettingsService>();
        services.AddScoped<AdminService>();
        services.AddValidatorsFromAssemblyContaining<ReviewRequestValidator>(ServiceLifetime.Singleton);
        return services;
    }
}
