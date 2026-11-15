using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Sucvar.Application;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Portal;
using Sucvar.Infrastructure.Billing;

namespace Sucvar.Tests.Support;

public sealed class FakeClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
}

public sealed class FakeSubscriptionRepository : ISubscriptionRepository
{
    public Dictionary<Guid, ProfileRecord> Profiles { get; } = new();
    public bool Throw { get; set; }
    public List<(Guid UserId, ActivationPatch Patch)> Activations { get; } = new();

    public Task<ProfileRecord?> GetProfileAsync(Guid userId, CancellationToken ct = default)
    {
        if (Throw) throw new InvalidOperationException("db down");
        return Task.FromResult(Profiles.GetValueOrDefault(userId));
    }

    public Task ActivateProfilePlanAsync(Guid userId, ActivationPatch patch, CancellationToken ct = default)
    {
        Activations.Add((userId, patch));
        var old = Profiles.GetValueOrDefault(userId);
        Profiles[userId] = new ProfileRecord(userId.ToString(), old?.Email, patch.Tier,
            patch.CustomerId ?? old?.StripeCustomerId, patch.SubscriptionId ?? old?.StripeSubscriptionId,
            patch.Period?.CurrentPeriodEnd ?? old?.CurrentPeriodEnd, patch.Period?.Interval ?? old?.BillingInterval,
            patch.Period?.CancelAtPeriodEnd ?? old?.CancelAtPeriodEnd ?? false);
        return Task.CompletedTask;
    }

    public Task<string?> GetCurrentSubscriptionIdAsync(Guid userId, CancellationToken ct = default) =>
        Task.FromResult(Profiles.GetValueOrDefault(userId)?.StripeSubscriptionId);

    public Task<string?> DowngradeBySubscriptionIdAsync(string subscriptionId, CancellationToken ct = default)
    {
        var match = Profiles.Values.FirstOrDefault(p => p.StripeSubscriptionId == subscriptionId);
        if (match is null) return Task.FromResult<string?>(null);
        Profiles[Guid.Parse(match.Id)] = match with { SubscriptionTier = "starter", StripeSubscriptionId = null, CurrentPeriodEnd = null, BillingInterval = null, CancelAtPeriodEnd = false };
        return Task.FromResult<string?>(match.Id);
    }

    public void SetTier(Guid userId, string tier, DateTimeOffset? periodEnd = null, string? subscriptionId = null, string? interval = null) =>
        Profiles[userId] = new ProfileRecord(userId.ToString(), "u@test.ro", tier, "cus_1", subscriptionId, periodEnd, interval, false);
}

public sealed class FakeUsageRepository : IUsageRepository
{
    public int Projects { get; set; }
    public int Generations { get; set; }
    public bool ThrowOnProjects { get; set; }
    public List<(Guid UserId, string? Provider, string? Mode)> Logged { get; } = new();
    public DateTimeOffset? LastSince { get; private set; }

    public Task<int> CountProjectsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default)
    {
        LastSince = since;
        if (ThrowOnProjects) throw new InvalidOperationException("db down");
        return Task.FromResult(Projects);
    }

    public Task<int> CountGenerationsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default) => Task.FromResult(Generations);

    public Task LogGenerationAsync(Guid userId, string? provider, string? mode, CancellationToken ct = default)
    {
        Logged.Add((userId, provider, mode));
        return Task.CompletedTask;
    }
}

public sealed class FakeEstimateRepository : IEstimateRepository
{
    public sealed record Row(Guid Id, Guid UserId, EstimatePayload Payload, int Version);
    public List<Row> Rows { get; } = new();

    private static EstimateRecord ToRecord(Row r) => new(r.Id.ToString(), r.Payload.ProjectId, r.Payload.DocNo, r.Payload.Status, r.Payload.Client,
        r.Payload.Region, r.Payload.FinishLevel, r.Payload.AreaM2, r.Payload.Crew, r.Payload.ContingencyPct, r.Payload.MarginPct, r.Payload.VatPct,
        r.Payload.Scope, r.Payload.RateOverride, r.Payload.LineItems, r.Payload.Subtotal, r.Payload.Total, "2026-11-15T10:00:00.000000+00:00",
        $"2026-11-15T10:00:0{r.Version}.000000+00:00");

