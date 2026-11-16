using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Studio;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>Flexible Studio contract: free-text vision, optional pills, structure toggle, prompt-aware procurement.</summary>
public class SmartPromptTests
{
    private const string RoVision =
        "Vreau un living minimalist cald, cu parchet de stejar, canapea din in crem, lumină naturală și accente negre mate";

    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    private static string[] Terms(string prompt) => prompt.Split(',').Select(t => t.Trim().ToLowerInvariant()).ToArray();

    [Fact]
    public void Free_text_only_request_is_valid_and_builds_a_smart_prompt()
    {
        var payload = Payload(new { mode = "interiors", customPrompt = RoVision });
        Assert.Null(DesignVision.Validate(payload));

        var plan = GenerationPrompt.Create(payload);
        var brief = Assert.IsType<DesignBrief>(plan.Brief);
        Assert.Equal("minimalist", brief.StyleId);
        Assert.True(brief.StyleInferred);
        Assert.Equal("living room", brief.SpaceType);
        Assert.True(brief.SpaceInferred);
        Assert.True(brief.PreserveStructure);
        Assert.Equal(DesignVision.DefaultAreaSqm, brief.AreaSqm);
        Assert.Equal(["oak_floor", "linen_sofa", "matte_black"], brief.Materials.Select(m => m.Id).ToArray());

        // Romanian text reaches the English-only model as recognised materials + translated descriptors
        Assert.Contains("white oak wood flooring", plan.Prompt);
        Assert.Contains("linen upholstered sofa", plan.Prompt);
        Assert.Contains("warm", Terms(plan.Prompt));
        Assert.DoesNotContain("Vreau", plan.Prompt);
        Assert.Contains(GenerationPrompt.StructurePreserveCue, plan.Prompt);
        Assert.EndsWith(GenerationPrompt.PhotographyDirective("interiors"), plan.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 2);
        Assert.Contains("moved walls", plan.NegativePrompt);
        Assert.True(plan.PromptStrength <= 0.8);
    }

    [Fact]
    public void Combined_prompt_and_optional_filters_merge_without_duplicates_or_conflicts()
    {
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", roomType = "master bedroom", style = "japandi", palette = "earthy", lighting = "golden_hour",
            preserveStructure = false, areaSqm = 14.26,
            customPrompt = "calm bedroom with travertine nightstands and linen curtains",
            dimensions = new { aiStrength = 50 },
        }));
        var brief = plan.Brief!;
        Assert.Equal("japandi", brief.StyleId);
        Assert.False(brief.StyleInferred);
        Assert.Equal("master bedroom", brief.SpaceType);
        Assert.Equal(14.3, brief.AreaSqm);
        Assert.False(brief.PreserveStructure);

        Assert.Contains("travertine stone", plan.Prompt);
        Assert.Contains("calm bedroom with travertine nightstands and linen curtains", plan.Prompt); // English kept verbatim
        Assert.Contains(GenerationPrompt.StructureRedesignCue, plan.Prompt);
        Assert.DoesNotContain(GenerationPrompt.StructurePreserveCue, plan.Prompt);
        Assert.Contains("terracotta", plan.Prompt);
        Assert.Contains("golden hour", plan.Prompt);
        Assert.DoesNotContain("bright natural daylight from windows", plan.Prompt); // explicit lighting replaces the auto cue

        var terms = Terms(plan.Prompt);
        Assert.Equal(terms.Length, terms.Distinct().Count());
        Assert.True(plan.PromptStrength >= 0.8); // full redesign moves away from the photo
        Assert.DoesNotContain("moved walls", plan.NegativePrompt);
    }

    [Fact]
    public void Style_only_request_still_works_with_the_new_contract()
    {
        var payload = Payload(new { mode = "interiors", spaceType = "kitchen", style = "industrial", preserveStructure = true });
        Assert.Null(DesignVision.Validate(payload));
        var plan = GenerationPrompt.Create(payload);
        Assert.Equal("industrial", plan.Brief!.StyleId);
        Assert.Empty(plan.Brief.Materials);
        Assert.StartsWith("furnished kitchen interior", plan.Prompt);
        Assert.Contains("industrial", plan.Prompt);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("   ", "")]
    [InlineData("", "auto")]
    public void Missing_prompt_and_style_is_rejected(string? customPrompt, string? style)
    {
        var error = DesignVision.Validate(Payload(new { mode = "interiors", customPrompt, style }));
        Assert.Equal("PROMPT_OR_STYLE_REQUIRED", error?.Code);
    }

    [Fact]
    public void Prompt_longer_than_1000_chars_is_rejected_and_non_text_is_invalid()
    {
        Assert.Equal("PROMPT_TOO_LONG", DesignVision.Validate(Payload(new { customPrompt = new string('a', 1001) }))?.Code);
        Assert.Null(DesignVision.Validate(Payload(new { customPrompt = new string('a', 1000) })));
        Assert.Equal("INVALID_PROMPT", DesignVision.Validate(Payload(new { customPrompt = 42, styleId = "modern" }))?.Code);
    }

    [Fact]
    public void Legacy_payload_keeps_the_historical_pipeline()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", spaceType = "kitchen", styleId = "modern" }));
        Assert.Null(plan.Brief);
        Assert.StartsWith(Sucvar.Domain.Catalog.SucvarCatalog.GetSpace("interiors", "kitchen").ScenePrompt, plan.Prompt);
        Assert.DoesNotContain(GenerationPrompt.PhotographyDirective("interiors"), plan.Prompt);
    }

    [Fact]
    public void Prompt_weighting_syntax_is_stripped_from_user_text()
    {
        Assert.Equal("oak floor  and sofa", DesignVision.CleanCustomPrompt("(oak floor:1.6) <lora:x> and [sofa]"));
    }

    [Fact]
    public void Material_detection_understands_romanian_and_english()
    {
        Assert.Equal(["herringbone", "led_strip", "plants"],
            DesignVision.DetectMaterials("Parchet în spic de stejar, benzi LED ascunse și multe plante").Select(m => m.Id).ToArray());
        Assert.Equal(["travertine", "matte_black"],
            DesignVision.DetectMaterials("Travertine floor with matte black fixtures").Select(m => m.Id).ToArray());
        Assert.Empty(DesignVision.DetectMaterials("o canapea in living")); // "in" (linen) is not guessed from a preposition
    }
}

