using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging.Abstractions;
using Sucvar.Api.Auth;
using Sucvar.Application;
using Sucvar.Application.Admin;
using Sucvar.Application.Quota;
using Sucvar.Application.Subscriptions;
using Sucvar.Domain.Admin;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

public class AdminAuthorizationHandlerTests
{
    private readonly FakeAccountStatusRepository _accounts = new();

    private async Task<AuthorizationHandlerContext> Authorize(Guid? userId)
    {
        var claims = userId is { } id ? new[] { new Claim("sub", id.ToString()) } : [];
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, userId is null ? null : "Bearer"));
        var requirement = new AdminRequirement();
        var context = new AuthorizationHandlerContext([requirement], principal, null);
        await new AdminAuthorizationHandler(_accounts, NullLogger<AdminAuthorizationHandler>.Instance).HandleAsync(context);
        return context;
    }

    private static string? Reason(AuthorizationHandlerContext c) => c.FailureReasons.Select(r => r.Message).FirstOrDefault();

    [Fact]
    public async Task Admin_role_from_the_database_succeeds()
    {
        var id = Guid.NewGuid();
        _accounts.Set(id, Roles.Admin);
        var c = await Authorize(id);
        Assert.True(c.HasSucceeded);
        Assert.Equal(1, _accounts.Calls); // checked in PostgreSQL, not in the token
    }

    [Fact]
    public async Task Regular_user_is_refused_with_ADMIN_REQUIRED()
    {
        var c = await Authorize(Guid.NewGuid()); // no row ⇒ AccountStatus.Default (user)
        Assert.False(c.HasSucceeded);
        Assert.Equal(AdminFailures.AdminRequired, Reason(c));
    }

    [Fact]
    public async Task Banned_admin_is_refused_with_ACCOUNT_BANNED()
    {
        var id = Guid.NewGuid();
        _accounts.Set(id, Roles.Admin, banned: true, reason: "compromised");
        var c = await Authorize(id);
        Assert.False(c.HasSucceeded);
        Assert.Equal(AdminFailures.AccountBanned, Reason(c));
    }

    [Fact]
    public async Task Database_not_migrated_means_nobody_is_admin()
    {
        var id = Guid.NewGuid();
        _accounts.Rows[id] = AccountStatus.NotMigrated;
        Assert.False((await Authorize(id)).HasSucceeded);
    }

    [Fact]
    public async Task Anonymous_or_db_failure_never_succeeds()
    {
        Assert.False((await Authorize(null)).HasSucceeded);
        Assert.Equal(0, _accounts.Calls);

        _accounts.Throw = true;
        var c = await Authorize(Guid.NewGuid());
        Assert.False(c.HasSucceeded);
        Assert.Equal(AdminFailures.Unavailable, Reason(c));
    }
}

