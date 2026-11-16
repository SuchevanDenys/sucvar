using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Sucvar.Api.Endpoints;
using Sucvar.Application;
using Sucvar.Application.Profile;
using Sucvar.Application.Subscriptions;
using Sucvar.Domain.Profile;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

public class ProfileServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly Guid _id = Guid.NewGuid();
    private readonly FakeProfileRepository _profiles = new();
    private readonly FakeCompanyRepository _companies = new();
    private readonly FakeUsageRepository _usage = new();
    private readonly FakeSubscriptionRepository _subs = new();
    private readonly FakeAccountStatusRepository _accounts = new();
    private readonly FakeAppSettingsRepository _settings = new();

    private ProfileService Create()
    {
        var clock = new FakeClock(Now);
        var subscriptions = new SubscriptionService(_subs, new FakeStripeGateway(), clock, NullLogger<SubscriptionService>.Instance);
        return new ProfileService(_profiles, _companies, _usage, subscriptions, _accounts, SettingsFactory.Create(_settings, clock), clock);
    }

    private AuthUser User => new(_id.ToString(), "ana.pop@test.ro");

    private static ProfileUpdate Parse(object body) => ProfileUpdateParser.Parse(JsonSerializer.SerializeToElement(body)).Value!;

    [Fact]
    public async Task Starter_profile_aggregates_quota_portfolio_and_falls_back_to_token_identity()
    {
        _usage.Projects = 1;
        _usage.Generations = 2;
        _profiles.Projects[_id] =
        [
            new("p1", "Living", "interiors", "living room", "japandi", "2026-11-14T10:00:00.000000+00:00", true, true, "approved", null, null),
            new("p2", "Grădină", "gardens", "residential garden", "modern", "2026-11-13T10:00:00.000000+00:00", false, false, "pending", null, null),
        ];

        var view = await Create().GetAsync(User, new TokenIdentity("Ana Pop", "https://lh3.googleusercontent.com/a/x"));

        Assert.Equal("Ana Pop", view.Account.FullName);
        Assert.Equal("AP", view.Account.Initials);
        Assert.Equal("https://lh3.googleusercontent.com/a/x", view.Account.AvatarUrl);
        Assert.Equal("starter", view.Subscription.Tier);
        Assert.False(view.Subscription.CanManageBilling);
        Assert.Equal((2, (int?)3), (view.Usage.GenerationsUsed, view.Usage.GenerationsLimit)); // max(projects, generations)
        Assert.Equal("2026-11-01T00:00:00.000000+00:00", view.Usage.PeriodStart);
        Assert.Equal((2, 1), (view.Usage.ProjectsTotal, view.Usage.ProjectsPublic));
        Assert.False(view.CanEditCompany);
        Assert.Equal(ProfileDefaults.Initial, view.Defaults);
    }

    [Fact]
    public async Task Paid_plan_is_unlimited_and_stored_profile_wins_over_token()
    {
        _subs.SetTier(_id, "agency", Now.AddDays(20), "sub_1", "year");
        _profiles.Rows[_id] = new ProfileRow("Ana Maria Pop", null, null, Now.AddDays(-30), new ProfileDefaults("RON", 21, 20), true);

        var view = await Create().GetAsync(User, new TokenIdentity("Google Name", null));

        Assert.Equal("Ana Maria Pop", view.Account.FullName);
        Assert.Null(view.Usage.GenerationsLimit);
        Assert.True(view.Subscription.CanManageBilling);
        Assert.Equal("year", view.Subscription.Interval);
        Assert.True(view.CanEditCompany);
        Assert.Equal("RON", view.Defaults.Currency);
    }

    [Fact]
    public async Task Update_changes_only_sent_fields_and_gates_company_on_agency()
    {
        var service = Create();
        await service.UpdateAsync(User, Parse(new { fullName = "  Ana Pop  ", defaults = new { currency = "ron", vatRate = 19.5, marginPercent = 12 } }));
        var row = _profiles.Rows[_id];
        Assert.Equal("Ana Pop", row.FullName);
        Assert.Equal(new ProfileDefaults("RON", 19.5, 12), row.Defaults);

        await service.UpdateAsync(User, Parse(new { avatarUrl = "https://example.com/a.png" }));
        Assert.Equal("Ana Pop", _profiles.Rows[_id].FullName); // untouched

        var denied = await Assert.ThrowsAsync<AppException>(() => service.UpdateAsync(User, Parse(new { company = new { name = "Firma SRL" } })));
        Assert.Equal((403, "AGENCY_REQUIRED"), (denied.Status, denied.Code));

        _subs.SetTier(_id, "agency");
        var invalid = await Assert.ThrowsAsync<AppException>(() => service.UpdateAsync(User, Parse(new { company = new { vatId = "RO18547291" } })));
        Assert.Equal("INVALID_VAT_ID", invalid.Code);
        await service.UpdateAsync(User, Parse(new { company = new { name = "Firma SRL", vatId = "RO18547290" } }));
        Assert.Equal("Firma SRL", _companies.Rows[_id].Name);
    }

    [Theory]
    [InlineData("""{"avatarUrl":"javascript:alert(1)"}""", "INVALID_AVATAR")]
    [InlineData("""{"avatarUrl":"http://insecure.example/a.png"}""", "INVALID_AVATAR")]
    [InlineData("""{"defaults":{"currency":"USD","vatRate":21,"marginPercent":10}}""", "INVALID_CURRENCY")]
    [InlineData("""{"defaults":{"currency":"EUR","vatRate":150,"marginPercent":10}}""", "INVALID_VAT")]
    [InlineData("""{"defaults":{"currency":"EUR","vatRate":21,"marginPercent":-1}}""", "INVALID_MARGIN")]
    [InlineData("""{"fullName":42}""", "INVALID_NAME")]
    [InlineData("""[]""", "INVALID_BODY")]
    public void Parser_rejects_unsafe_or_out_of_range_values(string json, string code) =>
        Assert.Equal(code, ProfileUpdateParser.Parse(JsonDocument.Parse(json).RootElement).Code);

    [Fact]
    public void Token_identity_reads_google_metadata_and_drops_non_https_avatars()
    {
        static HttpContext Ctx(string metadata) => new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("user_metadata", metadata)], "test")),
        };
        var google = ProfileEndpoints.ReadTokenIdentity(Ctx("""{"name":"Ana Pop","picture":"https://lh3.googleusercontent.com/a/x"}"""));
        Assert.Equal(("Ana Pop", "https://lh3.googleusercontent.com/a/x"), (google.FullName, google.AvatarUrl));
        var unsafeAvatar = ProfileEndpoints.ReadTokenIdentity(Ctx("""{"full_name":"X","avatar_url":"data:image/png;base64,AAAA"}"""));
        Assert.Null(unsafeAvatar.AvatarUrl);
        Assert.Equal((null, null), (ProfileEndpoints.ReadTokenIdentity(Ctx("not json")).FullName, ProfileEndpoints.ReadTokenIdentity(Ctx("not json")).AvatarUrl));
    }
}

