using System.Text.Json;
using Sucvar.Domain.Ai;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Portal;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Profile;
using Sucvar.Domain.Studio;

namespace Sucvar.Tests;

/// <summary>French market (Paris &amp; Île-de-France): retailers, TVA 10 % / 20 %, SIREN / SIRET, Parisian presets.</summary>
public class FrenchMarketTests
{
    private static JsonElement J(object value) => JsonSerializer.SerializeToElement(value);

    private static readonly RoomDimensions Dims = DimensionSanitizer.Sanitize(J(new { width = 4, length = 5 }));

    // ── Retailers ────────────────────────────────────────────────────────────

    [Fact]
    public void All_seven_french_retailers_are_registered_with_their_domains()
    {
        var expected = new Dictionary<string, string>
        {
            ["leroymerlin"] = "https://www.leroymerlin.fr/",
            ["castorama"] = "https://www.castorama.fr/",
            ["ikea"] = "https://www.ikea.com/fr/fr/",
            ["manomano"] = "https://www.manomano.fr/",
            ["bricodepot"] = "https://www.bricodepot.fr/",
            ["laplateforme"] = "https://www.laplateforme.com/",
            ["pointp"] = "https://www.pointp.fr/",
        };
        Assert.Equal(expected.Keys.Order(), FrenchRetail.Retailers.Keys.Order());
        foreach (var (id, prefix) in expected)
            Assert.StartsWith(prefix, FrenchRetail.Retailers[id].Build("x"));
        // Every retailer is reachable from at least one lane
        Assert.Equal(expected.Keys.Order(), FrenchRetail.Lanes.Values.SelectMany(v => v).Distinct().Order());
    }

    [Theory]
    [InlineData("placa gips carton 12.5 mm", "construction", "pointp", "plaque%20de%20pl%C3%A2tre%20BA13")]
    [InlineData("polistiren expandat eps 100 10 cm", "construction", "pointp", "isolant%20polystyr%C3%A8ne")]
    [InlineData("parchet stejar", "construction", "pointp", "parquet%20ch%C3%AAne")]
    [InlineData("faianta 30x60", "construction", "pointp", "fa%C3%AFence%20murale%2030x60")]
    [InlineData("vopsea lavabila alba", "construction", "leroymerlin", "peinture%20murale%20blanche")]
    [InlineData("accesorii alama", "construction", "leroymerlin", "poign%C3%A9es%20laiton")]
    [InlineData("canapea 3 locuri", "furniture", "ikea", "canap%C3%A9%203%20places")]
    [InlineData("spot led incastrat 2700k", "lighting", "ikea", "spot%20LED%20encastrable%202700K")]
    [InlineData("rigla lemn tratat autoclavizat", "outdoor", "bricodepot", "lambourde%20bois%20autoclave")]
    [InlineData("set mobilier gradina", "outdoor", "leroymerlin", "salon%20de%20jardin")]
    public void Pro_trade_materials_go_to_trade_counters_and_decor_to_retail(string query, string category, string first, string encodedFrench)
    {
        var links = BomBuilder.BuildRetailerLinks(query, category);
        Assert.Equal(3, links.Count);
        Assert.Equal(first, links[0].Retailer);
        Assert.All(links, l => Assert.Contains(encodedFrench, l.Url));
    }

    [Fact]
    public void Trade_lane_is_point_p_la_plateforme_brico_depot_and_finish_lane_is_retail()
    {
        Assert.Equal(["pointp", "laplateforme", "bricodepot"], BomBuilder.BuildRetailerLinks("sapa autonivelanta", "construction").Select(l => l.Retailer));
        Assert.Equal(["leroymerlin", "castorama", "manomano"], BomBuilder.BuildRetailerLinks("tapet", "construction").Select(l => l.Retailer));
        Assert.Equal(["ikea", "manomano", "castorama"], BomBuilder.BuildRetailerLinks("covor lana", "furniture").Select(l => l.Retailer));
    }

    [Fact]
    public void Unknown_queries_pass_through_and_kelvin_is_preserved()
    {
        Assert.Equal("table basse travertin", FrenchRetail.TranslateQuery("table basse travertin"));
        Assert.Equal("ruban LED 4000K profilé aluminium", FrenchRetail.TranslateQuery("banda led 4000k profil aluminiu"));
        Assert.Equal("parquet chêne huilé", FrenchRetail.TranslateQuery("  Parchet   STEJAR uleiat "));
    }

