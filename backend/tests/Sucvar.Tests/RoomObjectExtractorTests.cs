using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Sucvar.Application;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Studio;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>"Shop the look" object inspector: deterministic, prompt-aware hotspots with RON prices and RO retailer links.</summary>
public class RoomObjectExtractorTests
{
    private static readonly string[] RetailerPrefixes =
    [
        "https://www.ikea.com/ro/ro/search/?q=",
        "https://mobexpert.ro/search?q=",
        "https://www.dedeman.ro/ro/catalogsearch/result/?q=",
        "https://www.leroymerlin.ro/search?q=",
        "https://www.hornbach.ro/s/",
    ];

    private static RoomObjectContext Ctx(string space = "living room", string? style = "japandi", string prompt = "",
        string mode = "interiors", SelectionRegion? region = null, string? palette = null) =>
        new(mode, space, style, palette, null, prompt, "standard", region);

    public static TheoryData<string, string> Spaces()
    {
        var data = new TheoryData<string, string>();
        foreach (var s in new[] { "living room", "kitchen", "master bedroom", "bathroom", "home office", "entryway", "attic loft", "walk-in closet", "commercial cafe", "unknown room" })
            data.Add("interiors", s);
        data.Add("exteriors", "modern villa exterior");
        data.Add("gardens", "residential garden");
        return data;
    }

    [Theory]
    [MemberData(nameof(Spaces))]
    public void Every_space_yields_4_to_7_valid_items(string mode, string space)
    {
        var items = RoomObjectExtractor.Extract(Ctx(space, mode: mode));
        Assert.InRange(items.Count, RoomObjectExtractor.MinItems, RoomObjectExtractor.MaxItems);
        Assert.Equal(items.Count, items.Select(i => i.Id).Distinct().Count());
        foreach (var item in items) AssertValid(item);
    }

    [Theory]
    [InlineData("scandinavian")]
    [InlineData("minimalist_obsidian")]
    [InlineData("industrial")]
    [InlineData(null)]
    public void Prices_are_positive_ron_and_scale_with_style(string? style)
    {
        var items = RoomObjectExtractor.Extract(Ctx(style: style));
        Assert.All(items, i => Assert.InRange(i.EstimatedPriceRon, 19, 100_000));
    }

    [Fact]
    public void Is_deterministic_for_the_same_brief()
    {
        var a = RoomObjectExtractor.Extract(Ctx(prompt: "living cald cu canapea din catifea bordo"));
        var b = RoomObjectExtractor.Extract(Ctx(prompt: "living cald cu canapea din catifea bordo"));
        Assert.Equal(a, b);
    }

    [Fact]
    public void The_brief_customises_the_named_object()
    {
        var items = RoomObjectExtractor.Extract(Ctx(prompt: "Living japandi, scaun tapițat din catifea bordo, lumină caldă"));
        var chair = Assert.Single(items, i => i.Id.StartsWith("chair-"));
        Assert.Equal("Scaun tapițat din catifea mată bordo", chair.Label);
        Assert.Contains("q=scaun%20tapitat%20catifea%20bordo", chair.RetailerUrl);
        Assert.Equal("furniture", chair.Category);

        var sofa = Assert.Single(RoomObjectExtractor.Extract(Ctx(prompt: "canapea din piele coniac")), i => i.Id.StartsWith("sofa-"));
        var plainSofa = Assert.Single(RoomObjectExtractor.Extract(Ctx()), i => i.Id.StartsWith("sofa-"));
        Assert.Equal("Canapea din piele naturală coniac", sofa.Label);
        Assert.True(sofa.EstimatedPriceRon > plainSofa.EstimatedPriceRon); // leather costs more than linen
    }

    [Fact]
    public void Spatial_layout_is_plausible()
    {
        var items = RoomObjectExtractor.Extract(Ctx());
        Assert.True(items.Single(i => i.Id.StartsWith("pendant-")).YPercent < 30); // ceiling zone
        Assert.True(items.Single(i => i.Id.StartsWith("rug-")).YPercent > 75);    // floor zone
        Assert.InRange(items.Single(i => i.Id.StartsWith("sofa-")).XPercent, 35, 65);
    }