/// <summary>/api/profile over HTTP (auth, contract shape, 503 before migration 004).</summary>
public class ProfileEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public ProfileEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private HttpClient Client(Guid id)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(id, "ana@test.ro"));
        return c;
    }

    [Fact]
    public async Task Get_returns_the_full_contract_and_requires_auth()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync("/api/profile")).StatusCode);

        var body = await Client(Guid.NewGuid()).GetFromJsonAsync<JsonElement>("/api/profile");
        var keys = body.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray();
        Assert.Equal(["account", "bannedReason", "canEditCompany", "company", "defaults", "isBanned", "migrated", "projects", "role", "subscription", "usage"], keys);
        Assert.Equal("user", body.GetProperty("role").GetString());
        Assert.False(body.GetProperty("isBanned").GetBoolean());
        Assert.Equal("ana@test.ro", body.GetProperty("account").GetProperty("email").GetString());
        Assert.Equal(3, body.GetProperty("usage").GetProperty("generationsLimit").GetInt32());
        Assert.Equal("RON", body.GetProperty("defaults").GetProperty("currency").GetString());
    }

    [Fact]
    public async Task Put_saves_and_returns_the_updated_profile_or_503_before_migration()
    {
        var id = Guid.NewGuid();
        var ok = await Client(id).PutAsJsonAsync("/api/profile", new { fullName = "Ana Pop", defaults = new { currency = "RON", vatRate = 21, marginPercent = 18 } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var body = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Ana Pop", body.GetProperty("account").GetProperty("fullName").GetString());
        Assert.Equal(18, body.GetProperty("defaults").GetProperty("marginPercent").GetDouble());

        var bad = await Client(id).PutAsJsonAsync("/api/profile", new { avatarUrl = "javascript:alert(1)" });
        Assert.Equal("INVALID_AVATAR", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        _factory.Profiles.Migrated = false;
        try
        {
            var notMigrated = await Client(id).PutAsJsonAsync("/api/profile", new { avatarUrl = "https://example.com/a.png" });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, notMigrated.StatusCode);
            Assert.Equal("MIGRATION_REQUIRED", (await notMigrated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        }
        finally
        {
            _factory.Profiles.Migrated = true;
        }
    }
}
