using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sucvar.Application;
using Sucvar.Domain.Ai;
using Sucvar.Infrastructure.Ai;
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
        Assert.Contains("natural matte white oak plank flooring", plan.Prompt);
        Assert.Contains("cream natural linen upholstered sofa", plan.Prompt);
        Assert.Contains("matte black fixtures and accents", plan.Prompt);
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
    public async Task Generate_reports_the_compiled_prompt_negative_and_calibrated_parameters()
    {
        var res = await Client().PostAsJsonAsync("/api/generate", new
        {
            image = PngDataUrl(), mode = "interiors", style = "industrial",
            customPrompt = "Pardoseală: parchet stejar, pereți alb cald", preserveStructure = true,
            dimensions = new { length = 4.0, width = 3.0, height = 2.55, aiStrength = 72 },
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("deterministic", body.GetProperty("promptEngine").GetString());
        Assert.DoesNotContain("microcement", body.GetProperty("promptUsed").GetString());
        Assert.Contains("floating furniture", body.GetProperty("negativePromptUsed").GetString());
        Assert.Equal(0.72, body.GetProperty("parameters").GetProperty("promptStrength").GetDouble(), 3);
        var vision = body.GetProperty("vision");
        Assert.Equal(12, vision.GetProperty("dimensions").GetProperty("areaSqm").GetDouble());
        Assert.Equal("walls", vision.GetProperty("userSpecs")[1].GetProperty("slot").GetString());
    }

    [Fact]
    public async Task Prompt_preview_compiles_without_an_image_or_quota()
    {
        var res = await Client("starter").PostAsJsonAsync("/api/prompt-preview", new
        {
            mode = "interiors", customPrompt = "canapea bordo, lumină caldă", areaSqm = 12,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("deep bordeaux upholstered sofa", body.GetProperty("prompt").GetString());
        Assert.False(body.GetProperty("enhancerAvailable").GetBoolean());
        Assert.True(body.GetProperty("estimatedTokens").GetInt32() <= body.GetProperty("maxTokens").GetInt32() + 2);

        var invalid = await Client().PostAsJsonAsync("/api/prompt-preview", new { mode = "interiors" });
        Assert.Equal("PROMPT_OR_STYLE_REQUIRED", (await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var anonymous = await _factory.CreateClient().PostAsJsonAsync("/api/prompt-preview", new { customPrompt = "living" });
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
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

/// <summary>Architectural Prompt Compiler: RO→EN, user-intent priority, conflict resolution, scale and calibration.</summary>
public class ArchitecturalPromptCompilerTests
{
    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    private static string[] Terms(string prompt) => prompt.Split(',').Select(t => t.Trim()).ToArray();

    [Fact]
    public void Casual_romanian_is_compiled_into_precise_english_element_specs()
    {
        var specs = ArchitecturalPromptCompiler.CompileUserSpecs("vreau parchet stejar natur, pereti alb cald, canapea bordo, lumina calda");
        Assert.Equal(
            [
                ("floor", "natural matte white oak plank flooring"),
                ("walls", "warm alabaster white matte walls"),
                ("sofa", "deep bordeaux upholstered sofa"),
                ("lighting", "warm 3000K indirect lighting"),
            ],
            specs.Select(s => (s.Slot, s.PromptEn)).ToArray());
    }

    [Theory]
    [InlineData("pereți: verde salvie mat", "walls", "sage green matte walls")]
    [InlineData("Pardoseală: parchet în spic din stejar deschis", "floor", "light matte white oak herringbone parquet flooring")]
    [InlineData("canapea din catifea verde smarald", "sofa", "emerald green velvet upholstered sofa")]
    [InlineData("blat din marmură albă", "countertop", "soft white polished marble countertop")]
    [InlineData("draperii din in bej", "curtains", "warm beige natural linen curtains")]
    [InlineData("lumină naturală", "lighting", "abundant natural daylight")]
    [InlineData("mobilier minimalist", "furniture", "minimalist furniture")]
    [InlineData("gresie gri antracit", "floor", "anthracite grey large-format porcelain tile flooring")]
    public void Element_clauses_translate_with_diacritics_and_inflections(string ro, string slot, string en)
    {
        var spec = Assert.Single(ArchitecturalPromptCompiler.CompileUserSpecs(ro));
        Assert.Equal(slot, spec.Slot);
        Assert.Equal(en, spec.PromptEn);
    }

    [Fact]
    public void Bare_elements_and_mood_words_produce_no_spec()
    {
        Assert.Empty(ArchitecturalPromptCompiler.CompileUserSpecs("o canapea în living"));
        Assert.Empty(ArchitecturalPromptCompiler.CompileUserSpecs("living minimalist cald"));
    }

    [Fact]
    public void Explicit_user_instructions_lead_the_prompt_and_romanian_never_reaches_the_model()
    {
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", style = "industrial",
            customPrompt = "vreau parchet stejar natur, pereti alb cald, canapea bordo, lumina calda",
        }));
        Assert.StartsWith("furnished living room interior, natural matte white oak plank flooring, warm alabaster white matte walls, " +
                          "deep bordeaux upholstered sofa, warm 3000K indirect lighting", plan.Prompt);
        var words = plan.Prompt.ToLowerInvariant().Split([' ', ','], StringSplitOptions.RemoveEmptyEntries);
        foreach (var ro in new[] { "parchet", "pereti", "canapea", "lumina", "vreau", "bordo", "cald" }) Assert.DoesNotContain(ro, words);
        Assert.EndsWith(GenerationPrompt.PhotographyDirective("interiors"), plan.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 2);
    }

    [Fact]
    public void User_floor_choice_strips_the_style_presets_conflicting_floor()
    {
        var styleOnly = GenerationPrompt.Create(Payload(new { mode = "interiors", style = "industrial", preserveStructure = true }));
        Assert.Contains("microcement", styleOnly.Prompt); // Industrial's default concrete floor

        var withOak = GenerationPrompt.Create(Payload(new { mode = "interiors", style = "industrial", customPrompt = "Pardoseală: parchet stejar" }));
        Assert.Contains("white oak plank flooring", withOak.Prompt);
        Assert.DoesNotContain("microcement", withOak.Prompt);
        Assert.Contains("exposed brick walls", withOak.Prompt); // walls were not mentioned → the style keeps them
        Assert.Contains("industrial loft", withOak.Prompt);     // the style itself stays

        var withWalls = GenerationPrompt.Create(Payload(new { mode = "interiors", style = "industrial", customPrompt = "parchet stejar, pereți albi" }));
        Assert.DoesNotContain("brick", withWalls.Prompt);
        Assert.Contains("soft white matte walls", withWalls.Prompt);
    }

    [Fact]
    public void English_text_is_kept_verbatim_but_still_owns_its_elements()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", style = "industrial", customPrompt = "warm oak floor and white plaster walls" }));
        Assert.Contains("warm oak floor and white plaster walls", plan.Prompt);
        Assert.DoesNotContain("microcement", plan.Prompt);
        Assert.DoesNotContain("brick", plan.Prompt);
    }

    [Fact]
    public void Explicit_lighting_replaces_style_and_automatic_lighting()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", style = "modern", customPrompt = "living cu lumină caldă" }));
        Assert.Contains("warm 3000K indirect lighting", plan.Prompt);
        Assert.DoesNotContain("bright natural daylight from windows", plan.Prompt);
        Assert.DoesNotContain("recessed linear LED", plan.Prompt);
    }

    [Theory]
    [InlineData("polished microcement floor", "floor")]
    [InlineData("microcement surfaces", "walls")]
    [InlineData("exposed brick walls", "walls")]
    [InlineData("warm cognac leather", "sofa")]
    [InlineData("3000K track lighting", "lighting")]
    [InlineData("soft diffused light", "lighting")]
    public void Style_terms_are_classified_by_element(string term, string slot) =>
        Assert.Contains(slot, ArchitecturalPromptCompiler.TermSlots(term));

    [Theory]
    [InlineData("light natural oak wood")]
    [InlineData("black steel")]
    [InlineData("industrial loft")]
    public void Slot_neutral_terms_are_never_stripped(string term) =>
        Assert.Empty(ArchitecturalPromptCompiler.TermSlots(term));

    [Fact]
    public void Real_dimensions_drive_scale_cues_and_are_echoed()
    {
        Prompt(4.0, 3.0, 2.55, out var compact, out var compactPlan);
        Assert.Contains("small apartment room", compact);
        Assert.DoesNotContain("spacious", compact);
        Assert.Equal(12, compactPlan.Brief!.AreaSqm);

        Prompt(6.4, 5.0, 2.80, out var spacious, out _);
        Assert.Contains("spacious room", spacious);

        Prompt(5.0, 4.0, 3.2, out var high, out _);
        Assert.Contains("high ceiling", high);

        Prompt(5.0, 4.0, 2.3, out var low, out _);
        Assert.Contains("low ceiling", low);

        // No size given → no invented scale cue
        var unknown = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living japandi" }));
        Assert.False(unknown.Brief!.Scale!.AreaKnown);
        Assert.Equal("", ArchitecturalPromptCompiler.ScaleHint(unknown.Brief.Scale, "interiors"));

        var json = JsonSerializer.SerializeToElement(DesignVision.ToResponse(compactPlan.Brief));
        Assert.Equal(12, json.GetProperty("dimensions").GetProperty("areaSqm").GetDouble());
        Assert.Equal(30.6, json.GetProperty("dimensions").GetProperty("volumeM3").GetDouble());

        static void Prompt(double length, double width, double height, out string prompt, out GenerationPlan plan)
        {
            plan = GenerationPrompt.Create(JsonSerializer.SerializeToElement(new
            {
                mode = "interiors", customPrompt = "living scandinav", dimensions = new { length, width, height },
            }));
            prompt = plan.Prompt;
        }
    }

    [Theory]
    [InlineData(null, true, 0.72)]
    [InlineData(95, true, 0.8)]
    [InlineData(40, true, 0.62)]
    [InlineData(70, true, 0.7)]
    [InlineData(50, false, 0.8)]
    [InlineData(100, false, 0.9)]
    public void Strength_is_calibrated_to_the_structure_mode(int? aiStrength, bool preserve, double expected)
    {
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", customPrompt = "living modern", preserveStructure = preserve,
            dimensions = aiStrength is null ? (object)new { } : new { aiStrength },
        }));
        Assert.Equal(expected, plan.PromptStrength, 3);
        Assert.Equal(Math.Round(expected * 100), plan.TransformationStrength);
        if (preserve) Assert.InRange(plan.PromptStrength, ArchitecturalPromptCompiler.PreserveStrengthMin, ArchitecturalPromptCompiler.PreserveStrengthMax);
    }

    [Fact]
    public void Smart_defaults_apply_only_when_the_client_sends_no_ai_settings()
    {
        var defaults = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living modern" }));
        Assert.Equal(ArchitecturalPromptCompiler.SmartGuidanceDefault, defaults.GuidanceScale);
        Assert.Equal(ArchitecturalPromptCompiler.SmartInferenceStepsDefault, defaults.InferenceSteps);

        var custom = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living modern", ai = new { guidanceScale = 6, inferenceSteps = 25 } }));
        Assert.Equal(6, custom.GuidanceScale);
        Assert.Equal(25, custom.InferenceSteps);
    }

    [Fact]
    public void Negative_prompt_targets_ai_artifacts_and_keeps_custom_terms_first()
    {
        var stock = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living", ai = new { negativePrompt = AiLimits.DefaultNegativePrompt } }));
        foreach (var t in new[] { "crooked perspective", "missing windows", "floating furniture", "CGI render", "plastic textures", "messy clutter", "moved walls" })
            Assert.Contains(t, Terms(stock.NegativePrompt));
        Assert.True(GenerationPrompt.EstimateTokens(stock.NegativePrompt) <= AiLimits.MaxPromptTokens);

        var custom = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living", ai = new { negativePrompt = "red carpet" } }));
        Assert.StartsWith("red carpet, deformed walls", custom.NegativePrompt);
        Assert.Equal(Terms(custom.NegativePrompt).Length, Terms(custom.NegativePrompt).Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void Llm_refinement_cannot_override_locked_user_specs()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", style = "industrial", customPrompt = "parchet stejar, canapea bordo" }));
        Assert.Equal("deterministic", plan.Engine);

        var enhanced = GenerationPrompt.ApplyEnhancement(plan,
            "polished concrete floor, (cognac leather sofa:1.4), blackened steel shelving, warm Edison pendant glow, \"jute rug\"\nlinen cushions.");
        Assert.Equal("llm", enhanced.Engine);
        Assert.StartsWith("furnished living room interior, natural matte white oak plank flooring, deep bordeaux upholstered sofa, keep existing walls", enhanced.Prompt);
        Assert.DoesNotContain("concrete floor", enhanced.Prompt);
        Assert.DoesNotContain("cognac", enhanced.Prompt);
        Assert.DoesNotContain(":1.4", enhanced.Prompt);
        Assert.Contains("blackened steel shelving", enhanced.Prompt);
        Assert.Contains("jute rug", enhanced.Prompt);
        Assert.EndsWith(GenerationPrompt.PhotographyDirective("interiors"), enhanced.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(enhanced.Prompt) <= AiLimits.MaxPromptTokens + 2);

        Assert.Same(plan, GenerationPrompt.ApplyEnhancement(plan, "  "));
        Assert.Same(plan, GenerationPrompt.ApplyEnhancement(plan, null));
    }

    [Fact]
    public void Legacy_plans_cannot_be_enhanced()
    {
        var legacy = GenerationPrompt.Create(Payload(new { mode = "interiors", spaceType = "kitchen", styleId = "modern" }));
        Assert.Null(legacy.Parts);
        Assert.Same(legacy, GenerationPrompt.ApplyEnhancement(legacy, "walnut cabinetry, brass pendant lights"));
    }
}

