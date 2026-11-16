using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>
/// Security projection of GET /api/public/projects/{id}: the contractor's margins, purchase unit prices,
/// hourly rates, internal notes and user_id must never reach the end client — not even in the JSON.
/// </summary>
public class PublicPortalTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    private readonly Guid _owner = Guid.NewGuid();

    public PublicPortalTests(SucvarApiFactory factory)
    {
        _factory = factory;
    }

    private string Seed(bool isPublic, bool withEstimate = true)
    {
        var id = $"p-{Guid.NewGuid():N}";
        _factory.Portal.Projects.Add(new FakePortalRepository.Project { Id = id, OwnerId = _owner, IsPublic = isPublic });
        if (withEstimate) _factory.Portal.Estimates.Add(new FakePortalRepository.Estimate { OwnerId = _owner, ProjectId = id });
        return id;
    }

    private static HttpRequestMessage Review(string id, string json, string contentType = "application/json", string ip = "10.0.0.1")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/public/projects/{id}/review")
        {
            Content = new StringContent(json, Encoding.UTF8, contentType),
        };
        req.Headers.TryAddWithoutValidation("x-forwarded-for", ip);
        return req;
    }

    [Fact]
    public async Task Public_project_exposes_only_the_public_projection()
    {
        var id = Seed(isPublic: true);
        var res = await _factory.CreateClient().GetAsync($"/api/public/projects/{id}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.True(res.Headers.CacheControl is { Private: true, NoStore: true });

        var raw = await res.Content.ReadAsStringAsync();
        var project = JsonDocument.Parse(raw).RootElement.GetProperty("project");

        // Exactly the PublicProject contract — nothing more
        var keys = project.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray();
        Assert.Equal(new[]
        {
            "areaM2", "clientReviewedAt", "clientStatus", "clientTotal", "createdAt", "designBrief", "dimensions", "generatedImage", "id", "items", "materials",
            "mode", "originalImage", "pricingBreakdown", "reference", "spaceType", "styleId", "title", "vatIncluded",
        }, keys);
        Assert.Equal(["doorsCount", "height", "length", "width", "windowsCount"],
            project.GetProperty("dimensions").EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray());

        // No owner identity, no internal economics anywhere in the payload
        // (client-facing prices are allowed — `clientUnitPrice`, `materialsSubtotal` — but never the purchase price 987.65,
        //  the raw purchase cost 32918.37, the margin 37.5 % / contingency 11 % or their amounts)
        foreach (var secret in new[] { _owner.ToString(), "owner@firma.ro", "user_id", "userId", "margin", "contingency", "rateOverride",
                     "rate_override", "987.65", "32918", "37.5", "purchase", "\"price\"", "\"unitPrice\"", "\"total\"", "hourly", "\"rate\"", "laborRate", "profit",
                     "SECRET-NOTE", "INTERNAL-FEEDBACK", "notes", "budget", "\"subtotal\"", "netSubtotal" })
        {
            Assert.DoesNotContain(secret, raw, StringComparison.OrdinalIgnoreCase);
        }

        // Materials: name + unit + qty only; empty names and qty 0 dropped; qty rounded to 2 decimals
        var materials = project.GetProperty("materials");
        Assert.Equal(1, materials.GetArrayLength());
        var m = materials[0];
        Assert.Equal(["category", "nameEn", "nameRo", "qty", "unit"], m.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray());
        Assert.Equal(33.33, m.GetProperty("qty").GetDouble());

        // Final client total = estimate total (VAT included), reference = estimate doc number
        Assert.Equal(72600, project.GetProperty("clientTotal").GetDouble());
        Assert.True(project.GetProperty("vatIncluded").GetBoolean());
        Assert.Equal("DV-2026-001", project.GetProperty("reference").GetString());
        Assert.Equal(30, project.GetProperty("areaM2").GetDouble());
    }

    [Fact]
    public async Task Public_project_itemizes_client_prices_with_retailer_links_and_a_cost_breakdown()
    {
        var id = Seed(isPublic: true);
        var project = (await _factory.CreateClient().GetFromJsonAsync<JsonElement>($"/api/public/projects/{id}")).GetProperty("project");

        // Items: client-facing shape only — no purchase price, no margin fields
        var items = project.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        var item = items[0];
        Assert.Equal(new[] { "category", "clientLineTotal", "clientUnitPrice", "id", "links", "name", "nameEn", "quantity", "retailerName", "retailerUrl", "unit" },
            item.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray());
        Assert.Equal("Parchet stejar", item.GetProperty("name").GetString());
        Assert.Equal(33.33, item.GetProperty("quantity").GetDouble());

        // Margin + contingency are baked into the line price on the server: 987.65 × 1.11 × 1.375
        var expectedUnit = Math.Round(987.65 * 1.11 * 1.375, 2, MidpointRounding.AwayFromZero);
        Assert.Equal(expectedUnit, item.GetProperty("clientUnitPrice").GetDouble());
        var expectedLine = Math.Round(33.33 * expectedUnit, 2, MidpointRounding.AwayFromZero);
        Assert.Equal(expectedLine, item.GetProperty("clientLineTotal").GetDouble());

        // Real market sourcing: rebuilt retailer search links (trade flooring → Dedeman first, Romanian query)
        Assert.Equal("Dedeman", item.GetProperty("retailerName").GetString());
        Assert.Equal("https://www.dedeman.ro/ro/catalogsearch/result/?q=Parchet%20stejar", item.GetProperty("retailerUrl").GetString());
        Assert.All(item.GetProperty("links").EnumerateArray(), l => Assert.StartsWith("https://", l.GetProperty("url").GetString()));

        // Cost summary: materials + labour (rest of the net) + VAT = official quote total
        var b = project.GetProperty("pricingBreakdown");
        Assert.Equal(new[] { "currency", "grandTotal", "laborSubtotal", "materialsSubtotal", "pricingSource", "vatAmount", "vatRate" },
            b.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray());
        Assert.Equal("b2b_quote", b.GetProperty("pricingSource").GetString());
        Assert.Equal("EUR", b.GetProperty("currency").GetString());
        Assert.Equal(expectedLine, b.GetProperty("materialsSubtotal").GetDouble());
        Assert.Equal(Math.Round(60000 - expectedLine, 2), b.GetProperty("laborSubtotal").GetDouble(), 2);
        Assert.Equal(21, b.GetProperty("vatRate").GetDouble());
        Assert.Equal(12600, b.GetProperty("vatAmount").GetDouble());
        Assert.Equal(72600, b.GetProperty("grandTotal").GetDouble(), 2);
    }

    [Fact]
    public async Task Without_estimate_the_portal_shows_the_studio_market_estimate_with_links()
    {
        var id = Seed(isPublic: true, withEstimate: false);
        var project = (await _factory.CreateClient().GetFromJsonAsync<JsonElement>($"/api/public/projects/{id}")).GetProperty("project");
        var items = project.GetProperty("items");
        Assert.True(items.GetArrayLength() > 0);
        Assert.All(items.EnumerateArray(), i =>
        {
            Assert.True(i.GetProperty("clientUnitPrice").GetDouble() > 0);
            Assert.Matches("^https://(www\\.)?(dedeman|leroymerlin|hornbach|bricodepot|ikea|mobexpert)\\.", i.GetProperty("retailerUrl").GetString());
        });
        var b = project.GetProperty("pricingBreakdown");
        Assert.Equal("studio_estimate", b.GetProperty("pricingSource").GetString());
        var materials = b.GetProperty("materialsSubtotal").GetDouble();
        var labor = b.GetProperty("laborSubtotal").GetDouble();
        Assert.Equal(Math.Round(items.EnumerateArray().Sum(i => i.GetProperty("clientLineTotal").GetDouble()), 2), materials, 2);
        Assert.Equal(12345.68, materials + labor, 2); // net = Studio estimate (excl. VAT)
        Assert.Equal(Math.Round(12345.68 * 0.21, 2), b.GetProperty("vatAmount").GetDouble(), 2);
        Assert.Equal(materials + labor + b.GetProperty("vatAmount").GetDouble(), b.GetProperty("grandTotal").GetDouble(), 2);
    }

    [Fact]
    public async Task Stored_procurement_links_are_rebuilt_never_echoed()
    {
        var id = Seed(isPublic: true, withEstimate: false);
        _factory.Portal.Projects.Single(p => p.Id == id).ProcurementItems =
            """[{"id":"proc-x","cat":"finishes","procCategory":"construction","titleRo":"Vopsea","titleEn":"Paint","qty":10,"unit":"m²","unitPrice":4.5,"query":"vopsea lavabila","links":[{"retailer":"evil","label":"Evil","url":"https://evil.example/phish"}]}]""";
        var raw = await (await _factory.CreateClient().GetAsync($"/api/public/projects/{id}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("evil.example", raw);
        var item = JsonDocument.Parse(raw).RootElement.GetProperty("project").GetProperty("items")[0];
        Assert.Equal("Vopsea", item.GetProperty("name").GetString());
        Assert.Equal(45, item.GetProperty("clientLineTotal").GetDouble());
        Assert.Equal("https://www.dedeman.ro/ro/catalogsearch/result/?q=vopsea%20lavabila", item.GetProperty("retailerUrl").GetString());
    }

    [Fact]
    public async Task Archive_procurement_is_owner_only_and_backfills_older_projects()
    {
        var id = $"p-{Guid.NewGuid():N}";
        _factory.Procurement.Rows.Add(new FakeProcurementRepository.Row(_owner,
            new Sucvar.Application.Procurement.ProjectProcurementSource(id, "interiors", "kitchen", "japandi", """{"width":4,"length":5,"height":2.7}""", null)));
        var owner = _factory.CreateClient();
        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(_owner));
        var stranger = _factory.CreateClient();
        stranger.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync($"/api/projects/{id}/procurement")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/projects/{id}/procurement")).StatusCode);

        var computed = (await owner.GetFromJsonAsync<JsonElement>($"/api/projects/{id}/procurement")).GetProperty("procurement");
        Assert.False(computed.GetProperty("persisted").GetBoolean());
        Assert.True(computed.GetProperty("items").GetArrayLength() > 0);
        Assert.True(computed.GetProperty("items")[0].GetProperty("links").GetArrayLength() > 0);

        var backfilled = (await (await owner.PostAsync($"/api/projects/{id}/procurement", null)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("procurement");
        Assert.True(backfilled.GetProperty("persisted").GetBoolean());
        Assert.NotNull(_factory.Procurement.Rows.Single(r => r.Source.Id == id).Source.ProcurementItemsJson);

        var stored = (await owner.GetFromJsonAsync<JsonElement>($"/api/projects/{id}/procurement")).GetProperty("procurement");
        Assert.True(stored.GetProperty("persisted").GetBoolean());
        Assert.Equal(computed.GetProperty("total").GetDouble(), stored.GetProperty("total").GetDouble());
    }

    [Fact]
    public async Task Without_estimate_the_studio_budget_and_computed_area_are_used()
    {
        var id = Seed(isPublic: true, withEstimate: false);
        var project = (await _factory.CreateClient().GetFromJsonAsync<JsonElement>($"/api/public/projects/{id}")).GetProperty("project");
        Assert.Equal(12345.68, project.GetProperty("clientTotal").GetDouble());
        Assert.False(project.GetProperty("vatIncluded").GetBoolean());
        Assert.Equal(30, project.GetProperty("areaM2").GetDouble()); // 5 × 6 from dimensions
        Assert.StartsWith("SUC-P", project.GetProperty("reference").GetString());
        Assert.Equal(0, project.GetProperty("materials").GetArrayLength());
        Assert.Equal("studio_estimate", project.GetProperty("pricingBreakdown").GetProperty("pricingSource").GetString());
    }

    [Fact]
    public async Task Private_and_missing_projects_return_the_identical_404()
    {
        var client = _factory.CreateClient();
        var privateRes = await client.GetAsync($"/api/public/projects/{Seed(isPublic: false)}");
        var missingRes = await client.GetAsync("/api/public/projects/does-not-exist");
        Assert.Equal(HttpStatusCode.NotFound, privateRes.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missingRes.StatusCode);
        var expected = """{"error":"Proiect privat sau inexistent.","code":"NOT_FOUND"}""";
        Assert.Equal(expected, await privateRes.Content.ReadAsStringAsync());
        Assert.Equal(expected, await missingRes.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Invalid_id_is_400()
    {
        var res = await _factory.CreateClient().GetAsync("/api/public/projects/bad%20id!");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("INVALID_ID", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Review_writes_only_on_public_projects_and_sanitizes_feedback()
    {
        var client = _factory.CreateClient();
        var id = Seed(isPublic: true);
        var ok = await client.SendAsync(Review(id, """{"status":"changes_requested","feedback":"  Mai multă lumină\u0007 \n vă rog  "}""", ip: "10.1.0.1"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var body = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("changes_requested", body.GetProperty("clientStatus").GetString());
        Assert.Equal("Mai multă lumină \n vă rog", _factory.Portal.Projects.Single(p => p.Id == id).ClientFeedback);

        var privateRes = await client.SendAsync(Review(Seed(isPublic: false), """{"status":"approved"}""", ip: "10.1.0.2"));
        Assert.Equal(HttpStatusCode.NotFound, privateRes.StatusCode);
    }

    [Fact]
    public async Task Review_validation_matches_the_original_codes()
    {
        var client = _factory.CreateClient();
        var id = Seed(isPublic: true);
        async Task<(HttpStatusCode, string?)> Send(HttpRequestMessage r)
        {
            var res = await client.SendAsync(r);
            var json = await res.Content.ReadFromJsonAsync<JsonElement>();
            return (res.StatusCode, json.GetProperty("code").GetString());
        }

        Assert.Equal((HttpStatusCode.UnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE"), await Send(Review(id, "{}", "text/plain", "10.2.0.1")));
        Assert.Equal((HttpStatusCode.BadRequest, "INVALID_JSON"), await Send(Review(id, "{nope", ip: "10.2.0.2")));
        Assert.Equal((HttpStatusCode.BadRequest, "INVALID_STATUS"), await Send(Review(id, """{"status":"pending"}""", ip: "10.2.0.3")));
        Assert.Equal((HttpStatusCode.BadRequest, "INVALID_FEEDBACK"), await Send(Review(id, """{"status":"approved","feedback":42}""", ip: "10.2.0.4")));
        Assert.Equal((HttpStatusCode.BadRequest, "FEEDBACK_TOO_LONG"),
            await Send(Review(id, JsonSerializer.Serialize(new { status = "approved", feedback = new string('a', 501) }), ip: "10.2.0.5")));
        Assert.Equal((HttpStatusCode.RequestEntityTooLarge, "PAYLOAD_TOO_LARGE"),
            await Send(Review(id, JsonSerializer.Serialize(new { status = "approved", feedback = new string('a', 4001) }), ip: "10.2.0.6")));
    }

    [Fact]
    public async Task Review_is_rate_limited_per_ip_and_project()
    {
        var client = _factory.CreateClient();
        var id = Seed(isPublic: true);
        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Review(id, """{"status":"approved"}""", ip: "10.3.0.1"))).StatusCode);
        var limited = await client.SendAsync(Review(id, """{"status":"approved"}""", ip: "10.3.0.1"));
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.True(limited.Headers.RetryAfter is not null);
        Assert.Equal("RATE_LIMITED", (await limited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Sharing_is_owner_only()
    {
        var id = Seed(isPublic: false);
        var owner = _factory.CreateClient();
        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(_owner));
        var stranger = _factory.CreateClient();
        stranger.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(Guid.NewGuid()));

        var denied = await stranger.PatchAsJsonAsync("/api/projects/sharing", new { projectId = id, isPublic = true });
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        Assert.False(_factory.Portal.Projects.Single(p => p.Id == id).IsPublic);

        var ok = await owner.PatchAsJsonAsync("/api/projects/sharing", new { projectId = id, isPublic = true });
        Assert.True((await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sharing").GetProperty("isPublic").GetBoolean());

        var list = await owner.GetFromJsonAsync<JsonElement>($"/api/projects/sharing?id={id}");
        Assert.True(list.GetProperty("migrated").GetBoolean());
        Assert.Equal(id, list.GetProperty("items")[0].GetProperty("projectId").GetString());

        var badBody = await owner.PatchAsJsonAsync("/api/projects/sharing", new { projectId = id, isPublic = "yes" });
        Assert.Equal("INVALID_BODY", (await badBody.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }
}

/// <summary>Studio endpoints over HTTP (auth gate + demo generation + BOM).</summary>
public class StudioEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public StudioEndpointTests(SucvarApiFactory factory) => _factory = factory;

    // 64×64 white PNG generated at test time with SkiaSharp
    private static string PngDataUrl(int w = 64, int h = 64)
    {
        using var bmp = new SkiaSharp.SKBitmap(w, h);
        bmp.Erase(SkiaSharp.SKColors.White);
        using var data = SkiaSharp.SKImage.FromBitmap(bmp).Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
        return "data:image/png;base64," + Convert.ToBase64String(data.ToArray());
    }

    [Fact]
    public async Task Generate_requires_a_session()
    {
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/generate", new { image = PngDataUrl() });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("AUTH_REQUIRED", body.GetProperty("code").GetString());
        Assert.False(body.TryGetProperty("used", out _));
    }

    [Fact]
    public async Task Generate_in_demo_mode_returns_the_original_contract_and_validates_images()
    {
        var userId = Guid.NewGuid();
        _factory.Subscriptions.SetTier(userId, "pro");
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));

        var tooSmall = await client.PostAsJsonAsync("/api/generate", new { image = PngDataUrl(32, 32) });
        Assert.Equal((HttpStatusCode)422, tooSmall.StatusCode);
        var corrupt = await client.PostAsJsonAsync("/api/generate", new { image = "data:image/png;base64,AAAAAAAA" });
        Assert.Equal("IMAGE_CORRUPT", (await corrupt.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        var gif = await client.PostAsJsonAsync("/api/generate", new { image = "data:image/gif;base64,AAAA" });
        Assert.Equal("IMAGE_FORMAT", (await gif.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        var missing = await client.PostAsJsonAsync("/api/generate", new { mode = "interiors" });
        Assert.Equal("IMAGE_REQUIRED", (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var ok = await client.PostAsJsonAsync("/api/generate", new
        {
            image = PngDataUrl(), mode = "gardens", spaceType = "residential garden", styleId = "japandi",
            dimensions = new { budget = "luxury", windowsCount = 0 }, ai = new { seed = 42 },
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var body = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("isDemo").GetBoolean());
        Assert.Equal(body.GetProperty("result").GetString(), body.GetProperty("imageUrl").GetString());
        Assert.Equal(body.GetProperty("result").GetString(), body.GetProperty("generatedImage").GetString());
        var expected = Sucvar.Domain.Ai.GenerationPrompt.Create(JsonSerializer.SerializeToElement(new
        {
            mode = "gardens", spaceType = "residential garden", styleId = "japandi", dimensions = new { budget = "luxury", windowsCount = 0 },
        })).Prompt;
        Assert.Equal(expected, body.GetProperty("promptUsed").GetString());
        // Offline test host: the Unsplash demo image cannot be downloaded, so its (non-expiring) URL is kept — as in the monolith
        Assert.Equal(Sucvar.Infrastructure.Ai.DemoImageProvider.Images["gardens"], body.GetProperty("result").GetString());
    }

    [Fact]
    public async Task Analyze_materials_validates_and_returns_bom()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(Guid.NewGuid()));
        var bad = await client.PostAsJsonAsync("/api/analyze-materials", new { mode = "interiors", spaceType = "garage", styleId = "japandi" });
        Assert.Equal("INVALID_SPACE", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var ok = await client.PostAsJsonAsync("/api/analyze-materials", new { mode = "interiors", spaceType = "kitchen", styleId = "japandi", dimensions = new { width = 4, length = 5 } });
        var bom = (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("bom");
        Assert.Equal("EUR", bom.GetProperty("currency").GetString());
        Assert.True(bom.GetProperty("items").GetArrayLength() > 0);
        Assert.Equal("https://www.dedeman.ro/ro/catalogsearch/result/?q=gresie%20portelanata%2060x60%20antiderapanta",
            bom.GetProperty("items")[0].GetProperty("links")[0].GetProperty("url").GetString());
    }
}