    [Fact]
    public void A_regional_edit_pins_the_edited_object_on_the_painted_area()
    {
        var region = new SelectionRegion(0.2, 0.55, 0.2, 0.3, 0.06);
        var items = RoomObjectExtractor.Extract(Ctx(prompt: "schimbă scaunul în piele coniac", region: region));
        var edited = items[0];
        Assert.True(edited.Edited);
        Assert.Equal("Scaun tapițat din piele naturală coniac", edited.Label);
        Assert.Equal(30, edited.XPercent, 0);
        Assert.Equal(70, edited.YPercent, 0);
        Assert.Single(items, i => i.Edited);
        Assert.DoesNotContain(items.Skip(1), i => i.XPercent is >= 18 and <= 42 && i.YPercent is >= 53 and <= 87);
        foreach (var item in items) AssertValid(item);
    }

    [Fact]
    public void A_colour_only_regional_brief_customises_the_nearest_object()
    {
        var region = new SelectionRegion(0.4, 0.55, 0.2, 0.25, 0.05); // over the sofa
        var edited = RoomObjectExtractor.Extract(Ctx(prompt: "fă-l verde smarald", region: region))[0];
        Assert.True(edited.Edited);
        Assert.Equal("Canapea verde smarald", edited.Label);
    }

    [Fact]
    public void Every_object_named_in_a_rich_brief_gets_its_own_material_colour_and_features()
    {
        var items = RoomObjectExtractor.Extract(Ctx(prompt:
            "Canapea extensibilă gri, masă din lemn masiv de stejar, parchet stratificat, lustră minimalistă, perdele din in și un fotoliu bouclé"));
        string Label(string key) => Assert.Single(items, i => i.Id.StartsWith(key + "-")).Label;
        Assert.Equal("Canapea extensibilă gri", Label("sofa"));
        Assert.Equal("Masă din lemn masiv de stejar", Label("table"));
        Assert.Equal("Parchet stratificat", Label("floor"));
        Assert.Equal("Lustră suspendată minimalistă", Label("pendant"));
        Assert.Equal("Perdele din in", Label("curtains"));
        Assert.Equal("Fotoliu bouclé", Label("armchair"));
        Assert.Contains("q=canapea%20extensibil%20gri", items.Single(i => i.Id.StartsWith("sofa-")).RetailerUrl);
        Assert.Contains("lei/m²", items.Single(i => i.Id.StartsWith("floor-")).MaterialNote);
    }

    [Fact]
    public void Descriptors_attach_to_the_nearest_object_in_a_shared_sentence()
    {
        var items = RoomObjectExtractor.Extract(Ctx(prompt: "canapea gri cu fotoliu bouclé crem"));
        Assert.Equal("Canapea gri", items.Single(i => i.Id.StartsWith("sofa-")).Label);
        Assert.Equal("Fotoliu bouclé crem", items.Single(i => i.Id.StartsWith("armchair-")).Label);

        var english = RoomObjectExtractor.Extract(Ctx(prompt: "a green velvet sofa and an oak dining table"));
        Assert.Equal("Canapea din catifea mată verde", english.Single(i => i.Id.StartsWith("sofa-")).Label);
        Assert.Equal("Masă din stejar", english.Single(i => i.Id.StartsWith("table-")).Label);
    }

    [Theory]
    [InlineData("sofa", 3_200, 7_800)]
    [InlineData("armchair", 950, 2_400)]
    [InlineData("pendant", 350, 1_100)]
    [InlineData("rug", 450, 1_800)]
    public void Prices_stay_inside_realistic_romanian_ranges(string key, int min, int max)
    {
        foreach (var budget in new[] { "economy", "standard", "luxury" })
        foreach (var style in new[] { "scandinavian", "japandi", "traditional", "minimalist_obsidian" })
        foreach (var prompt in new[] { "", "piele și catifea, totul extensibil", "living de lux" })
        {
            var items = RoomObjectExtractor.Extract(new RoomObjectContext("interiors", "living room", style, null, null, prompt, budget));
            var item = Assert.Single(items, i => i.Id.StartsWith(key + "-"));
            Assert.InRange(item.EstimatedPriceRon, min - 10, max + 50);
        }
    }