/// <summary>Natural-language instruction for FLUX Kontext: no CLIP clipping, user specs first, explicit structure lock.</summary>
public class InstructionPromptTests
{
    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    [Fact]
    public void Smart_brief_compiles_into_a_rich_english_instruction_without_clip_clipping()
    {
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", style = "industrial", palette = "earthy", preserveStructure = true,
            customPrompt = "vreau parchet stejar natur, pereti alb cald, canapea bordo, lumina calda, benzi LED și multe plante",
            dimensions = new { length = 4.0, width = 3.0, height = 2.55 },
        }));
        var instruction = plan.Instruction;

        Assert.StartsWith("Redesign this living room photo into a photorealistic fully furnished living room interior in an ", instruction);
        Assert.Contains("Preserve the exact room geometry: keep the same walls, ceiling, windows, doors", instruction);
        Assert.Contains("same camera position, angle and perspective", instruction);
        Assert.Contains("Client requirements, highest priority, follow them exactly: natural matte white oak plank flooring; " +
                        "warm alabaster white matte walls; deep bordeaux upholstered sofa; warm 3000K indirect lighting.", instruction);
        Assert.Contains("Color palette:", instruction);
        Assert.Contains("Room size: about 12 m², 2.55 m ceiling height; scale everything accordingly (small apartment room", instruction);
        Assert.EndsWith(ArchitecturalPromptCompiler.PhotographyInstruction("interiors") + ".", instruction);

        // User requirements come before every other descriptive layer
        var requirements = instruction.IndexOf("Client requirements", StringComparison.Ordinal);
        Assert.True(requirements < instruction.IndexOf("Style details", StringComparison.Ordinal));
        Assert.True(requirements < instruction.IndexOf("Color palette", StringComparison.Ordinal));

        // The style's own concrete floor / brick walls never contradict the client
        Assert.DoesNotContain("microcement", instruction);
        Assert.DoesNotContain("brick", instruction);
        var words = instruction.ToLowerInvariant().Split([' ', ',', '.', ';', ':'], StringSplitOptions.RemoveEmptyEntries);
        foreach (var ro in new[] { "parchet", "pereti", "canapea", "lumina", "vreau", "bordo", "cald" }) Assert.DoesNotContain(ro, words);

        // Far beyond the 72-token CLIP budget, while the CLIP prompt stays clipped
        Assert.True(GenerationPrompt.EstimateTokens(instruction) > AiLimits.MaxPromptTokens * 2);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 2);
    }

    [Fact]
    public void Full_redesign_asks_for_a_renovation_and_keeps_only_the_camera()
    {
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", roomType = "master bedroom", style = "japandi", lighting = "golden_hour", preserveStructure = false,
            customPrompt = "calm bedroom with travertine nightstands and linen curtains",
        }));
        Assert.Contains("Perform a full architectural renovation", plan.Instruction);
        Assert.Contains("keeping the same camera viewpoint", plan.Instruction);
        Assert.DoesNotContain("Preserve the exact room geometry", plan.Instruction);
        Assert.Contains("Client brief: calm bedroom with travertine nightstands and linen curtains.", plan.Instruction); // English verbatim
        Assert.Contains("Lighting: warm golden hour sunlight", plan.Instruction);
    }

    [Fact]
    public void Exterior_instruction_protects_the_architecture_and_uses_invariant_decimals()
    {
        var previous = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("ro-RO");
        try
        {
            var plan = GenerationPrompt.Create(Payload(new { mode = "gardens", customPrompt = "grădină cu plante", areaSqm = 85.5 }));
            Assert.StartsWith("Redesign this residential garden photo into a photorealistic landscaped residential garden", plan.Instruction);
            Assert.Contains("Preserve the exact architecture and site", plan.Instruction);
            Assert.Contains("about 85.5 m²", plan.Instruction);
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public void Plan_for_instruction_models_swaps_the_prompt_and_drops_the_negative()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living modern", seed = 7 }));
        Assert.Same(plan, plan.For(PromptFormat.Clip));

        var kontext = plan.For(PromptFormat.Instruction);
        Assert.Equal(PromptFormat.Instruction, kontext.Format);
        Assert.Equal(plan.Instruction, kontext.Prompt);
        Assert.Equal("", kontext.NegativePrompt);
        Assert.Equal(plan.Brief, kontext.Brief);
    }

    [Fact]
    public void Legacy_requests_get_an_instruction_while_the_golden_prompt_is_untouched()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", spaceType = "kitchen", styleId = "modern" }));
        Assert.Null(plan.Brief);
        Assert.StartsWith("Redesign this kitchen photo into a photorealistic fully furnished kitchen interior.", plan.Instruction);
        Assert.Contains("Preserve the exact room geometry", plan.Instruction);
        Assert.Contains("Target design:", plan.Instruction);
        Assert.Equal(PromptFormat.Clip, plan.Format);
    }
}