public class AdminServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly FakeAdminRepository _repo = new();
    private readonly FakeAppSettingsRepository _settings = new();
    private readonly Guid _adminId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();

    public AdminServiceTests()
    {
        _repo.Users[_adminId] = FakeAdminRepository.NewUser(_adminId, "admin@sucvar.ro", role: Roles.Admin);
        _repo.Users[_userId] = FakeAdminRepository.NewUser(_userId, "client@test.ro", used: 3);
    }

    private AuthUser Admin => new(_adminId.ToString(), "admin@sucvar.ro");

    private AdminService Create(string aiProvider = "demo")
    {
        var clock = new FakeClock(Now);
        return new AdminService(_repo, SettingsFactory.Create(_settings, clock), new FakeStripeGateway(), new StubProviderSelector(aiProvider), clock,
            NullLogger<AdminService>.Instance);
    }

    private static JsonElement Details(AuditEntry e) => JsonDocument.Parse(e.DetailsJson).RootElement;

    [Theory]
    [InlineData(true, null)]
    [InlineData(null, Roles.User)]
    public async Task Admin_cannot_ban_or_demote_themselves(bool? ban, string? role)
    {
        var ex = await Assert.ThrowsAsync<AppException>(() =>
            Create().UpdateUserAsync(Admin, _adminId, new AdminUserPatch(null, null, false, role, ban, null)));
        Assert.Equal((400, "SELF_PROTECTION"), (ex.Status, ex.Code));
        Assert.Empty(_repo.Applied);
        Assert.Empty(_repo.Audit);
        Assert.Equal(Roles.Admin, _repo.Users[_adminId].Role);
    }

    [Fact]
    public async Task Admin_can_still_adjust_their_own_plan_and_quota()
    {
        var view = await Create().UpdateUserAsync(Admin, _adminId, new AdminUserPatch("agency", 10, false, null, null, null));
        Assert.Equal("agency", view.Plan);
        Assert.Equal(new[] { AuditActions.UpdatePlan, AuditActions.AdjustQuota }, _repo.Audit.Select(a => a.Action));
    }

    [Fact]
    public async Task Ban_writes_the_change_and_one_audit_row_with_reason_and_admin_identity()
    {
        var view = await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch(null, null, false, null, true, "Fraudă la plată"));

        Assert.True(view.IsBanned);
        Assert.Equal("Fraudă la plată", view.BannedReason);
        var entry = Assert.Single(_repo.Audit);
        Assert.Equal((AuditActions.ToggleBan, AuditTargets.User, _userId.ToString()), (entry.Action, entry.TargetType, entry.TargetId));
        Assert.Equal((_adminId, "admin@sucvar.ro"), (entry.AdminUserId, entry.AdminEmail));
        Assert.True(Details(entry).GetProperty("isBanned").GetBoolean());
        Assert.Equal("Fraudă la plată", Details(entry).GetProperty("reason").GetString());

        // Unban clears the reason and is journaled too
        view = await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch(null, null, false, null, false, null));
        Assert.False(view.IsBanned);
        Assert.Null(view.BannedReason);
        Assert.Equal(2, _repo.Audit.Count);
    }

    [Fact]
    public async Task Combined_patch_logs_every_change_separately()
    {
        var view = await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch("pro", 50, true, Roles.Admin, null, null));

        Assert.Equal(new[] { AuditActions.UpdatePlan, AuditActions.AdjustQuota, AuditActions.ChangeRole }, _repo.Audit.Select(a => a.Action));
        Assert.Equal(("starter", "pro"), (Details(_repo.Audit[0]).GetProperty("from").GetString(), Details(_repo.Audit[0]).GetProperty("to").GetString()));
        var quota = Details(_repo.Audit[1]);
        Assert.Equal((50, true, 0, 50), (quota.GetProperty("delta").GetInt32(), quota.GetProperty("reset").GetBoolean(),
            quota.GetProperty("bonusBefore").GetInt32(), quota.GetProperty("bonusAfter").GetInt32()));
        Assert.Equal(("pro", Roles.Admin, (int?)null), (view.Plan, view.Role, view.GenerationsLimit)); // pro = unlimited
    }

    [Fact]
    public async Task Starter_credits_raise_the_limit_and_negative_credits_never_go_below_zero()
    {
        var view = await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch(null, 10, false, null, null, null));
        Assert.Equal((10, (int?)13), (view.BonusGenerations, view.GenerationsLimit)); // 3 (plan_limits.starter) + 10

        view = await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch(null, -50, false, null, null, null));
        Assert.Equal(0, view.BonusGenerations);
    }

    [Fact]
    public async Task No_op_patch_writes_nothing()
    {
        await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch("starter", null, false, Roles.User, false, null));
        Assert.Empty(_repo.Applied);
        Assert.Empty(_repo.Audit);
    }

    [Fact]
    public async Task Granting_a_plan_over_an_expired_period_clears_the_period_so_it_takes_effect()
    {
        _repo.Users[_userId] = FakeAdminRepository.NewUser(_userId, "client@test.ro", tier: "pro", periodEnd: Now.AddDays(-3));
        var view = await Create().UpdateUserAsync(Admin, _userId, new AdminUserPatch("pro", null, false, null, null, null));

        Assert.True(_repo.Applied.Single().Changes.ClearPeriod);
        Assert.Equal("pro", view.Plan);
        Assert.Equal("starter", Details(_repo.Audit.Single()).GetProperty("from").GetString());
    }

    [Fact]
    public async Task Unknown_user_is_404_and_nothing_is_logged()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() =>
            Create().UpdateUserAsync(Admin, Guid.NewGuid(), new AdminUserPatch(null, null, false, null, true, null)));
        Assert.Equal(404, ex.Status);
        Assert.Empty(_repo.Audit);
    }

    [Fact]
    public async Task Unpublish_is_audited_and_404_when_already_private()
    {
        _repo.Projects["p1"] = (new AdminPublicProject("p1", "Living", "interiors", null, "o@x.ro", "pending", null, null, "2026-11-01", null), true);

        await Create().UnpublishAsync(Admin, "p1");
        Assert.False(_repo.Projects["p1"].IsPublic);
        var entry = Assert.Single(_repo.Audit);
        Assert.Equal((AuditActions.UnpublishProject, AuditTargets.Project, "p1"), (entry.Action, entry.TargetType, entry.TargetId));

        var ex = await Assert.ThrowsAsync<AppException>(() => Create().UnpublishAsync(Admin, "p1"));
        Assert.Equal(404, ex.Status);
        Assert.Single(_repo.Audit);
    }

    [Fact]
    public async Task Overview_computes_mrr_api_cost_and_margin_from_settings()
    {
        _repo.Counts = AdminOverviewCounts.Empty with
        {
            TotalUsers = 10, StarterUsers = 6, ProUsers = 3, AgencyUsers = 1,
            PayingProMonthly = 2, PayingProYearly = 1, PayingAgencyMonthly = 1,
            RendersThisMonth = 100, PublicProjects = 4,
        };

        var o = await Create("replicate").GetOverviewAsync();

        Assert.Equal(160.20m, o.EstimatedMrrEur);  // 29×2 + 29×0.8 + 79
        Assert.Equal(4.00m, o.EstimatedApiCostEur); // 100 × 0.04
        Assert.Equal(156.20m, o.EstimatedNetMarginEur);
        Assert.Equal(new SubscribersByPlan(6, 3, 1), o.SubscribersByPlan);
        Assert.Equal(4, o.PayingSubscribers);
        Assert.Equal(new SystemHealth("ok", "ok", "ok", "replicate"), o.SystemHealth);
    }

    [Fact]
    public async Task Overview_reports_database_down_instead_of_failing()
    {
        _repo.PingOk = false;
        var o = await Create().GetOverviewAsync();
        Assert.Equal(("down", "demo"), (o.SystemHealth.Database, o.SystemHealth.Replicate));
        Assert.Equal(0, o.TotalUsers);
    }
}