    public Task<IReadOnlyList<EstimateRecord>> ListAsync(Guid userId, int limit, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<EstimateRecord>>(Rows.Where(r => r.UserId == userId).Take(limit).Select(ToRecord).ToList());

    public Task<Guid?> FindIdByProjectAsync(Guid userId, string projectId, CancellationToken ct = default) =>
        Task.FromResult(Rows.FirstOrDefault(r => r.UserId == userId && r.Payload.ProjectId == projectId)?.Id);

    public Task<EstimateRecord> UpdateAsync(Guid id, Guid userId, EstimatePayload payload, CancellationToken ct = default)
    {
        var i = Rows.FindIndex(r => r.Id == id && r.UserId == userId);
        Rows[i] = Rows[i] with { Payload = payload, Version = Rows[i].Version + 1 };
        return Task.FromResult(ToRecord(Rows[i]));
    }

    public Task<EstimateRecord> InsertAsync(Guid userId, EstimatePayload payload, CancellationToken ct = default)
    {
        var row = new Row(Guid.NewGuid(), userId, payload, 0);
        Rows.Add(row);
        return Task.FromResult(ToRecord(row));
    }

    public Task<bool> DeleteAsync(Guid userId, Guid estimateId, CancellationToken ct = default) =>
        Task.FromResult(Rows.RemoveAll(r => r.Id == estimateId && r.UserId == userId) > 0);
}

/// <summary>In-memory `projects` + `b2b_estimates` including the INTERNAL columns, to prove they never leak.</summary>
public sealed class FakePortalRepository : IPortalRepository
{
    public sealed class Project
    {
        public required string Id;
        public Guid OwnerId;
        public string OwnerEmail = "owner@firma.ro";
        public bool IsPublic;
        public string Title = "Apartament Popescu";
        public string Mode = "interiors";
        public string SpaceType = "living room";
        public string StyleId = "japandi";
        public string Dimensions = """{"width":5,"length":6,"height":2.7,"doorsCount":1,"windowsCount":2,"budget":"luxury"}""";
        public double TotalBudget = 12345.678;
        public string ClientStatus = "pending";
        public string? ClientFeedback = "INTERNAL-FEEDBACK";
        public string? ProcurementItems;
        public DateTimeOffset? ClientReviewedAt;
    }

    public sealed class Estimate
    {
        public required Guid OwnerId;
        public required string ProjectId;
        public string DocNo = "DV-2026-001";
        public double AreaM2 = 30;
        public double MarginPct = 37.5;
        public double ContingencyPct = 11;
        public double VatPct = 21;
        public string LineItems = """[{"id":"l1","cat":"finishes","ro":"Parchet stejar","en":"Oak parquet","unit":"m²","qty":33.333,"price":987.65},{"id":"l2","cat":"other","ro":"","en":"","unit":"buc.","qty":2,"price":5},{"id":"l3","cat":"other","ro":"Canapea","en":"Sofa","unit":"buc.","qty":0,"price":5}]""";
        public double Subtotal = 60000;   // net (materials + labour, contingency and margin included)
        public double Total = 72600;      // gross = net × 1.21
        public string ClientNotes = "SECRET-NOTE";
    }

    public List<Project> Projects { get; } = new();
    public List<Estimate> Estimates { get; } = new();

    public Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(Guid userId, string? projectId, CancellationToken ct = default) =>
        Task.FromResult<(bool, IReadOnlyList<ProjectSharing>)>((true, Projects
            .Where(p => p.OwnerId == userId && (projectId is null || p.Id == projectId))
            .Select(p => new ProjectSharing(p.Id, p.IsPublic, p.ClientStatus, p.ClientFeedback, p.ClientReviewedAt?.ToString("o"))).ToList()));