/// <summary>Replicate routing: official models (FLUX Kontext) vs. the versioned community model.</summary>
public class ReplicateProviderTests
{
    private const string Image = "data:image/jpeg;base64,/9j/AAAA";

    private static ImageGenerationRequest Request(long? seed = null) =>
        new(Image, "Redesign this living room photo.", "lowres", 40, 9, seed, 0.72, 72, "interiors");

    private static ReplicateImageProvider Provider(AiOptions options, HttpMessageHandler? handler = null) =>
        new(new StubHttpFactory(handler ?? new StubHandler()), Options.Create(options), NullLogger<ReplicateImageProvider>.Instance);

    [Fact]
    public void Flux_kontext_is_the_default_official_model_with_its_own_schema()
    {
        var provider = Provider(new AiOptions { ReplicateApiToken = "r8_test" });
        Assert.Equal(PromptFormat.Instruction, ((IImageProvider)provider).PromptFormat);

        var (url, body) = provider.BuildCreateRequest(Request(seed: 42));
        Assert.Equal("v1/models/black-forest-labs/flux-kontext-pro/predictions", url);
        Assert.Null(body["version"]);
        var input = body["input"]!.AsObject();
        Assert.Equal(Image, input["input_image"]!.GetValue<string>());
        Assert.Equal("Redesign this living room photo.", input["prompt"]!.GetValue<string>());
        Assert.Equal("match_input_image", input["aspect_ratio"]!.GetValue<string>());
        Assert.Equal("jpg", input["output_format"]!.GetValue<string>());
        Assert.Equal(42, input["seed"]!.GetValue<long>());
        foreach (var sd in new[] { "image", "negative_prompt", "prompt_strength", "guidance_scale", "num_inference_steps" })
            Assert.False(input.ContainsKey(sd), sd);

        var (_, noSeed) = provider.BuildCreateRequest(Request());
        Assert.False(noSeed["input"]!.AsObject().ContainsKey("seed"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData(null)]
    public void Empty_model_falls_back_to_the_versioned_interior_design_path(string? model)
    {
        var provider = Provider(new AiOptions { ReplicateApiToken = "r8_test", ReplicateModel = model, ReplicateModelVersion = "abc123" });
        Assert.Equal(PromptFormat.Clip, ((IImageProvider)provider).PromptFormat);

        var (url, body) = provider.BuildCreateRequest(Request(seed: 5));
        Assert.Equal("v1/predictions", url);
        Assert.Equal("abc123", body["version"]!.GetValue<string>());
        var input = body["input"]!.AsObject();
        Assert.Equal(Image, input["image"]!.GetValue<string>());
        Assert.Equal("lowres", input["negative_prompt"]!.GetValue<string>());
        Assert.Equal(0.72, input["prompt_strength"]!.GetValue<double>());
        Assert.Equal(9, input["guidance_scale"]!.GetValue<double>());
        Assert.Equal(40, input["num_inference_steps"]!.GetValue<int>());
        Assert.Equal(5, input["seed"]!.GetValue<long>());
    }

    [Theory]
    [InlineData("../v1/account")]
    [InlineData("black-forest-labs/flux-kontext-pro/../../x")]
    [InlineData("flux-kontext-pro")]
    public void Malformed_model_names_never_reach_the_url(string model) =>
        Assert.Throws<InvalidOperationException>(() =>
            Provider(new AiOptions { ReplicateApiToken = "r8_test", ReplicateModel = model }).BuildCreateRequest(Request()));

    [Fact]
    public async Task Generate_posts_to_the_official_endpoint_then_polls_until_the_image_is_ready()
    {
        var handler = new StubHandler();
        var provider = Provider(new AiOptions { ReplicateApiToken = "r8_test" }, handler);

        var result = await provider.GenerateAsync(Request());

        Assert.Equal("https://replicate.delivery/out.jpg", result.ImageUrl);
        Assert.False(result.IsDemo);
        var create = handler.Requests[0];
        Assert.Equal(HttpMethod.Post, create.Method);
        Assert.Equal("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions", create.Url);
        Assert.Equal("Bearer r8_test", create.Authorization);
        Assert.StartsWith("wait=", create.Prefer);
        Assert.Equal("match_input_image", JsonNode.Parse(create.Body!)!["input"]!["aspect_ratio"]!.GetValue<string>());
        Assert.Equal(HttpMethod.Get, handler.Requests[1].Method);
        Assert.Equal("https://api.replicate.com/v1/predictions/p1", handler.Requests[1].Url);
    }

    private sealed class StubHttpFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false) { BaseAddress = new Uri("https://api.replicate.com/") };
    }

