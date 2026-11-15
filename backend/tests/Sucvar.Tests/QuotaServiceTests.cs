using Microsoft.Extensions.Logging.Abstractions;
using Sucvar.Application;
using Sucvar.Application.Quota;
using Sucvar.Application.Subscriptions;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

public class QuotaServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly Guid _userId = Guid.NewGuid();
    private readonly FakeSubscriptionRepository _subs = new();
    private readonly FakeUsageRepository _usage = new();
    private readonly FakeAccountStatusRepository _accounts = new();
    private readonly FakeAppSettingsRepository _settings = new();

    private QuotaService Create()
    {
        var clock = new FakeClock(Now);
        var subscriptions = new SubscriptionService(_subs, new FakeStripeGateway(), clock, NullLogger<SubscriptionService>.Instance);
        return new QuotaService(subscriptions, _usage, _accounts, SettingsFactory.Create(_settings, clock), clock, NullLogger<QuotaService>.Instance);
    }

    private AuthUser User => new(_userId.ToString(), "user@test.ro");

    private Task<QuotaResult> Check(TokenState state = TokenState.Valid, bool allowAnon = false, bool configured = true) =>
        Create().CheckAsync(state, state == TokenState.Valid ? User : null, allowAnon, configured, "ConnectionStrings__Supabase", false);

    [Fact]
    public async Task Starter_below_limit_is_allowed()
    {
        _usage.Projects = 2;
        var r = await Check();
        Assert.True(r.Ok);
        Assert.Equal("starter", r.Tier);
        Assert.False(r.IsPro);
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), _usage.LastSince); // UTC calendar month
    }

    [Fact]
    public async Task Starter_at_limit_gets_403_with_used_and_limit()
    {
        _usage.Projects = 1;
        _usage.Generations = 3; // usage = max(projects, generations)
        var r = await Check();
        Assert.False(r.Ok);
        Assert.Equal(403, r.Status);
        Assert.Equal("LIMIT_REACHED", r.Code);
        Assert.Equal(3, r.Used);
        Assert.Equal(3, r.Limit);
        Assert.Equal("Ai folosit cele 3 generări gratuite din această lună. Treci la planul Professional.", r.Error);
    }

    [Theory]
    [InlineData("pro", false)]
    [InlineData("agency", true)]
    [InlineData("professional", false)] // legacy synonym, normalized
    [InlineData("enterprise", true)]
    public async Task Paid_tiers_are_unlimited(string tier, bool isAgency)
    {
        _subs.SetTier(_userId, tier, Now.AddDays(10));
        _usage.Projects = 999;
        var r = await Check();
        Assert.True(r.Ok);
        Assert.True(r.IsPro);
        Assert.Equal(isAgency, r.IsAgency);
    }

    [Fact]
    public async Task Expired_paid_plan_falls_back_to_starter_limits()
    {
        _subs.SetTier(_userId, "pro", Now.AddSeconds(-1));
        _usage.Projects = 3;
        var r = await Check();
        Assert.Equal("LIMIT_REACHED", r.Code);
    }

    [Fact]
    public async Task Paid_plan_without_period_end_is_kept()
    {
        _subs.SetTier(_userId, "agency", periodEnd: null);
        Assert.True((await Check()).IsAgency);
    }

    [Fact]
    public async Task Missing_token_is_401_unless_anonymous_generation_is_allowed()
    {
        var denied = await Check(TokenState.Missing);
        Assert.Equal((401, "AUTH_REQUIRED"), (denied.Status, denied.Code));
        Assert.Equal("Autentifică-te pentru a genera proiecte.", denied.Error);

        var anon = await Check(TokenState.Missing, allowAnon: true);
        Assert.True(anon.Ok);
        Assert.Null(anon.UserId);
    }

    [Fact]
    public async Task Invalid_token_is_401_even_when_anonymous_is_allowed()
    {
        var r = await Check(TokenState.Invalid, allowAnon: true);
        Assert.Equal((401, "AUTH_INVALID"), (r.Status, r.Code));
    }

    [Fact]
    public async Task Unconfigured_server_returns_500_not_configured()
    {
        var r = await Check(configured: false);
        Assert.Equal((500, "NOT_CONFIGURED"), (r.Status, r.Code));
        Assert.Contains("ConnectionStrings__Supabase", r.Error);
    }

    [Fact]
    public async Task Usage_count_failure_is_500_quota_check_failed()
    {
        _usage.ThrowOnProjects = true;
        var r = await Check();
        Assert.Equal((500, "QUOTA_CHECK_FAILED"), (r.Status, r.Code));
    }

    [Fact]
    public async Task Profile_read_failure_is_fail_safe_starter()
    {
        _subs.SetTier(_userId, "agency");
        _subs.Throw = true; // provider/DB error: never grant rights "on trust"
        _usage.Projects = 3;
        var r = await Check();
        Assert.Equal("LIMIT_REACHED", r.Code);
    }

    [Fact]
    public async Task Record_generation_logs_provider_and_never_throws_for_anonymous()
    {
        var quota = Create();
        await quota.RecordGenerationAsync(null);
        await quota.RecordGenerationAsync(_userId.ToString(), "replicate", "interiors");
        Assert.Single(_usage.Logged);
        Assert.Equal(("replicate", "interiors"), (_usage.Logged[0].Provider, _usage.Logged[0].Mode));
    }
}