    [Fact]
    public void Every_bom_line_of_every_space_gets_a_french_query()
    {
        foreach (var (mode, spaces) in new[]
                 {
                     ("interiors", new[] { "living room", "kitchen", "master bedroom", "bathroom", "home office", "entryway", "attic loft", "walk-in closet", "commercial cafe" }),
                 })
        foreach (var space in spaces)
        foreach (var style in new[] { "scandinavian", "modern", "industrial", "traditional", "japandi" })
        {
            var dims = DimensionSanitizer.Sanitize(J(new { width = 4, length = 5, scope = "shell" }), mode, space);
            foreach (var item in BomBuilder.Build(mode, space, style, dims).Items)
                Assert.NotEqual(item.Query, FrenchRetail.TranslateQuery(item.Query));
        }
    }

    // ── TVA 10 % / 20 % ──────────────────────────────────────────────────────

    [Fact]
    public void Default_vat_is_20_and_renovation_rate_10_is_offered()
    {
        Assert.Equal(20, EstimateParser.DefaultVatPct);
        Assert.Equal([20d, 10d], EstimateParser.FrenchVatRates);
        Assert.Equal(20, ProfileDefaults.Initial.VatRate);
        Assert.Equal("EUR", ProfileDefaults.Initial.Currency);
        Assert.Equal("paris", EstimateParser.Parse(J(new { })).Value!.Region);
        Assert.Equal(10, EstimateParser.Parse(J(new { vatPct = 10 })).Value!.VatPct);
    }

    [Theory]
    [InlineData(20, 1000, 200, 1200)]
    [InlineData(10, 1000, 100, 1100)]
    [InlineData(10, 1450, 145, 1595)]
    public void Portal_quote_splits_tva_at_10_or_20_percent(double vatPct, double net, double vat, double total)
    {
        var row = new PublicProjectSource("p1", "Studio", "interiors", "living room", "scandinavian", null, null, null, net, "2026-11-15", null, null);
        var estimate = new PublicEstimateSource("DV-1", 20, "[]", total, VatPct: vatPct, NetSubtotal: net);
        var (_, pricing) = PublicProjection.Pricing(row, "interiors", "living room", estimate);
        Assert.Equal(vatPct, pricing.VatRate);
        Assert.Equal(vat, pricing.VatAmount, 2);
        Assert.Equal(total, pricing.GrandTotal, 2);
    }

    [Fact]
    public void Studio_estimate_without_quote_uses_tva_20()
    {
        var row = new PublicProjectSource("p1", "Studio", "interiors", "living room", "scandinavian", null, null, null, 10_000, "2026-11-15", null, null);
        var (_, pricing) = PublicProjection.Pricing(row, "interiors", "living room", null);
        Assert.Equal(20, pricing.VatRate);
        Assert.Equal(Math.Round(pricing.MaterialsSubtotal + pricing.LaborSubtotal, 2) * 0.2, pricing.VatAmount, 2);
    }

    [Theory]
    [InlineData(10)]
    [InlineData(20)]
    public void Profile_accepts_both_french_vat_rates(double rate)
    {
        var parsed = ProfileUpdateParser.Parse(J(new { defaults = new { currency = "eur", vatRate = rate, marginPercent = 15 } }));
        Assert.True(parsed.Ok);
        Assert.Equal(new ProfileDefaults("EUR", rate, 15), parsed.Value!.Defaults);
    }

    // ── SIREN / SIRET / N° TVA intracommunautaire ────────────────────────────

    [Theory]
    [InlineData("443061841", true)]
    [InlineData("443 061 841", true)]
    [InlineData("44306184100047", true)]
    [InlineData("443061842", false)]
    [InlineData("44306184100048", false)]
    public void Siren_and_siret_are_luhn_checked(string value, bool valid) =>
        Assert.Equal(valid, CompanyProfileParser.IsFrenchRegistration(value));