    public Task<ProjectSharing?> SetPublicAsync(Guid userId, string projectId, bool isPublic, CancellationToken ct = default)
    {
        var p = Projects.FirstOrDefault(x => x.Id == projectId && x.OwnerId == userId);
        if (p is null) return Task.FromResult<ProjectSharing?>(null);
        p.IsPublic = isPublic;
        return Task.FromResult<ProjectSharing?>(new ProjectSharing(p.Id, p.IsPublic, p.ClientStatus, p.ClientFeedback, null));
    }

    public Task<PublicProjectRow?> GetPublicProjectAsync(string projectId, CancellationToken ct = default)
    {
        var p = Projects.FirstOrDefault(x => x.Id == projectId && x.IsPublic);
        return Task.FromResult(p is null
            ? null
            : new PublicProjectRow(new PublicProjectSource(p.Id, p.Title, p.Mode, p.SpaceType, p.StyleId, p.Dimensions,
                "data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB", p.TotalBudget, "2026-11-01T10:00:00.000000+00:00",
                p.ClientStatus, p.ClientReviewedAt?.ToString("o"), p.ProcurementItems), p.OwnerId));
    }

    public Task<PublicEstimateSource?> GetPublicEstimateAsync(Guid ownerId, string projectId, CancellationToken ct = default)
    {
        var e = Estimates.FirstOrDefault(x => x.OwnerId == ownerId && x.ProjectId == projectId);
        return Task.FromResult(e is null ? null : new PublicEstimateSource(e.DocNo, e.AreaM2, e.LineItems, e.Total,
            e.ContingencyPct, e.MarginPct, e.VatPct, e.Subtotal));
    }

    public Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string? feedback, DateTimeOffset now, CancellationToken ct = default)
    {
        var p = Projects.FirstOrDefault(x => x.Id == projectId && x.IsPublic);
        if (p is null) return Task.FromResult<ReviewResult?>(null);
        p.ClientStatus = decision;
        p.ClientFeedback = feedback;
        p.ClientReviewedAt = now;
        return Task.FromResult<ReviewResult?>(new ReviewResult(decision, now.ToString("o")));
    }
}

/// <summary>Stripe gateway double: real signature verification (Stripe.net), canned API objects, no network.</summary>
public sealed class FakeStripeGateway : IStripeGateway
{
    private readonly StripeGateway _real = new(Options.Create(new StripeOptions { SecretKey = "sk_test_dummy" }));
    public Dictionary<string, SubscriptionInfo> Subscriptions { get; } = new();
    public Dictionary<string, CheckoutSessionInfo> Sessions { get; } = new();
    public List<string> Canceled { get; } = new();
    public List<CreateCheckoutRequest> Created { get; } = new();

    public bool IsConfigured => true;

    public Task<string?> CreateCheckoutSessionAsync(CreateCheckoutRequest request, CancellationToken ct = default)
    {
        Created.Add(request);
        return Task.FromResult<string?>("https://checkout.stripe.com/c/pay/cs_test_123");
    }

    public List<(string Customer, string ReturnUrl)> PortalSessions { get; } = new();

    public Task<string> CreatePortalSessionAsync(string customerId, string returnUrl, CancellationToken ct = default)
    {
        PortalSessions.Add((customerId, returnUrl));
        return Task.FromResult("https://billing.stripe.com/p/session/test_123");
    }

    public Task<CheckoutSessionInfo> GetCheckoutSessionAsync(string sessionId, CancellationToken ct = default) => Task.FromResult(Sessions[sessionId]);
    public Task<SubscriptionInfo> GetSubscriptionAsync(string subscriptionId, CancellationToken ct = default) => Task.FromResult(Subscriptions[subscriptionId]);

    public Task CancelSubscriptionAsync(string subscriptionId, CancellationToken ct = default)
    {
        Canceled.Add(subscriptionId);
        return Task.CompletedTask;
    }

    public WebhookEvent ParseWebhook(string rawBody, string signature, string secret) => _real.ParseWebhook(rawBody, signature, secret);
}