    private sealed record Seen(HttpMethod Method, string Url, string? Authorization, string? Prefer, string? Body);

    /// <summary>First call: prediction still processing; every poll: succeeded with one image URL.</summary>
    private sealed class StubHandler : HttpMessageHandler
    {
        public List<Seen> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(new Seen(request.Method, request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(),
                request.Headers.TryGetValues("Prefer", out var p) ? p.First() : null,
                request.Content is null ? null : await request.Content.ReadAsStringAsync(ct)));
            var json = request.Method == HttpMethod.Post
                ? """{"id":"p1","status":"processing","urls":{"get":"https://api.replicate.com/v1/predictions/p1","cancel":"https://api.replicate.com/v1/predictions/p1/cancel"}}"""
                : """{"id":"p1","status":"succeeded","output":"https://replicate.delivery/out.jpg"}""";
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
        }
    }
}

/// <summary>/api/prompt-preview and /api/generate report what an instruction model actually reads.</summary>
public class InstructionEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public InstructionEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private sealed class KontextLikeProvider : IImageProvider
    {
        public ImageGenerationRequest? Last { get; private set; }
        public string Id => "replicate";
        public bool IsConfigured => true;
        public PromptFormat PromptFormat => PromptFormat.Instruction;
        public Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
        {
            Last = request;
            return Task.FromResult(new ImageGenerationResult("data:image/jpeg;base64,/9j/AAAA", false));
        }
    }

    private sealed class Selector(IImageProvider provider) : IImageProviderSelector
    {
        public (IImageProvider Provider, string? Warning) Select() => (provider, null);
    }

    private HttpClient Client(IImageProvider provider)
    {
        var userId = Guid.NewGuid();
        _factory.Subscriptions.SetTier(userId, "pro");
        var client = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IImageProviderSelector>();
            s.AddSingleton<IImageProviderSelector>(new Selector(provider));
        })).CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return client;
    }

    [Fact]
    public async Task Active_model_endpoint_reports_the_prompt_format_anonymously()
    {
        var demo = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/ai/model");
        Assert.Equal("demo", demo.GetProperty("provider").GetString());
        Assert.Equal("clip", demo.GetProperty("promptFormat").GetString());

        var kontext = Client(new KontextLikeProvider());
        kontext.DefaultRequestHeaders.Authorization = null;
        var body = await kontext.GetFromJsonAsync<JsonElement>("/api/ai/model");
        Assert.Equal("instruction", body.GetProperty("promptFormat").GetString());
        Assert.Equal("replicate", body.GetProperty("model").GetString()); // stub provider: ModelId defaults to Id
    }

    [Fact]
    public void Replicate_reports_its_model_id()
    {
        IImageProvider kontext = new ReplicateImageProvider(new NoHttp(), Options.Create(new AiOptions()), NullLogger<ReplicateImageProvider>.Instance);
        Assert.Equal("black-forest-labs/flux-kontext-pro", kontext.ModelId);
        IImageProvider legacy = new ReplicateImageProvider(new NoHttp(), Options.Create(new AiOptions { ReplicateModel = "" }), NullLogger<ReplicateImageProvider>.Instance);
        Assert.Equal("adirik/interior-design", legacy.ModelId);
    }

    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Prompt_preview_shows_the_instruction_without_a_token_budget()
    {
        var res = await Client(new KontextLikeProvider()).PostAsJsonAsync("/api/prompt-preview", new
        {
            mode = "interiors", customPrompt = "canapea bordo, lumină caldă", areaSqm = 12,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("instruction", body.GetProperty("promptFormat").GetString());
        Assert.StartsWith("Redesign this living room photo", body.GetProperty("prompt").GetString());
        Assert.Contains("deep bordeaux upholstered sofa", body.GetProperty("prompt").GetString());
        Assert.Equal("", body.GetProperty("negativePrompt").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("maxTokens").ValueKind);
    }

    [Fact]
    public async Task Generate_sends_the_instruction_to_an_instruction_model_and_echoes_it()
    {
        var provider = new KontextLikeProvider();
        using var bmp = new SkiaSharp.SKBitmap(64, 64);
        bmp.Erase(SkiaSharp.SKColors.White);
        using var png = SkiaSharp.SKImage.FromBitmap(bmp).Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
        var res = await Client(provider).PostAsJsonAsync("/api/generate", new
        {
            image = "data:image/png;base64," + Convert.ToBase64String(png.ToArray()), mode = "interiors",
            customPrompt = "Bucătărie japandi cu blat din cuarț", preserveStructure = true, ai = new { seed = 11 },
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("instruction", body.GetProperty("promptFormat").GetString());
        Assert.NotNull(provider.Last);
        Assert.Equal(body.GetProperty("promptUsed").GetString(), provider.Last!.Prompt);
        Assert.Contains("Preserve the exact room geometry", provider.Last.Prompt);
        Assert.Contains("quartz countertop", provider.Last.Prompt);
        Assert.Equal(11, provider.Last.Seed);
    }
}

/// <summary>"Edit selected area": regional prompt compilation, inpaint routing, mask validation and pixel preservation.</summary>
public class RegionalEditTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public RegionalEditTests(SucvarApiFactory factory) => _factory = factory;

    private static JsonElement Payload(object value) => JsonSerializer.SerializeToElement(value);

    // ── Helpers ────────────────────────────────────────────────────────────────

    private static string DataUrl(SkiaSharp.SKBitmap bmp, SkiaSharp.SKEncodedImageFormat format = SkiaSharp.SKEncodedImageFormat.Png)
    {
        using var data = SkiaSharp.SKImage.FromBitmap(bmp).Encode(format, 100);
        var mime = format == SkiaSharp.SKEncodedImageFormat.Jpeg ? "jpeg" : "png";
        return $"data:image/{mime};base64,{Convert.ToBase64String(data.ToArray())}";
    }

    private static SkiaSharp.SKBitmap Solid(int w, int h, SkiaSharp.SKColor color)
    {
        var bmp = new SkiaSharp.SKBitmap(w, h, SkiaSharp.SKColorType.Rgba8888, SkiaSharp.SKAlphaType.Premul);
        bmp.Erase(color);
        return bmp;
    }

    /// <summary>A textured "photo": every pixel differs, so any unintended change is detectable.</summary>
    private static SkiaSharp.SKBitmap Pattern(int w, int h)
    {
        var px = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            var p = (y * w + x) * 4;
            px[p] = (byte)(x * 7 + y * 3); px[p + 1] = (byte)(x * 2 + y * 11); px[p + 2] = (byte)(x ^ y); px[p + 3] = 255;
        }
        return MaskCompositor.FromPixels(px, w, h);
    }

    /// <summary>Transparent canvas with an opaque white rectangle (what the browser exports, before binarization).</summary>
    private static SkiaSharp.SKBitmap MaskRect(int w, int h, SkiaSharp.SKRectI rect, bool transparentBackground = true)
    {
        var bmp = Solid(w, h, transparentBackground ? SkiaSharp.SKColors.Transparent : SkiaSharp.SKColors.Black);
        using var canvas = new SkiaSharp.SKCanvas(bmp);
        canvas.DrawRect(rect, new SkiaSharp.SKPaint { Color = SkiaSharp.SKColors.White });
        return bmp;
    }

    // ── Prompt compilation ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(0.35, 0.6, 0.3, 0.3, "center foreground")]
    [InlineData(0.0, 0.7, 1.0, 0.3, "lower floor area")]
    [InlineData(0.05, 0.0, 0.9, 0.2, "upper ceiling area")]
    [InlineData(0.05, 0.35, 0.2, 0.3, "left side")]
    [InlineData(0.7, 0.05, 0.2, 0.2, "upper right")]
    [InlineData(0.0, 0.0, 0.95, 0.95, "most of the frame")]
    public void Selection_bounds_read_as_a_spatial_position(double x, double y, double w, double h, string expected) =>
        Assert.Equal(expected, SelectionRegion.Describe(x, y, w, h));

    [Fact]
    public void A_selection_compiles_a_regional_instruction_instead_of_a_room_redesign()
    {
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", spaceType = "living room", customPrompt = "canapea bordo din catifea", preserveStructure = true,
            selectionBounds = new { x = 0.3, y = 0.55, width = 0.4, height = 0.35 },
        }));

        var region = Assert.IsType<SelectionRegion>(plan.Region);
        Assert.Equal("center foreground", region.Position);
        Assert.StartsWith("Edit only the selected masked area of this living room photo, in the center foreground (about 14% of the frame).", plan.Instruction);
        Assert.Contains("deep bordeaux", plan.Instruction);
        Assert.Contains("highest priority", plan.Instruction);
        Assert.Contains("same light direction, shadows", plan.Instruction);
        Assert.Contains("Leave everything outside the selection untouched", plan.Instruction);
        Assert.DoesNotContain("Redesign this", plan.Instruction);
        Assert.DoesNotContain("Preserve the exact room geometry", plan.Instruction);

        // CLIP twin for SD inpainting: client words first, no room-wide scene / structure / layout tags
        Assert.StartsWith("deep bordeaux", plan.Prompt);
        Assert.Contains("seamless blend", plan.Prompt);
        Assert.DoesNotContain(GenerationPrompt.StructurePreserveCue, plan.Prompt);
        Assert.DoesNotContain("furnished living room interior", plan.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 2);

        Assert.Equal(ArchitecturalPromptCompiler.InpaintStrength, plan.PromptStrength);
        Assert.Null(plan.Parts); // the LLM refinement (room-wide tags) is never applied to a regional edit
        Assert.Equal(plan.Instruction, plan.For(PromptFormat.Instruction).Prompt);
    }

    [Fact]
    public void Measured_region_wins_and_a_style_only_selection_restyles_the_element()
    {
        var measured = new SelectionRegion(0, 0.75, 1, 0.25, 0.25);
        var plan = GenerationPrompt.Create(Payload(new
        {
            mode = "interiors", spaceType = "kitchen", styleId = "japandi",
            selectionBounds = new { x = 0.1, y = 0.1, width = 0.1, height = 0.1 }, // ignored: the mask's own pixels decide
        }), measured);
        Assert.Same(measured, plan.Region);
        Assert.Contains("lower floor area (about 25% of the frame)", plan.Instruction);
        Assert.Contains("restyle the existing element in a Japandi style", plan.Instruction);
    }

    [Fact]
    public void Without_a_selection_the_full_room_plan_is_unchanged()
    {
        var payload = Payload(new { mode = "interiors", customPrompt = "canapea bordo", selectionBounds = new { x = 0.5, y = 0.5, width = 0, height = 0.2 } });
        var plan = GenerationPrompt.Create(payload);
        Assert.Null(plan.Region); // zero-width bounds are not a selection
        Assert.StartsWith("Redesign this living room photo", plan.Instruction);
    }

    // ── Routing ────────────────────────────────────────────────────────────────

    private static ReplicateImageProvider Replicate(AiOptions options) =>
        new(new ThrowingHttp(), Options.Create(options), NullLogger<ReplicateImageProvider>.Instance);

    private sealed class ThrowingHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new NotSupportedException();
    }

    private static ImageGenerationRequest Masked(string? mask, long? seed = 7) =>
        new("data:image/jpeg;base64,/9j/AAAA", "Edit only the selected masked area.", "", 40, 9, seed, 0.95, 95, "interiors", true, mask);

    [Fact]
    public void Masked_requests_route_to_flux_fill_pro_with_image_and_mask()
    {
        var provider = Replicate(new AiOptions { ReplicateApiToken = "r8_test" });
        IImageProvider p = provider;
        Assert.Equal(PromptFormat.Instruction, p.PromptFormatFor(masked: true));
        Assert.Equal("black-forest-labs/flux-fill-pro", p.ModelIdFor(masked: true));

        var (url, body) = provider.BuildCreateRequest(Masked("data:image/png;base64,iVBOR"));
        Assert.Equal("v1/models/black-forest-labs/flux-fill-pro/predictions", url);
        var input = body["input"]!.AsObject();
        Assert.Equal("data:image/jpeg;base64,/9j/AAAA", input["image"]!.GetValue<string>());
        Assert.Equal("data:image/png;base64,iVBOR", input["mask"]!.GetValue<string>());
        Assert.Equal("Edit only the selected masked area.", input["prompt"]!.GetValue<string>());
        Assert.Equal("jpg", input["output_format"]!.GetValue<string>());
        Assert.Equal(7, input["seed"]!.GetValue<long>());
        Assert.False(input.ContainsKey("input_image"));
        Assert.False(input.ContainsKey("aspect_ratio"));

        // No mask → the regular Kontext request
        var (fullUrl, _) = provider.BuildCreateRequest(Masked(null));
        Assert.Equal("v1/models/black-forest-labs/flux-kontext-pro/predictions", fullUrl);
    }

    [Fact]
    public void Inpaint_model_is_configurable_and_empty_falls_back_to_the_main_model()
    {
        var legacy = Replicate(new AiOptions { ReplicateApiToken = "r8_test", ReplicateModel = "" }); // CLIP full-room model
        Assert.Equal(PromptFormat.Clip, ((IImageProvider)legacy).PromptFormat);
        Assert.Equal(PromptFormat.Instruction, ((IImageProvider)legacy).PromptFormatFor(masked: true)); // flux-fill reads prose

        var fallback = Replicate(new AiOptions { ReplicateApiToken = "r8_test", ReplicateInpaintModel = " " });
        var (url, body) = fallback.BuildCreateRequest(Masked("data:image/png;base64,iVBOR"));
        Assert.Equal("v1/models/black-forest-labs/flux-kontext-pro/predictions", url); // composite keeps it regional
        Assert.False(body["input"]!.AsObject().ContainsKey("mask"));

        Assert.Throws<InvalidOperationException>(() =>
            Replicate(new AiOptions { ReplicateApiToken = "r8_test", ReplicateInpaintModel = "../v1/account" })
                .BuildCreateRequest(Masked("data:image/png;base64,iVBOR")));
    }

    // ── Pixel preservation ─────────────────────────────────────────────────────

    [Fact]
    public void Feathered_composite_never_changes_an_unselected_pixel()
    {
        const int w = 120, h = 90;
        using var source = Pattern(w, h);
        using var generated = Solid(w, h, new SkiaSharp.SKColor(200, 20, 40));
        using var maskBmp = MaskRect(w, h, new SkiaSharp.SKRectI(30, 20, 90, 70), transparentBackground: false);
        var mask = MaskCompositor.Binarize(maskBmp);
        var radius = MaskCompositor.FeatherRadius(w, h);
        Assert.InRange(radius, MaskCompositor.MinFeather, MaskCompositor.MaxFeather);
        var alpha = MaskCompositor.FeatherAlpha(mask, w, h, radius);
        using var result = MaskCompositor.Composite(source, generated, alpha);

        var src = MaskCompositor.Pixels(source);
        var gen = MaskCompositor.Pixels(generated);
        var outPx = MaskCompositor.Pixels(result);
        var changedOutside = 0;
        for (var i = 0; i < mask.Length; i++)
        {
            if (mask[i] != 0) continue;
            Assert.Equal(0f, alpha[i]);
            for (var c = 0; c < 4; c++) if (outPx[i * 4 + c] != src[i * 4 + c]) changedOutside++;
        }
        Assert.Equal(0, changedOutside);

        // Centre of the selection = the generated pixels; the seam ramps up from ≈0 at the border
        var centre = (45 * w + 60) * 4;
        Assert.Equal(gen[centre..(centre + 3)], outPx[centre..(centre + 3)]);
        Assert.True(alpha[45 * w + 30] < 0.1f, $"border alpha {alpha[45 * w + 30]}");
        Assert.True(alpha[45 * w + 33] < alpha[45 * w + 36] && alpha[45 * w + 36] < alpha[45 * w + 42]);
        Assert.Equal(1f, alpha[45 * w + 60], 3);
    }

    [Fact]
    public void A_selection_touching_the_frame_edge_is_not_eroded_there()
    {
        const int w = 100, h = 80;
        using var maskBmp = MaskRect(w, h, new SkiaSharp.SKRectI(0, 50, 100, 80), transparentBackground: false); // floor strip
        var alpha = MaskCompositor.FeatherAlpha(MaskCompositor.Binarize(maskBmp), w, h, 8);
        Assert.Equal(1f, alpha[79 * w + 0], 3);   // bottom-left corner pixel fully edited
        Assert.Equal(1f, alpha[79 * w + 99], 3);
        Assert.Equal(0f, alpha[49 * w + 50]);      // just above the selection: untouched
    }

    [Fact]
    public void Composite_through_the_processor_keeps_the_original_outside_the_mask()
    {
        using var source = Solid(64, 64, SkiaSharp.SKColors.White);
        using var generated = Solid(48, 48, new SkiaSharp.SKColor(10, 10, 200)); // provider output at a different size
        using var mask = MaskRect(64, 64, new SkiaSharp.SKRectI(16, 16, 48, 48));
        var jpeg = SkiaImageProcessor.CompositeJpegDataUrl(
            Convert.FromBase64String(DataUrl(source).Split(',')[1]),
            Convert.FromBase64String(DataUrl(generated).Split(',')[1]),
            Convert.FromBase64String(DataUrl(mask).Split(',')[1]));
        using var decoded = SkiaSharp.SKBitmap.Decode(Convert.FromBase64String(jpeg.Split(',')[1]));
        Assert.Equal(64, decoded.Width);
        var corner = decoded.GetPixel(2, 2);
        Assert.True(corner.Red > 245 && corner.Blue > 245, $"corner {corner}");
        var centre = decoded.GetPixel(32, 32);
        Assert.True(centre.Blue > 180 && centre.Red < 40, $"centre {centre}");
    }

    // ── Mask validation ────────────────────────────────────────────────────────

    private static readonly SkiaImageProcessor Processor = new(new ThrowingHttp());

    [Fact]
    public void Masks_are_resized_to_the_source_pixels_and_binarized()
    {
        using var source = Solid(200, 150, SkiaSharp.SKColors.Gray);
        using var half = MaskRect(100, 75, new SkiaSharp.SKRectI(25, 40, 75, 75)); // painted at half resolution
        var prepared = Processor.PrepareMask(DataUrl(half), DataUrl(source, SkiaSharp.SKEncodedImageFormat.Jpeg));

        Assert.Equal((200, 150), (prepared.Width, prepared.Height));
        Assert.StartsWith("data:image/png;base64,", prepared.DataUrl);
        using var mask = SkiaSharp.SKBitmap.Decode(Convert.FromBase64String(prepared.DataUrl.Split(',')[1]));
        Assert.Equal((200, 150), (mask.Width, mask.Height));
        Assert.All(MaskCompositor.Pixels(mask).Where((_, i) => i % 4 != 3), b => Assert.True(b is 0 or 255));
        Assert.Equal(0.25, prepared.Region.X, 2);
        Assert.Equal(0.5, prepared.Region.Width, 2);
        Assert.Equal("center foreground", prepared.Region.Position);
    }

    [Fact]
    public void Masks_with_other_proportions_empty_selections_and_non_png_data_are_rejected()
    {
        var source = DataUrl(Solid(200, 150, SkiaSharp.SKColors.Gray));
        using var square = MaskRect(100, 100, new SkiaSharp.SKRectI(10, 10, 60, 60));
        Assert.Equal("MASK_DIMENSIONS", Assert.Throws<MaskRejectedException>(() => Processor.PrepareMask(DataUrl(square), source)).Code);

        using var empty = Solid(200, 150, SkiaSharp.SKColors.Transparent);
        Assert.Equal("MASK_EMPTY", Assert.Throws<MaskRejectedException>(() => Processor.PrepareMask(DataUrl(empty), source)).Code);

        using var jpeg = MaskRect(200, 150, new SkiaSharp.SKRectI(10, 10, 60, 60), transparentBackground: false);
        Assert.Throws<InvalidDataException>(() => Processor.PrepareMask(DataUrl(jpeg, SkiaSharp.SKEncodedImageFormat.Jpeg), source));
    }

    // ── /api/generate ──────────────────────────────────────────────────────────

    private sealed class FillLikeProvider(string output) : IImageProvider
    {
        public ImageGenerationRequest? Last { get; private set; }
        public string Id => "replicate";
        public bool IsConfigured => true;
        public PromptFormat PromptFormat => PromptFormat.Clip;
        public PromptFormat PromptFormatFor(bool masked) => masked ? PromptFormat.Instruction : PromptFormat.Clip;
        public Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
        {
            Last = request;
            return Task.FromResult(new ImageGenerationResult(output, false));
        }
    }

    private sealed class Selector(IImageProvider provider) : IImageProviderSelector
    {
        public (IImageProvider Provider, string? Warning) Select() => (provider, null);
    }

    private HttpClient Client(IImageProvider provider)
    {
        var userId = Guid.NewGuid();
        _factory.Subscriptions.SetTier(userId, "pro");
        var client = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IImageProviderSelector>();
            s.AddSingleton<IImageProviderSelector>(new Selector(provider));
        })).CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return client;
    }

    [Fact]
    public async Task Generate_with_a_mask_inpaints_the_region_and_composites_over_the_original()
    {
        using var red = Solid(128, 96, new SkiaSharp.SKColor(220, 0, 0));
        var provider = new FillLikeProvider(DataUrl(red));
        using var photo = Solid(128, 96, SkiaSharp.SKColors.White);
        using var mask = MaskRect(64, 48, new SkiaSharp.SKRectI(16, 24, 48, 48)); // half-res browser mask, lower centre

        var res = await Client(provider).PostAsJsonAsync("/api/generate", new
        {
            image = DataUrl(photo), mode = "interiors", spaceType = "living room", customPrompt = "canapea bordo din catifea",
            preserveStructure = true, mask = DataUrl(mask), selectionBounds = new { x = 0.25, y = 0.5, width = 0.5, height = 0.5 },
            ai = new { seed = 3 },
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        var sent = provider.Last!;
        Assert.NotNull(sent.MaskDataUrl);
        using (var sentMask = SkiaSharp.SKBitmap.Decode(Convert.FromBase64String(sent.MaskDataUrl!.Split(',')[1])))
            Assert.Equal((128, 96), (sentMask.Width, sentMask.Height)); // aligned to the photo
        Assert.StartsWith("Edit only the selected masked area", sent.Prompt);
        Assert.Equal("instruction", body.GetProperty("promptFormat").GetString());
        Assert.Equal("center foreground", body.GetProperty("regionalEdit").GetProperty("position").GetString());
        Assert.Equal(0.25, body.GetProperty("regionalEdit").GetProperty("coverage").GetDouble(), 2);

        using var result = SkiaSharp.SKBitmap.Decode(Convert.FromBase64String(body.GetProperty("result").GetString()!.Split(',')[1]));
        var outside = result.GetPixel(5, 5);
        Assert.True(outside.Green > 245 && outside.Blue > 245, $"outside {outside}"); // still the white photo
        var inside = result.GetPixel(64, 80);
        Assert.True(inside.Red > 190 && inside.Green < 40, $"inside {inside}");
    }

    [Theory]
    [InlineData("empty", 422, "MASK_EMPTY")]
    [InlineData("jpeg", 415, "MASK_FORMAT")]
    [InlineData("number", 400, "MASK_INVALID")]
    public async Task Invalid_masks_are_rejected_before_the_paid_call(string kind, int status, string code)
    {
        var provider = new FillLikeProvider("data:image/jpeg;base64,/9j/AAAA");
        using var photo = Solid(128, 96, SkiaSharp.SKColors.White);
        using var empty = Solid(128, 96, SkiaSharp.SKColors.Transparent);
        object mask = kind switch
        {
            "empty" => DataUrl(empty),
            "jpeg" => DataUrl(photo, SkiaSharp.SKEncodedImageFormat.Jpeg),
            _ => 42,
        };
        var res = await Client(provider).PostAsJsonAsync("/api/generate", new
        {
            image = DataUrl(photo), mode = "interiors", customPrompt = "canapea bordo", mask,
        });
        Assert.Equal(status, (int)res.StatusCode);
        Assert.Equal(code, (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Null(provider.Last);
    }

    [Fact]
    public async Task Prompt_preview_shows_the_regional_instruction_for_selection_bounds()
    {
        var res = await Client(new FillLikeProvider("")).PostAsJsonAsync("/api/prompt-preview", new
        {
            mode = "interiors", customPrompt = "canapea bordo", selectionBounds = new { x = 0.3, y = 0.6, width = 0.4, height = 0.3 },
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("instruction", body.GetProperty("promptFormat").GetString());
        Assert.StartsWith("Edit only the selected masked area", body.GetProperty("prompt").GetString());
        Assert.Equal("center foreground", body.GetProperty("regionalEdit").GetProperty("position").GetString());
        Assert.False(body.GetProperty("enhancerAvailable").GetBoolean());
    }
}
