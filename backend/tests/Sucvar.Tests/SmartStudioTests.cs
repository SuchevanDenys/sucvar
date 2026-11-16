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