public static class StripeSigner
{
    /// <summary>Builds a valid `Stripe-Signature` header (t=…,v1=HMAC-SHA256(secret, "t.payload")).</summary>
    public static string Sign(string payload, string secret, DateTimeOffset? at = null)
    {
        var t = (at ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        using var hmac = new System.Security.Cryptography.HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var sig = Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{t}.{payload}")));
        return $"t={t},v1={sig}";
    }
}

/// <summary>The real API host with in-memory repositories and a fake Stripe gateway.</summary>
public sealed class SucvarApiFactory : WebApplicationFactory<Program>
{
    public const string JwtSecret = "test-jwt-secret-that-is-long-enough-for-hs256-0123456789";
    public const string WebhookSecret = "whsec_test_secret";

    public FakeSubscriptionRepository Subscriptions { get; } = new();
    public FakeUsageRepository Usage { get; } = new();
    public FakeEstimateRepository Estimates { get; } = new();
    public FakePortalRepository Portal { get; } = new();
    public FakeStripeGateway Stripe { get; } = new();
    public FakeCompanyRepository Companies { get; } = new();
    public FakeProfileRepository Profiles { get; } = new();
    public FakeAccountStatusRepository Accounts { get; } = new();
    public FakeAppSettingsRepository Settings { get; } = new();
    public FakeAdminRepository Admin { get; } = new();
    public FakeProcurementRepository Procurement { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Supabase", "Host=localhost;Database=unused");
        builder.UseSetting("Supabase:JwtSecret", JwtSecret);
        builder.UseSetting("Supabase:Url", "");
        builder.UseSetting("Stripe:WebhookSecret", WebhookSecret);
        builder.UseSetting("Ai:Provider", "demo");
        builder.UseSetting("Ai:DemoDelayMs", "0");
        builder.UseSetting("Proxy:TrustAllForwarders", "true"); // tests vary the client IP through X-Forwarded-For
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<ISubscriptionRepository>();
            services.RemoveAll<IUsageRepository>();
            services.RemoveAll<IEstimateRepository>();
            services.RemoveAll<IPortalRepository>();
            services.RemoveAll<IStripeGateway>();
            services.RemoveAll<ICompanyProfileRepository>();
            services.RemoveAll<IProfileRepository>();
            services.RemoveAll<Sucvar.Application.Admin.IAccountStatusRepository>();
            services.RemoveAll<Sucvar.Application.Admin.IAppSettingsRepository>();
            services.RemoveAll<Sucvar.Application.Admin.IAdminRepository>();
            services.AddSingleton<Sucvar.Application.Admin.IAccountStatusRepository>(Accounts);
            services.AddSingleton<Sucvar.Application.Admin.IAppSettingsRepository>(Settings);
            services.AddSingleton<Sucvar.Application.Admin.IAdminRepository>(Admin);
            services.AddSingleton<IProfileRepository>(Profiles);
            services.AddSingleton<ICompanyProfileRepository>(Companies);
            services.AddSingleton<ISubscriptionRepository>(Subscriptions);
            services.AddSingleton<IUsageRepository>(Usage);
            services.AddSingleton<IEstimateRepository>(Estimates);
            services.AddSingleton<IPortalRepository>(Portal);
            services.RemoveAll<Sucvar.Application.Procurement.IProcurementRepository>();
            services.AddSingleton<Sucvar.Application.Procurement.IProcurementRepository>(Procurement);
            services.AddSingleton<IStripeGateway>(Stripe);
            services.RemoveAll<IImageProcessor>();
            services.AddSingleton<IImageProcessor, OfflineImageProcessor>();
        });
    }

    public static string Token(Guid userId, string email = "user@test.ro", string secret = JwtSecret, DateTime? expires = null)
    {
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)), SecurityAlgorithms.HmacSha256);
        var exp = expires ?? DateTime.UtcNow.AddHours(1);
        var token = new JwtSecurityToken(
            audience: "authenticated",
            claims: [new Claim("sub", userId.ToString()), new Claim("email", email), new Claim("role", "authenticated")],
            notBefore: exp.AddHours(-2),
            expires: exp,
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

/// <summary>Real SkiaSharp inspection/encoding, but no downloads (remote URLs fail like an offline network).</summary>
public sealed class OfflineImageProcessor : IImageProcessor
{
    private readonly Sucvar.Infrastructure.Ai.SkiaImageProcessor _real = new(new NoHttp());

    public ImageInspection Inspect(byte[] data) => _real.Inspect(data);

    public Task<string> ToPermanentJpegDataUrlAsync(string source, CancellationToken ct = default) =>
        source.StartsWith("data:") ? _real.ToPermanentJpegDataUrlAsync(source, ct) : throw new HttpRequestException("offline");

    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new HttpRequestException("offline");
    }
}