    [Fact]
    public void Prices_follow_budget_and_object_size()
    {
        RoomObjectContext At(string budget) => new("interiors", "living room", "scandinavian", null, null, "", budget);
        int Price(IReadOnlyList<DetectedItem> items, string key) => items.Single(i => i.Id.StartsWith(key + "-")).EstimatedPriceRon;
        var economy = RoomObjectExtractor.Extract(At("economy"));
        var luxury = RoomObjectExtractor.Extract(At("luxury"));
        Assert.True(Price(luxury, "sofa") > Price(economy, "sofa"));
        Assert.True(Price(economy, "sofa") > Price(economy, "armchair"));
        Assert.True(Price(economy, "armchair") > Price(economy, "pendant"));
        Assert.Equal(economy.Count, economy.Select(i => i.EstimatedPriceRon).Distinct().Count()); // never one flat price

        var small = RoomObjectExtractor.Extract(Ctx("home office") with { AreaSqm = 8 });
        var large = RoomObjectExtractor.Extract(Ctx("home office") with { AreaSqm = 40 });
        Assert.True(Price(large, "floor") > Price(small, "floor") * 3); // flooring is priced per m² of the room
    }

    public static TheoryData<string, string, string> Layouts()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var (mode, space) in new[] { ("interiors", "living room"), ("interiors", "kitchen"), ("interiors", "master bedroom"), ("interiors", "bathroom"),
                     ("interiors", "home office"), ("interiors", "entryway"), ("interiors", "commercial cafe"), ("exteriors", "modern villa exterior"),
                     ("exteriors", "terrace pergola"), ("gardens", "residential garden") })
        {
            data.Add(mode, space, "");
            data.Add(mode, space, "canapea gri, masă de stejar, covor de lână, oglindă, plante și lampadar");
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(Layouts))]
    public void Hotspots_never_cluster_or_hug_the_edges(string mode, string space, string prompt)
    {
        var items = RoomObjectExtractor.Extract(Ctx(space, mode: mode, prompt: prompt));
        foreach (var item in items)
        {
            Assert.InRange(item.XPercent, RoomObjectExtractor.EdgeMinPercent, RoomObjectExtractor.EdgeMaxPercent);
            Assert.InRange(item.YPercent, RoomObjectExtractor.EdgeMinPercent, RoomObjectExtractor.EdgeMaxPercent);
        }
        AssertSpread(items);
    }

    [Fact]
    public void A_regional_edit_pins_the_hotspot_on_the_mask_centroid_and_keeps_others_away()
    {
        var region = new SelectionRegion(0.55, 0.3, 0.3, 0.2, 0.06);
        var items = RoomObjectExtractor.Extract(Ctx(prompt: "fă lampadarul negru mat", region: region));
        var edited = items[0];
        Assert.True(edited.Edited);
        Assert.Equal(70, edited.XPercent, 1);
        Assert.Equal(40, edited.YPercent, 1);
        Assert.StartsWith("Lampadar", edited.Label);
        AssertSpread(items);
    }

    [Fact]
    public void Room_and_style_come_from_the_brief_when_needed()
    {
        var bedroom = RoomObjectExtractor.Extract(Ctx("unknown room", prompt: "dormitor japandi liniștit"));
        Assert.Contains(bedroom, i => i.Id.StartsWith("bed-"));

        var luxury = RoomObjectExtractor.Extract(Ctx(style: "modern", prompt: "living luxos cu accente aurii"));
        Assert.StartsWith("Candelabru", luxury.Single(i => i.Id.StartsWith("pendant-")).Label);
        var plain = RoomObjectExtractor.Extract(Ctx(style: "modern"));
        Assert.True(luxury.Single(i => i.Id.StartsWith("sofa-")).EstimatedPriceRon > plain.Single(i => i.Id.StartsWith("sofa-")).EstimatedPriceRon);

        var japandi = RoomObjectExtractor.Extract(Ctx(style: "japandi"));
        Assert.Contains(japandi, i => i.Id.StartsWith("plant-")); // the style's signature piece
    }

    private static void AssertSpread(IReadOnlyList<DetectedItem> items)
    {
        for (var a = 0; a < items.Count; a++)
            for (var b = a + 1; b < items.Count; b++)
            {
                var d = Math.Sqrt(Math.Pow(items[a].XPercent - items[b].XPercent, 2) + Math.Pow(items[a].YPercent - items[b].YPercent, 2));
                Assert.True(d >= RoomObjectExtractor.MinGapPercent - 0.2, $"{items[a].Id} ↔ {items[b].Id}: {d:0.0} %");
            }
    }

    [Fact]
    public void Search_urls_are_encoded_and_retailer_hosted()
    {
        var url = RoomObjectExtractor.SearchUrl("hornbach", "parchet stejar & co");
        Assert.Equal("https://www.hornbach.ro/s/parchet%20stejar%20%26%20co", url);
    }

    internal static void AssertValid(DetectedItem item)
    {
        Assert.False(string.IsNullOrWhiteSpace(item.Label));
        Assert.False(string.IsNullOrWhiteSpace(item.MaterialNote));
        Assert.Contains(item.Category, new[] { "furniture", "lighting", "surface", "decor", "outdoor" });
        Assert.InRange(item.XPercent, 0, 100);
        Assert.InRange(item.YPercent, 0, 100);
        Assert.InRange(item.RadiusPercent, 1, 25);
        Assert.True(item.EstimatedPriceRon > 0);
        Assert.Contains(RetailerPrefixes, p => item.RetailerUrl.StartsWith(p, StringComparison.Ordinal));
        Assert.True(Uri.TryCreate(item.RetailerUrl, UriKind.Absolute, out var uri) && uri.Scheme == "https");
        Assert.DoesNotContain(' ', item.RetailerUrl);
        Assert.False(string.IsNullOrWhiteSpace(item.RetailerName));
    }
}

