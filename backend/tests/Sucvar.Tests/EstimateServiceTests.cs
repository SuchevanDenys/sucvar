using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Sucvar.Application;
using Sucvar.Application.B2b;
using Sucvar.Application.Subscriptions;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Studio;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

public class EstimateServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly Guid _userId = Guid.NewGuid();
    private readonly FakeSubscriptionRepository _subs = new();
    private readonly FakeEstimateRepository _repo = new();

    private EstimateService Create()
    {
        var clock = new FakeClock(Now);
        return new EstimateService(_repo, new SubscriptionService(_subs, new FakeStripeGateway(), clock, NullLogger<SubscriptionService>.Instance));
    }

    private AuthUser User => new(_userId.ToString(), "agency@firma.ro");

    /// <summary>The frontend's procurementSync `toLine` + workspaceToPayload, as JSON (what PUT receives).</summary>
    private static JsonElement PayloadFromBom(string projectId, IEnumerable<BomItem> items, IEnumerable<object>? manual = null)
    {
        var lines = (manual ?? []).Concat(items.Select(i => (object)new { id = i.Id, cat = i.Cat, ro = i.TitleRo, en = i.TitleEn, unit = i.Unit, qty = i.Qty, price = i.UnitPrice })).ToList();
        return JsonSerializer.SerializeToElement(new
        {
            projectId, docNo = "", status = "draft",
            client = new { name = "", vatId = "", email = "", phone = "", address = "", siteAddress = "", notes = "" },
            region = "center", finishLevel = "standard", areaM2 = 30, crew = 3, contingencyPct = 5, marginPct = 15, vatPct = 21,
            scope = new { }, rateOverride = new { }, lineItems = lines, subtotal = 100, total = 121,
        });
    }

    [Theory]
    [InlineData("agency", 30, true)]
    [InlineData("pro", 30, false)]
    [InlineData("starter", 30, false)]
    [InlineData("agency", -1, false)] // expired agency → effective starter
    public async Task Agency_gate_uses_the_effective_tier(string tier, int days, bool allowed)
    {
        _subs.SetTier(_userId, tier, Now.AddDays(days));
        var (ok, current) = await Create().CheckAgencyAsync(User);
        Assert.Equal(allowed, ok);
        Assert.Equal(allowed ? "agency" : days < 0 ? "starter" : tier, current);
    }

    [Fact]
    public async Task Save_upserts_one_estimate_per_project()
    {
        var service = Create();
        var first = EstimateParser.Parse(PayloadFromBom("proj-1", []));
        var a = await service.SaveAsync(User, first.Value!);
        var b = await service.SaveAsync(User, first.Value! with { DocNo = "DV-2" });
        Assert.Single(_repo.Rows);
        Assert.Equal(a.Id, b.Id);
        Assert.Equal("DV-2", b.DocNo);

        // estimates without project never collide
        await service.SaveAsync(User, first.Value! with { ProjectId = null });
        await service.SaveAsync(User, first.Value! with { ProjectId = null });
        Assert.Equal(3, _repo.Rows.Count);
    }

    [Fact]
    public async Task Ownership_is_enforced_on_list_update_and_delete()
    {
        var service = Create();
        var other = new AuthUser(Guid.NewGuid().ToString(), "other@x.ro");
        var mine = await service.SaveAsync(User, EstimateParser.Parse(PayloadFromBom("shared-id", [])).Value!);
        var theirs = await service.SaveAsync(other, EstimateParser.Parse(PayloadFromBom("shared-id", [])).Value!);

        Assert.NotEqual(mine.Id, theirs.Id); // same project id, different owners → separate rows
        Assert.Single(await service.ListAsync(User));
        Assert.False(await service.DeleteAsync(other, Guid.Parse(mine.Id)));
        Assert.True(await service.DeleteAsync(User, Guid.Parse(mine.Id)));
        Assert.False(await service.DeleteAsync(User, Guid.Parse(mine.Id)));
    }

    [Fact]
    public async Task Material_sync_replaces_procurement_lines_and_keeps_manual_ones()
    {
        var service = Create();
        var dims = DimensionSanitizer.Sanitize(JsonSerializer.SerializeToElement(new { width = 4, length = 5, height = 2.6, budget = "standard" }), "interiors", "kitchen");
        var bom = BomBuilder.Build("interiors", "kitchen", "japandi", dims);
        Assert.InRange(bom.Items.Count, 6, 10);
        Assert.All(bom.Items, i => Assert.StartsWith("proc-", i.Id));

        var manual = new object[] { new { id = "lmanual", cat = "electric", ro = "Priză dublă", en = "Socket", unit = "buc.", qty = 4, price = 12.5 } };
        await service.SaveAsync(User, EstimateParser.Parse(PayloadFromBom("kitchen-1", bom.Items, manual)).Value!);

        // Second sync after the room grew: same stable ids → replaced, not duplicated (procurementSync.ts rule)
        var bigger = BomBuilder.Build("interiors", "kitchen", "japandi", dims with { Width = 6 });
        var saved = await service.SaveAsync(User, EstimateParser.Parse(PayloadFromBom("kitchen-1", bigger.Items, manual)).Value!);

        Assert.Single(_repo.Rows);
        Assert.Equal(bigger.Items.Count + 1, saved.LineItems.Count);
        Assert.Equal(saved.LineItems.Select(l => l.Id).Distinct().Count(), saved.LineItems.Count);
        Assert.Contains(saved.LineItems, l => l.Id == "lmanual" && l.Price == 12.5);
        var floor = saved.LineItems.Single(l => l.Id == "proc-floor");
        Assert.Equal(bigger.Items.Single(i => i.Id == "proc-floor").Qty, floor.Qty);
        Assert.True(floor.Qty > bom.Items.Single(i => i.Id == "proc-floor").Qty);
    }

    [Fact]
    public void Bom_totals_are_qty_times_unit_price_rounded()
    {
        var dims = DimensionSanitizer.Sanitize(JsonSerializer.SerializeToElement(new { width = 3.3, length = 4.1, budget = "luxury", scope = "shell" }), "interiors", "bathroom");
        var bom = BomBuilder.Build("interiors", "bathroom", "industrial", dims);
        foreach (var i in bom.Items) Assert.Equal(Math.Round(i.Qty * i.UnitPrice, 2), i.Total, 2);
        Assert.Equal(Math.Round(bom.Items.Sum(i => i.Total), 2), bom.Total, 2);
        Assert.Contains(bom.Items, i => i.Id == "proc-screed"); // shell scope adds screed
        Assert.All(bom.Items, i => Assert.All(i.Links, l => Assert.DoesNotContain(" ", l.Url)));
    }

    [Fact]
    public void Parser_clamps_untrusted_values_to_sql_check_constraints()
    {
        var parsed = EstimateParser.Parse(JsonSerializer.SerializeToElement(new
        {
            crew = 0, vatPct = 250, marginPct = -4, areaM2 = -10, subtotal = "abc", lineItems = new[] { new { qty = -3, price = 1e12 } },
        }));
        Assert.True(parsed.Ok);
        var v = parsed.Value!;
        Assert.Equal(1, v.Crew);                 // crew >= 1
        Assert.Equal(100, v.VatPct);             // 0..100
        Assert.Equal(0, v.MarginPct);
        Assert.Equal(0, v.AreaM2);
        Assert.Equal(0, v.Subtotal);
        Assert.Equal(0, v.LineItems[0].Qty);
        Assert.Equal(1e9, v.LineItems[0].Price);
        Assert.Equal("l0", v.LineItems[0].Id);
    }
}