public class SmartProcurementTests
{
    private static readonly RoomDimensions Dims = DimensionSanitizer.Sanitize(JsonSerializer.SerializeToElement(new { width = 4, length = 5 }));

    [Fact]
    public void Prompt_materials_replace_generic_items_and_come_first()
    {
        var vision = DesignVision.DetectMaterials("parchet de stejar, canapea din in crem, benzi LED, accente negre mate");
        var bom = BomBuilder.Build("interiors", "living room", "modern", Dims, vision);

        var prompted = bom.Items.TakeWhile(i => i.FromPrompt == true).ToList();
        Assert.Equal(4, prompted.Count);
        Assert.Contains(prompted, i => i.Id == "proc-floor" && i.TitleRo == "Parchet stejar" && i.Query == "parchet stejar");
        Assert.Contains(prompted, i => i.Id == "proc-led" && i.Query == "banda led profil aluminiu");
        Assert.Contains(prompted, i => i.TitleRo == "Canapea tapițată cu in" && i.Links[0].Retailer == "ikea");
        var black = Assert.Single(prompted, i => i.Id == "proc-vp-matte_black");
        Assert.StartsWith("https://www.dedeman.ro/", black.Links[0].Url); // fixtures → finish lane
        Assert.Contains("baterie%20negru%20mat", black.Links[0].Url);
        Assert.True(bom.Items.Count <= 10);
    }

    [Fact]
    public void Wet_rooms_keep_tiles_unless_the_material_is_water_safe()
    {
        var oak = BomBuilder.Build("interiors", "bathroom", "modern", Dims, DesignVision.DetectMaterials("parchet stejar"));
        Assert.DoesNotContain(oak.Items, i => i.FromPrompt == true);

        var travertine = BomBuilder.Build("interiors", "bathroom", "modern", Dims, DesignVision.DetectMaterials("travertin"));
        Assert.Equal("Travertin", travertine.Items.First(i => i.Id == "proc-floor").TitleRo);
    }

    [Fact]
    public void Without_vision_the_list_and_its_json_are_unchanged()
    {
        var legacy = BomBuilder.Build("interiors", "kitchen", "japandi", Dims);
        var empty = BomBuilder.Build("interiors", "kitchen", "japandi", Dims, []);
        JsonAssert.Equal(JsonAssert.ToElement(legacy), JsonAssert.ToElement(empty));
        Assert.False(JsonAssert.ToElement(legacy).GetProperty("items")[0].TryGetProperty("fromPrompt", out _));
    }
}

public class SmartStudioEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public SmartStudioEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private static string PngDataUrl()
    {
        using var bmp = new SkiaSharp.SKBitmap(64, 64);
        bmp.Erase(SkiaSharp.SKColors.White);
        using var data = SkiaSharp.SKImage.FromBitmap(bmp).Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
        return "data:image/png;base64," + Convert.ToBase64String(data.ToArray());
    }

    private HttpClient Client(string tier = "pro")
    {
        var userId = Guid.NewGuid();
        _factory.Subscriptions.SetTier(userId, tier);
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return client;
    }

    [Fact]
    public async Task Generate_accepts_free_text_only_and_echoes_the_resolved_vision()
    {
        var res = await Client().PostAsJsonAsync("/api/generate", new
        {
            image = PngDataUrl(), mode = "interiors",
            customPrompt = "Bucătărie japandi cu blat din cuarț și lumină caldă", preserveStructure = true,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var vision = body.GetProperty("vision");
        Assert.Equal("japandi", vision.GetProperty("styleId").GetString());
        Assert.Equal("kitchen", vision.GetProperty("spaceType").GetString());
        Assert.True(vision.GetProperty("preserveStructure").GetBoolean());
        Assert.Equal("quartz_top", vision.GetProperty("materials")[0].GetProperty("id").GetString());
        Assert.Contains("quartz countertop", body.GetProperty("promptUsed").GetString());
    }

    [Fact]
    public async Task Generate_without_prompt_or_style_is_a_400()
    {
        var res = await Client().PostAsJsonAsync("/api/generate", new { image = PngDataUrl(), mode = "interiors", customPrompt = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("PROMPT_OR_STYLE_REQUIRED", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var tooLong = await Client().PostAsJsonAsync("/api/generate", new { image = PngDataUrl(), styleId = "modern", customPrompt = new string('x', 1001) });
        Assert.Equal("PROMPT_TOO_LONG", (await tooLong.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Analyze_materials_uses_the_custom_prompt_and_infers_the_style()
    {
        var res = await Client().PostAsJsonAsync("/api/analyze-materials", new
        {
            mode = "interiors", spaceType = "living room", areaSqm = 30,
            customPrompt = "Living scandinav cu parchet de stejar și canapea din in",
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("scandinavian", body.GetProperty("vision").GetProperty("styleId").GetString());
        var first = body.GetProperty("bom").GetProperty("items")[0];
        Assert.True(first.GetProperty("fromPrompt").GetBoolean());

        var neither = await Client().PostAsJsonAsync("/api/analyze-materials", new { mode = "interiors", spaceType = "kitchen" });
        Assert.Equal("INVALID_STYLE", (await neither.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }
}