public sealed class FakeCompanyRepository : ICompanyProfileRepository
{
    public Dictionary<Guid, Sucvar.Domain.B2b.CompanyProfile> Rows { get; } = new();
    public Task<Sucvar.Domain.B2b.CompanyProfile?> GetAsync(Guid userId, CancellationToken ct = default) => Task.FromResult(Rows.GetValueOrDefault(userId));
    public Task<Sucvar.Domain.B2b.CompanyProfile> UpsertAsync(Guid userId, Sucvar.Domain.B2b.CompanyProfile profile, CancellationToken ct = default)
    {
        Rows[userId] = profile;
        return Task.FromResult(profile);
    }
}

public sealed class FakeProfileRepository : IProfileRepository
{
    public Dictionary<Guid, ProfileRow> Rows { get; } = new();
    public Dictionary<Guid, List<ProfileProject>> Projects { get; } = new();
    public bool Migrated { get; set; } = true;
    public int Estimates { get; set; }

    public Task<ProfileRow?> GetAsync(Guid userId, CancellationToken ct = default) => Task.FromResult(Rows.GetValueOrDefault(userId));

    public Task UpdateAsync(Guid userId, string email, Sucvar.Domain.Profile.ProfileUpdate update, CancellationToken ct = default)
    {
        if (!Migrated && (update.SetAvatar || update.Defaults is not null))
            throw new AppException(503, "MIGRATION_REQUIRED", "004");
        var row = Rows.GetValueOrDefault(userId) ?? new ProfileRow(null, email, null, DateTimeOffset.UtcNow, Sucvar.Domain.Profile.ProfileDefaults.Initial, Migrated);
        Rows[userId] = row with
        {
            FullName = update.SetFullName ? update.FullName : row.FullName,
            AvatarUrl = update.SetAvatar ? update.AvatarUrl : row.AvatarUrl,
            Defaults = update.Defaults ?? row.Defaults,
        };
        return Task.CompletedTask;
    }

    public Task<ProfileStats> GetStatsAsync(Guid userId, CancellationToken ct = default)
    {
        var list = Projects.GetValueOrDefault(userId) ?? [];
        return Task.FromResult(new ProfileStats(list.Count, list.Count(p => p.IsPublic), Estimates));
    }

    public Task<IReadOnlyList<ProfileProject>> ListProjectsAsync(Guid userId, int limit, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<ProfileProject>>((Projects.GetValueOrDefault(userId) ?? []).Take(limit).ToList());
}

/// <summary>In-memory `projects` rows for the archive material lists (owner-filtered like the real SQL).</summary>
public sealed class FakeProcurementRepository : Sucvar.Application.Procurement.IProcurementRepository
{
    public sealed record Row(Guid OwnerId, Sucvar.Application.Procurement.ProjectProcurementSource Source);
    public List<Row> Rows { get; } = new();
    public bool Migrated { get; set; } = true;

    public Task<Sucvar.Application.Procurement.ProjectProcurementSource?> GetAsync(Guid userId, string projectId, CancellationToken ct = default) =>
        Task.FromResult(Rows.FirstOrDefault(r => r.OwnerId == userId && r.Source.Id == projectId)?.Source);

    public Task<bool> SaveAsync(Guid userId, string projectId, string itemsJson, CancellationToken ct = default)
    {
        var i = Rows.FindIndex(r => r.OwnerId == userId && r.Source.Id == projectId);
        if (i < 0 || !Migrated) return Task.FromResult(false);
        Rows[i] = Rows[i] with { Source = Rows[i].Source with { ProcurementItemsJson = itemsJson } };
        return Task.FromResult(true);
    }
}