    [Fact]
    public void Non_french_registry_numbers_are_still_accepted()
    {
        Assert.Null(CompanyProfileParser.IsFrenchRegistration("J40/1234/2020"));
        Assert.True(CompanyProfileParser.Parse(J(new { regNo = "J40/1234/2020" })).Ok);
    }

    [Theory]
    [InlineData("FR64443061841", true)]
    [InlineData("fr 64 443061841", true)]
    [InlineData("FR44732829320", true)]
    [InlineData("FR65443061841", false)]
    [InlineData("FR64443061842", false)]
    public void French_intracom_vat_key_is_checked(string vatId, bool valid)
    {
        var parsed = CompanyProfileParser.Parse(J(new { vatId, regNo = "44306184100047" }));
        Assert.Equal(valid, parsed.Ok);
        if (valid) Assert.Equal(vatId.Replace(" ", "").ToUpperInvariant(), parsed.Value!.VatId);
        else Assert.Equal("INVALID_VAT_ID", parsed.Code);
    }

    [Fact]
    public void Invalid_siret_is_rejected_with_its_own_code() =>
        Assert.Equal("INVALID_SIRET", CompanyProfileParser.Parse(J(new { regNo = "44306184100048" })).Code);

    [Fact]
    public void French_iban_length_is_checked()
    {
        Assert.True(CompanyProfileParser.IsValidIban("FR7630006000011234567890189"));
        Assert.False(CompanyProfileParser.IsValidIban("FR763000600001123456789018"));
    }

    // ── Parisian Studio presets ──────────────────────────────────────────────

    [Theory]
    [InlineData("haussmannien", "traditional", "point de Hongrie")]
    [InlineData("atelier-parisien", "industrial", "verriere")]
    [InlineData("rive-gauche", "contemporary", "Paris limestone")]
    public void Explicit_preset_sets_style_and_enriches_the_prompt(string preset, string style, string cue)
    {
        var plan = GenerationPrompt.Create(J(new { mode = "interiors", preset }));
        var brief = plan.Brief!;
        Assert.Equal(preset, brief.Preset);
        Assert.Equal(style, brief.StyleId);
        Assert.True(brief.StyleInferred);
        Assert.Contains(cue, plan.Prompt);
        Assert.EndsWith(GenerationPrompt.PhotographyDirective("interiors"), plan.Prompt);
        Assert.True(GenerationPrompt.EstimateTokens(plan.Prompt) <= AiLimits.MaxPromptTokens + 2);
    }

    [Fact]
    public void French_free_text_infers_haussmann_preset_room_and_materials()
    {
        var brief = DesignVision.Resolve(J(new
        {
            customPrompt = "Salon haussmannien lumineux avec moulures, parquet point de Hongrie, cheminée en marbre et canapé en velours",
        }), "interiors");
        Assert.Equal("haussmannien", brief.Preset);
        Assert.Equal("traditional", brief.StyleId);
        Assert.Equal("living room", brief.SpaceType);
        var ids = brief.Materials.Select(m => m.Id).ToArray();
        Assert.Contains("point_hongrie", ids);
        Assert.Contains("mouldings", ids);
        Assert.Contains("velvet_sofa", ids);
        Assert.DoesNotContain("herringbone", ids); // one floor only
    }

    [Fact]
    public void Explicit_style_wins_over_preset_base_style()
    {
        var brief = DesignVision.Resolve(J(new { style = "japandi", preset = "rive-gauche" }), "interiors");
        Assert.Equal("japandi", brief.StyleId);
        Assert.False(brief.StyleInferred);
        Assert.Equal("rive-gauche", brief.Preset);
    }

    [Fact]
    public void Atelier_materials_get_french_retailer_links()
    {
        var vision = DesignVision.DetectMaterials("atelier parisien, verrière noire, briques et chêne");
        var bom = BomBuilder.Build("interiors", "living room", "industrial", Dims, vision);
        var verriere = Assert.Single(bom.Items, i => i.Id == "proc-vp-verriere");
        Assert.Equal("leroymerlin", verriere.Links[0].Retailer);
        Assert.Contains("verri%C3%A8re%20atelier", verriere.Links[0].Url);
        var brick = Assert.Single(bom.Items, i => i.Id == "proc-vp-exposed_brick");
        Assert.Equal("pointp", brick.Links[0].Retailer);
    }
}