public class PlatformSettingsTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly FakeAppSettingsRepository _repo = new();
    private AuthUser Admin { get; } = new(Guid.NewGuid().ToString(), "admin@sucvar.ro");

    private PlatformSettingsService Create() => SettingsFactory.Create(_repo, new FakeClock(Now));
    private static JsonElement Body(object o) => JsonSerializer.SerializeToElement(o);

    [Fact]
    public void Seeded_defaults_match_PlanTiers()
    {
        var s = SettingsCodec.FromStorage(_repo.Rows!);
        Assert.Equal(PlatformSettings.Defaults, s);
        Assert.Equal((3, (int?)null, (int?)null), (s.PlanLimits.Starter.MonthlyGenerations!.Value, s.PlanLimits.Pro.MonthlyGenerations, s.PlanLimits.Agency.MonthlyGenerations));
        Assert.Equal((29m, 79m), (s.PricingDisplay.Pro.MonthlyEur, s.PricingDisplay.Agency.MonthlyEur));
        Assert.Equal(0.04m, s.SystemFlags.EstimatedRenderCostEur);
    }

    [Fact]
    public void Corrupt_storage_falls_back_to_defaults_field_by_field()
    {
        var s = SettingsCodec.FromStorage(new Dictionary<string, string>
        {
            ["plan_limits"] = """{"starter":{"monthly_generations":"many"},"pro":{"monthly_generations":500}}""",
            ["system_flags"] = "not json",
        });
        Assert.Equal((3, (int?)500), (s.PlanLimits.Starter.MonthlyGenerations!.Value, s.PlanLimits.Pro.MonthlyGenerations));
        Assert.Equal(PlatformSettings.Defaults.SystemFlags, s.SystemFlags);
    }

    [Fact]
    public async Task Partial_update_changes_only_given_fields_and_is_audited_with_before_after()
    {
        var view = await Create().UpdateAsync(Admin, Body(new { systemFlags = new { maintenanceMode = true }, planLimits = new { starter = new { monthlyGenerations = 5 } } }));

        Assert.True(view.Settings.SystemFlags.MaintenanceMode);
        Assert.Equal(0.04m, view.Settings.SystemFlags.EstimatedRenderCostEur);
        Assert.Equal(5, view.Settings.PlanLimits.Starter.MonthlyGenerations);
        var entry = Assert.Single(_repo.Audit);
        Assert.Equal(AuditActions.UpdateSettings, entry.Action);
        var details = JsonDocument.Parse(entry.DetailsJson).RootElement;
        Assert.Equal(3, details.GetProperty("before").GetProperty("plan_limits").GetProperty("starter").GetProperty("monthly_generations").GetInt32());
        Assert.Equal(5, details.GetProperty("after").GetProperty("plan_limits").GetProperty("starter").GetProperty("monthly_generations").GetInt32());
        Assert.Contains("\"maintenance_mode\":true", _repo.Rows!["system_flags"]);
    }

    [Theory]
    [InlineData("""{"planLimits":{"starter":{"monthlyGenerations":-1}}}""")]
    [InlineData("""{"systemFlags":{"maintenanceMode":"yes"}}""")]
    [InlineData("""{"pricingDisplay":{"currency":"USD"}}""")]
    [InlineData("""{"systemFlags":{"estimatedRenderCostEur":1000}}""")]
    [InlineData("""{"unknown":1}""")]
    public async Task Invalid_values_are_rejected_with_400(string json)
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => Create().UpdateAsync(Admin, JsonDocument.Parse(json).RootElement));
        Assert.Equal((400, "INVALID_SETTINGS"), (ex.Status, ex.Code));
        Assert.Empty(_repo.Audit);
    }

    [Fact]
    public async Task Unchanged_update_writes_no_audit_and_missing_table_is_503()
    {
        await Create().UpdateAsync(Admin, Body(new { systemFlags = new { maintenanceMode = false } }));
        Assert.Empty(_repo.Audit);

        _repo.Rows = null;
        var ex = await Assert.ThrowsAsync<AppException>(() => Create().UpdateAsync(Admin, Body(new { systemFlags = new { maintenanceMode = true } })));
        Assert.Equal(503, ex.Status);
        Assert.Equal(PlatformSettings.Defaults, await Create().GetAsync()); // reads still work
    }
}