/// <summary>/api/b2b/estimates over HTTP: EnterpriseGate + contract shape.</summary>
public class EstimateEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public EstimateEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private HttpClient Client(Guid userId)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return c;
    }

    [Fact]
    public async Task Pro_user_gets_403_agency_required_with_current_tier()
    {
        var id = Guid.NewGuid();
        _factory.Subscriptions.SetTier(id, "pro", DateTimeOffset.UtcNow.AddDays(5));
        var res = await Client(id).GetAsync("/api/b2b/estimates");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("AGENCY_REQUIRED", body.GetProperty("code").GetString());
        Assert.Equal("pro", body.GetProperty("currentTier").GetString());
        Assert.Equal("Portalul B2B necesită planul Agency.", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Agency_user_can_put_list_and_delete()
    {
        var id = Guid.NewGuid();
        _factory.Subscriptions.SetTier(id, "agency", DateTimeOffset.UtcNow.AddDays(5));
        var client = Client(id);

        var put = await client.PutAsJsonAsync("/api/b2b/estimates", new { projectId = "p-42", docNo = " DV-9 ", lineItems = new[] { new { ro = "Parchet", qty = 2, price = 10 } } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var estimate = (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("estimate");
        Assert.Equal("DV-9", estimate.GetProperty("docNo").GetString());
        Assert.Equal("p-42", estimate.GetProperty("projectId").GetString());
        Assert.Equal(21, estimate.GetProperty("vatPct").GetDouble()); // cota standard TVA (migration 008)
        Assert.True(estimate.TryGetProperty("rateOverride", out _));

        var list = await client.GetFromJsonAsync<JsonElement>("/api/b2b/estimates");
        Assert.Equal(1, list.GetProperty("estimates").GetArrayLength());

        var bad = await client.DeleteAsync("/api/b2b/estimates?id=not-a-uuid");
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var del = await client.DeleteAsync($"/api/b2b/estimates?id={estimate.GetProperty("id").GetString()}");
        Assert.Equal("""{"deleted":true}""", await del.Content.ReadAsStringAsync());
        var again = await client.DeleteAsync($"/api/b2b/estimates?id={estimate.GetProperty("id").GetString()}");
        Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
    }

    [Fact]
    public async Task Invalid_estimate_and_token_errors_keep_the_original_codes()
    {
        var id = Guid.NewGuid();
        _factory.Subscriptions.SetTier(id, "agency");
        var res = await Client(id).PutAsJsonAsync("/api/b2b/estimates", new { status = "weird" });
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(("INVALID_ESTIMATE", "status invalid."), (body.GetProperty("code").GetString(), body.GetProperty("error").GetString()));

        var anon = await _factory.CreateClient().GetAsync("/api/b2b/estimates");
        Assert.Equal("AUTH_REQUIRED", (await anon.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var forged = _factory.CreateClient();
        forged.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(id, secret: "another-secret-another-secret-another-secret!!"));
        var invalid = await forged.GetAsync("/api/b2b/estimates");
        Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        Assert.Equal("AUTH_INVALID", (await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var expired = _factory.CreateClient();
        expired.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(id, expires: DateTime.UtcNow.AddMinutes(-5)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await expired.GetAsync("/api/b2b/estimates")).StatusCode);
    }
}