/// <summary>/api/generate returns hotspots and supports chained edits: render → paint an object → refine only it.</summary>
public class ChainedEditEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public ChainedEditEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private sealed class QueueProvider(params string[] outputs) : IImageProvider
    {
        private int _next;
        public List<ImageGenerationRequest> Requests { get; } = new();
        public string Id => "replicate";
        public bool IsConfigured => true;
        public PromptFormat PromptFormat => PromptFormat.Clip;
        public PromptFormat PromptFormatFor(bool masked) => masked ? PromptFormat.Instruction : PromptFormat.Clip;
        public Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
        {
            Requests.Add(request);
            return Task.FromResult(new ImageGenerationResult(outputs[Math.Min(_next++, outputs.Length - 1)], false));
        }
    }

    private sealed class Selector(IImageProvider provider) : IImageProviderSelector
    {
        public (IImageProvider Provider, string? Warning) Select() => (provider, null);
    }

    private HttpClient Client(IImageProvider? provider = null)
    {
        var userId = Guid.NewGuid();
        _factory.Subscriptions.SetTier(userId, "pro");
        var client = provider is null
            ? _factory.CreateClient()
            : _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IImageProviderSelector>();
                s.AddSingleton<IImageProviderSelector>(new Selector(provider));
            })).CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return client;
    }

    private static string DataUrl(SkiaSharp.SKBitmap bmp)
    {
        using var data = SkiaSharp.SKImage.FromBitmap(bmp).Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
        return "data:image/png;base64," + Convert.ToBase64String(data.ToArray());
    }

    private static SkiaSharp.SKBitmap Solid(int w, int h, SkiaSharp.SKColor color)
    {
        var bmp = new SkiaSharp.SKBitmap(w, h, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Premul);
        bmp.Erase(color);
        return bmp;
    }

    private static SkiaSharp.SKBitmap MaskRect(int w, int h, SkiaSharp.SKRectI rect)
    {
        var bmp = Solid(w, h, SkiaSharp.SKColors.Transparent);
        using var canvas = new SkiaSharp.SKCanvas(bmp);
        canvas.DrawRect(rect, new SkiaSharp.SKPaint { Color = SkiaSharp.SKColors.White });
        return bmp;
    }

    private static SkiaSharp.SKBitmap Decode(string dataUrl) =>
        SkiaSharp.SKBitmap.Decode(Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]));

    [Fact]
    public async Task Generate_returns_detected_items_in_demo_mode()
    {
        var res = await Client().PostAsJsonAsync("/api/generate", new
        {
            image = DataUrl(Solid(64, 64, SkiaSharp.SKColors.White)), mode = "interiors", spaceType = "living room",
            customPrompt = "living japandi cu canapea din in", preserveStructure = true,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var items = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detectedItems");
        Assert.InRange(items.GetArrayLength(), 4, 7);
        var first = items[0];
        foreach (var name in new[] { "id", "label", "category", "materialNote", "estimatedPriceRon", "retailerName", "retailerUrl", "xPercent", "yPercent", "radiusPercent" })
            Assert.True(first.TryGetProperty(name, out _), name);
    }

    [Fact]
    public async Task A_generated_render_can_be_re_edited_with_a_mask_keeping_the_rest_intact()
    {
        // Step 1: full redesign → a "green room"
        using var green = Solid(128, 96, new SkiaSharp.SKColor(0, 160, 60));
        using var red = Solid(128, 96, new SkiaSharp.SKColor(220, 0, 0));
        var provider = new QueueProvider(DataUrl(green), DataUrl(red));
        var client = Client(provider);
        using var photo = Solid(128, 96, SkiaSharp.SKColors.White);

        var first = await client.PostAsJsonAsync("/api/generate", new
        {
            image = DataUrl(photo), mode = "interiors", spaceType = "living room", customPrompt = "living japandi", preserveStructure = true,
        });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var render = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetString()!;
        Assert.Null(provider.Requests[0].MaskDataUrl);

        // Step 2: the render becomes the working image; paint the "chair" (left foreground) and refine only it
        using var mask = MaskRect(128, 96, new SkiaSharp.SKRectI(16, 56, 48, 88));
        var second = await client.PostAsJsonAsync("/api/generate", new
        {
            image = render, mode = "interiors", spaceType = "living room", customPrompt = "schimbă scaunul în piele coniac",
            preserveStructure = true, mask = DataUrl(mask),
        });
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var body = await second.Content.ReadFromJsonAsync<JsonElement>();

        var sent = provider.Requests[1];
        Assert.Equal(render, sent.ImageDataUrl);         // the generated render, not the original photo
        Assert.NotNull(sent.MaskDataUrl);                // routed through the inpainting path
        Assert.StartsWith("Edit only the selected masked area", sent.Prompt);
        Assert.Equal("left foreground", body.GetProperty("regionalEdit").GetProperty("position").GetString());

        using var result = Decode(body.GetProperty("result").GetString()!);
        var outside = result.GetPixel(110, 10);
        Assert.True(outside.Green > 130 && outside.Red < 40, $"outside {outside}"); // the step-1 room stays
        var inside = result.GetPixel(32, 72);
        Assert.True(inside.Red > 190 && inside.Green < 40, $"inside {inside}");     // only the chair changed

        var edited = body.GetProperty("detectedItems")[0];
        Assert.True(edited.GetProperty("edited").GetBoolean());
        Assert.Equal("Scaun tapițat din piele naturală coniac", edited.GetProperty("label").GetString());
        Assert.InRange(edited.GetProperty("xPercent").GetDouble(), 18, 38);
        Assert.InRange(edited.GetProperty("yPercent").GetDouble(), 58, 92);
    }

    [Fact]
    public async Task Detected_items_endpoint_rebuilds_hotspots_for_old_projects()
    {
        var res = await Client().PostAsJsonAsync("/api/detected-items", new
        {
            mode = "interiors", spaceType = "kitchen", styleId = "industrial", customPrompt = "", dimensions = new { budget = "luxury" },
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var items = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detectedItems");
        Assert.InRange(items.GetArrayLength(), 4, 7);
        Assert.StartsWith("island-", items[0].GetProperty("id").GetString());

        var anonymous = await _factory.CreateClient().PostAsJsonAsync("/api/detected-items", new { mode = "interiors", styleId = "modern" });
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }
}