public class AdminUserPatchParserTests
{
    private static ParsedAdminUserPatch Parse(string json) => AdminUserPatchParser.Parse(JsonDocument.Parse(json).RootElement);

    [Theory]
    [InlineData("{}", "EMPTY_PATCH")]
    [InlineData("""{"plan":"enterprise"}""", "INVALID_PLAN")]
    [InlineData("""{"quotaDelta":0}""", "INVALID_QUOTA")]
    [InlineData("""{"quotaDelta":5000}""", "INVALID_QUOTA")]
    [InlineData("""{"quotaDelta":1.5}""", "INVALID_QUOTA")]
    [InlineData("""{"role":"root"}""", "INVALID_ROLE")]
    [InlineData("""{"isBanned":"true"}""", "INVALID_BODY")]
    [InlineData("""{"bannedReason":"x"}""", "INVALID_REASON")]
    [InlineData("[]", "INVALID_BODY")]
    public void Rejects_invalid_patches(string json, string code)
    {
        var r = Parse(json);
        Assert.False(r.Ok);
        Assert.Equal(code, r.Code);
    }

    [Fact]
    public void Accepts_a_full_patch_and_cleans_the_reason()
    {
        var r = Parse("""{"plan":" PRO ","quotaDelta":-10,"resetQuota":true,"role":"admin","isBanned":true,"bannedReason":"  spam\u0000 "}""");
        Assert.True(r.Ok);
        Assert.Equal(new AdminUserPatch("pro", -10, true, "admin", true, "spam"), r.Value);
    }
}

public class QuotaWithAdminCreditsTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly Guid _id = Guid.NewGuid();
    private readonly FakeSubscriptionRepository _subs = new();
    private readonly FakeUsageRepository _usage = new();
    private readonly FakeAccountStatusRepository _accounts = new();
    private readonly FakeAppSettingsRepository _settings = new();

    private Task<QuotaResult> Check()
    {
        var clock = new FakeClock(Now);
        var subscriptions = new SubscriptionService(_subs, new FakeStripeGateway(), clock, NullLogger<SubscriptionService>.Instance);
        var quota = new QuotaService(subscriptions, _usage, _accounts, SettingsFactory.Create(_settings, clock), clock, NullLogger<QuotaService>.Instance);
        return quota.CheckAsync(TokenState.Valid, new AuthUser(_id.ToString(), "u@test.ro"), false, true, null, false);
    }

    [Fact]
    public async Task Bonus_credits_extend_the_starter_limit()
    {
        _usage.Generations = 3;
        Assert.Equal("LIMIT_REACHED", (await Check()).Code);
        _accounts.Set(_id, bonus: 10);
        Assert.True((await Check()).Ok);
    }

    [Fact]
    public async Task Quota_reset_counts_usage_from_the_reset_instant()
    {
        var reset = Now.AddDays(-2);
        _accounts.Set(_id, resetAt: reset);
        await Check();
        Assert.Equal(reset, _usage.LastSince);
    }

    [Fact]
    public async Task Plan_limits_come_from_app_settings()
    {
        _settings.Set(PlatformSettings.Defaults with
        {
            PlanLimits = new PlanLimits(new PlanLimit(1), new PlanLimit(100), new PlanLimit(null)),
        });
        _usage.Generations = 1;
        var r = await Check();
        Assert.Equal(("LIMIT_REACHED", (int?)1), (r.Code, r.Limit));

        _subs.SetTier(_id, "pro");
        _usage.Generations = 100;
        Assert.Equal((int?)100, (await Check()).Limit);
    }
}

/// <summary>HTTP: AdminOnly policy, JSON error contract, central ban + maintenance guard.</summary>
public class AdminEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public AdminEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private HttpClient Client(SucvarApiFactory factory, Guid id, string email = "user@test.ro")
    {
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(id, email));
        return c;
    }

    private static async Task<(HttpStatusCode Status, string? Code)> Read(HttpResponseMessage r)
    {
        var text = await r.Content.ReadAsStringAsync();
        var code = text.StartsWith('{') && JsonDocument.Parse(text).RootElement.TryGetProperty("code", out var c) ? c.GetString() : null;
        return (r.StatusCode, code);
    }

    private Guid NewAdmin()
    {
        var id = Guid.NewGuid();
        _factory.Accounts.Set(id, Roles.Admin);
        _factory.Admin.Users[id] = FakeAdminRepository.NewUser(id, "admin@sucvar.ro", role: Roles.Admin);
        return id;
    }

    [Fact]
    public async Task Admin_routes_answer_401_403_with_the_json_contract()
    {
        Assert.Equal((HttpStatusCode.Unauthorized, "AUTH_REQUIRED"), await Read(await _factory.CreateClient().GetAsync("/api/admin/overview")));
        Assert.Equal((HttpStatusCode.Forbidden, "ADMIN_REQUIRED"), await Read(await Client(_factory, Guid.NewGuid()).GetAsync("/api/admin/overview")));

        var banned = Guid.NewGuid();
        _factory.Accounts.Set(banned, Roles.Admin, banned: true);
        Assert.Equal((HttpStatusCode.Forbidden, "ACCOUNT_BANNED"), await Read(await Client(_factory, banned).GetAsync("/api/admin/users")));
    }

    [Fact]
    public async Task Admin_gets_overview_users_settings_and_audit_log()
    {
        var c = Client(_factory, NewAdmin(), "admin@sucvar.ro");

        var overview = await c.GetFromJsonAsync<JsonElement>("/api/admin/overview");
        foreach (var key in new[] { "totalUsers", "newUsersLast30Days", "bannedUsers", "subscribersByPlan", "estimatedMrrEur", "rendersToday",
                     "rendersThisMonth", "totalRenders", "estimatedApiCostEur", "estimatedNetMarginEur", "totalProjects", "publicProjectsCount",
                     "totalB2bEstimates", "systemHealth" })
            Assert.True(overview.TryGetProperty(key, out _), key);
        Assert.Equal("demo", overview.GetProperty("systemHealth").GetProperty("replicate").GetString());

        var users = await c.GetFromJsonAsync<JsonElement>("/api/admin/users?q=admin&pageSize=10");
        Assert.True(users.GetProperty("total").GetInt32() >= 1);
        Assert.Equal(10, users.GetProperty("pageSize").GetInt32());

        var settings = await c.GetFromJsonAsync<JsonElement>("/api/admin/settings");
        Assert.Equal(3, settings.GetProperty("settings").GetProperty("planLimits").GetProperty("starter").GetProperty("monthlyGenerations").GetInt32());

        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/admin/audit-logs")).StatusCode);
        Assert.Equal((HttpStatusCode.BadRequest, "INVALID_QUERY"), await Read(await c.GetAsync("/api/admin/users?plan=gold")));
        Assert.Equal((HttpStatusCode.BadRequest, "INVALID_QUERY"), await Read(await c.GetAsync("/api/admin/users?page=-1")));
    }

    [Fact]
    public async Task Patch_self_ban_is_400_and_ban_of_another_user_is_audited()
    {
        var adminId = NewAdmin();
        var c = Client(_factory, adminId, "admin@sucvar.ro");

        Assert.Equal((HttpStatusCode.BadRequest, "SELF_PROTECTION"),
            await Read(await c.PatchAsJsonAsync($"/api/admin/users/{adminId}", new { isBanned = true })));
        Assert.Equal((HttpStatusCode.BadRequest, "SELF_PROTECTION"),
            await Read(await c.PatchAsJsonAsync($"/api/admin/users/{adminId}", new { role = "user" })));

        var target = Guid.NewGuid();
        _factory.Admin.Users[target] = FakeAdminRepository.NewUser(target, "victim@test.ro");
        var ok = await c.PatchAsJsonAsync($"/api/admin/users/{target}", new { isBanned = true, bannedReason = "spam" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var user = (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("user");
        Assert.True(user.GetProperty("isBanned").GetBoolean());
        Assert.Contains(_factory.Admin.Audit, a => a.TargetId == target.ToString() && a.Action == AuditActions.ToggleBan && a.AdminUserId == adminId);

        Assert.Equal((HttpStatusCode.BadRequest, "INVALID_ID"), await Read(await c.PatchAsJsonAsync("/api/admin/users/nope", new { isBanned = true })));
        Assert.Equal((HttpStatusCode.NotFound, "NOT_FOUND"), await Read(await c.PatchAsJsonAsync($"/api/admin/users/{Guid.NewGuid()}", new { quotaDelta = 10 })));
    }

    [Fact]
    public async Task Banned_users_get_403_on_protected_routes_but_can_still_read_their_profile()
    {
        var id = Guid.NewGuid();
        _factory.Accounts.Set(id, banned: true, reason: "Abuz");
        var c = Client(_factory, id);

        var generate = await c.PostAsJsonAsync("/api/generate", new { });
        Assert.Equal((HttpStatusCode.Forbidden, "ACCOUNT_BANNED"), await Read(generate));
        Assert.Equal((HttpStatusCode.Forbidden, "ACCOUNT_BANNED"), await Read(await c.GetAsync("/api/b2b/estimates")));
        Assert.Equal((HttpStatusCode.Forbidden, "ACCOUNT_BANNED"), await Read(await c.GetAsync("/api/projects/sharing")));
        Assert.Equal((HttpStatusCode.Forbidden, "ACCOUNT_BANNED"), await Read(await c.PostAsJsonAsync("/api/checkout", new { plan = "pro" })));

        var profile = await c.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.True(profile.GetProperty("isBanned").GetBoolean());
        Assert.Equal("Abuz", profile.GetProperty("bannedReason").GetString());
    }

    [Fact]
    public async Task Maintenance_mode_blocks_users_but_not_admins_and_is_public()
    {
        await using var factory = new SucvarApiFactory(); // own instance: settings are cached per process
        factory.Settings.Set(PlatformSettings.Defaults with { SystemFlags = PlatformSettings.Defaults.SystemFlags with { MaintenanceMode = true } });

        var user = Client(factory, Guid.NewGuid());
        Assert.Equal((HttpStatusCode.ServiceUnavailable, "MAINTENANCE"), await Read(await user.PostAsJsonAsync("/api/generate", new { })));

        var adminId = Guid.NewGuid();
        factory.Accounts.Set(adminId, Roles.Admin);
        var admin = await Read(await Client(factory, adminId).PostAsJsonAsync("/api/generate", new { }));
        Assert.Equal((HttpStatusCode.BadRequest, "IMAGE_REQUIRED"), admin); // passed the guard

        var status = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/public/status");
        Assert.True(status.GetProperty("maintenanceMode").GetBoolean());
        Assert.True(status.GetProperty("allowNewRegistrations").GetBoolean());
    }

    [Fact]
    public async Task Unpublish_endpoint_flips_the_project_and_logs_it()
    {
        var adminId = NewAdmin();
        _factory.Admin.Projects["proj-1"] = (new AdminPublicProject("proj-1", "Vila", "exteriors", null, null, "pending", null, null, "2026-11-01", null), true);
        var c = Client(_factory, adminId, "admin@sucvar.ro");

        var list = await c.GetFromJsonAsync<JsonElement>("/api/admin/public-projects");
        Assert.Contains(list.GetProperty("items").EnumerateArray(), p => p.GetProperty("id").GetString() == "proj-1");

        Assert.Equal(HttpStatusCode.OK, (await c.PostAsync("/api/admin/public-projects/proj-1/unpublish", null)).StatusCode);
        Assert.False(_factory.Admin.Projects["proj-1"].IsPublic);
        Assert.Contains(_factory.Admin.Audit, a => a.Action == AuditActions.UnpublishProject && a.TargetId == "proj-1");
        Assert.Equal((HttpStatusCode.NotFound, "NOT_FOUND"), await Read(await c.PostAsync("/api/admin/public-projects/proj-1/unpublish", null)));
    }
}

/// <summary>IImageProviderSelector returning a provider with the given id (health reporting only).</summary>
public sealed class StubProviderSelector(string id) : IImageProviderSelector
{
    private sealed class Provider(string id) : IImageProvider
    {
        public string Id => id;
        public bool IsConfigured => true;
        public Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default) => throw new NotSupportedException();
    }

    public (IImageProvider Provider, string? Warning) Select() => (new Provider(id), null);
}

public class AdminB2bAccessTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public AdminB2bAccessTests(SucvarApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Admin_role_in_the_database_unlocks_b2b_without_the_agency_plan()
    {
        var user = Guid.NewGuid();
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(user));
        Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/b2b/estimates")).StatusCode);

        _factory.Accounts.Set(user, Roles.Admin);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/b2b/estimates")).StatusCode);
    }
}
