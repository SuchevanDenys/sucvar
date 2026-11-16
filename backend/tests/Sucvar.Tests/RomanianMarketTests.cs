using System.Text.Json;
using Sucvar.Domain.Ai;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Portal;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Profile;
using Sucvar.Domain.Studio;

namespace Sucvar.Tests;

/// <summary>
/// Romanian market: Dedeman / Leroy Merlin / Hornbach / Brico Dépôt / IKEA România / Mobexpert, TVA 21 % / 11 %,
/// RON profile defaults, București region. The optional French extras (SIREN / SIRET, Parisian presets) stay covered.
/// </summary>
public class RomanianMarketTests
{
    private static JsonElement J(object value) => JsonSerializer.SerializeToElement(value);

    private static readonly RoomDimensions Dims = DimensionSanitizer.Sanitize(J(new { width = 4, length = 5 }));

    // ── Retailers ────────────────────────────────────────────────────────────

    [Fact]
    public void All_six_romanian_retailers_are_registered_with_their_domains()
    {
        var expected = new Dictionary<string, string>
        {
            ["dedeman"] = "https://www.dedeman.ro/ro/",
            ["leroymerlin"] = "https://www.leroymerlin.ro/",
            ["hornbach"] = "https://www.hornbach.ro/",
            ["bricodepot"] = "https://www.bricodepot.ro/",
            ["ikea"] = "https://www.ikea.com/ro/ro/",
            ["mobexpert"] = "https://mobexpert.ro/",
        };
        Assert.Equal(expected.Keys.Order(), RomanianRetail.Retailers.Keys.Order());
        foreach (var (id, prefix) in expected)
            Assert.StartsWith(prefix, RomanianRetail.Retailers[id].Build("x"));
        // Every retailer is reachable from at least one lane
        Assert.Equal(expected.Keys.Order(), RomanianRetail.Lanes.Values.SelectMany(v => v).Distinct().Order());
    }

    [Theory]
    [InlineData("placa gips carton 12.5 mm", "construction", "dedeman", "placa%20gips%20carton%2012.5%20mm")]
    [InlineData("polistiren expandat eps 100 10 cm", "construction", "dedeman", "polistiren%20expandat")]
    [InlineData("parchet stejar", "construction", "dedeman", "parchet%20stejar")]
    [InlineData("faianta 30x60", "construction", "dedeman", "faianta%2030x60")]
    [InlineData("vopsea lavabila alba", "construction", "dedeman", "vopsea%20lavabila%20alba")]
    [InlineData("canapea 3 locuri", "furniture", "ikea", "canapea%203%20locuri")]
    [InlineData("spot led incastrat 2700k", "lighting", "ikea", "spot%20led%20incastrat%202700k")]
    [InlineData("rigla lemn tratat autoclavizat", "outdoor", "dedeman", "rigla%20lemn")]
    [InlineData("set mobilier gradina", "outdoor", "dedeman", "set%20mobilier%20gradina")]
    public void Romanian_query_is_used_verbatim_in_every_link(string query, string category, string first, string encoded)
    {
        var links = BomBuilder.BuildRetailerLinks(query, category);
        Assert.Equal(3, links.Count);
        Assert.Equal(first, links[0].Retailer);
        Assert.All(links, l => Assert.Contains(encoded, l.Url));
    }

    [Fact]
    public void Lanes_route_trade_finish_furniture_and_lighting()
    {
        Assert.Equal(["dedeman", "hornbach", "bricodepot"], BomBuilder.BuildRetailerLinks("sapa autonivelanta", "construction").Select(l => l.Retailer));
        Assert.Equal(["dedeman", "leroymerlin", "hornbach"], BomBuilder.BuildRetailerLinks("tapet", "construction").Select(l => l.Retailer));
        Assert.Equal(["ikea", "mobexpert", "dedeman"], BomBuilder.BuildRetailerLinks("covor lana", "furniture").Select(l => l.Retailer));
        Assert.Equal(["ikea", "dedeman", "leroymerlin"], BomBuilder.BuildRetailerLinks("lustra suspendata", "lighting").Select(l => l.Retailer));
        Assert.Equal(["dedeman", "bricodepot", "hornbach"], BomBuilder.BuildRetailerLinks("dale beton exterior", "outdoor").Select(l => l.Retailer));
    }

    [Fact]
    public void Diacritics_are_ignored_for_routing_and_kept_in_the_query()
    {
        Assert.True(RomanianRetail.IsTrade("Șapă autonivelantă"));
        var link = BomBuilder.BuildRetailerLinks("  Gresie portelanata  ", "construction")[0];
        Assert.Equal("https://www.dedeman.ro/ro/catalogsearch/result/?q=Gresie%20portelanata", link.Url);
    }

    [Fact]
    public void Every_bom_line_of_every_interior_space_links_only_to_romanian_retailers()
    {
        foreach (var space in new[] { "living room", "kitchen", "master bedroom", "bathroom", "home office", "entryway", "attic loft", "walk-in closet", "commercial cafe" })
        foreach (var style in new[] { "scandinavian", "modern", "industrial", "traditional", "japandi" })
        {
            var dims = DimensionSanitizer.Sanitize(J(new { width = 4, length = 5, scope = "shell" }), "interiors", space);
            foreach (var item in BomBuilder.Build("interiors", space, style, dims).Items)
                Assert.All(item.Links, l => Assert.Matches(@"^https://(www\.)?(dedeman|leroymerlin|hornbach|bricodepot|mobexpert)\.ro/|^https://www\.ikea\.com/ro/ro/", l.Url));
        }
    }

    // ── TVA 21 % / 11 %, RON, București ──────────────────────────────────────

    [Fact]
    public void Default_vat_is_21_reduced_11_region_bucharest_currency_ron()
    {
        Assert.Equal(21, EstimateParser.DefaultVatPct);
        Assert.Equal([21d, 11d], EstimateParser.RomanianVatRates);
        Assert.Equal(21, EstimateDefaults.VatPct);
        Assert.Equal(new ProfileDefaults("RON", 21, 15), ProfileDefaults.Initial);
        Assert.Equal("bucharest", EstimateParser.Parse(J(new { })).Value!.Region);
        Assert.Equal(21, EstimateParser.Parse(J(new { })).Value!.VatPct);
        Assert.Equal(11, EstimateParser.Parse(J(new { vatPct = 11 })).Value!.VatPct);
        Assert.Equal(19, EstimateParser.Parse(J(new { vatPct = 19 })).Value!.VatPct); // custom company rates kept
    }

    [Theory]
    [InlineData(21, 1000, 210, 1210)]
    [InlineData(11, 1000, 110, 1110)]
    [InlineData(19, 1450, 275.5, 1725.5)]
    public void Portal_quote_splits_vat_at_the_quote_rate(double vatPct, double net, double vat, double total)
    {
        var row = new PublicProjectSource("p1", "Studio", "interiors", "living room", "scandinavian", null, null, null, net, "2026-11-15", null, null);
        var estimate = new PublicEstimateSource("DV-1", 20, "[]", total, VatPct: vatPct, NetSubtotal: net);
        var (_, pricing) = PublicProjection.Pricing(row, "interiors", "living room", estimate);
        Assert.Equal(vatPct, pricing.VatRate);
        Assert.Equal(vat, pricing.VatAmount, 2);
        Assert.Equal(total, pricing.GrandTotal, 2);
    }

    [Fact]
    public void Studio_estimate_without_quote_uses_vat_21()
    {
        var row = new PublicProjectSource("p1", "Studio", "interiors", "living room", "scandinavian", null, null, null, 10_000, "2026-11-15", null, null);
        var (_, pricing) = PublicProjection.Pricing(row, "interiors", "living room", null);
        Assert.Equal(21, pricing.VatRate);
        Assert.Equal(Math.Round(pricing.MaterialsSubtotal + pricing.LaborSubtotal, 2) * 0.21, pricing.VatAmount, 2);
    }

    [Theory]
    [InlineData("ron", 21)]
    [InlineData("RON", 11)]
    [InlineData("eur", 19)]
    public void Profile_accepts_romanian_rates_and_both_currencies(string currency, double rate)
    {
        var parsed = ProfileUpdateParser.Parse(J(new { defaults = new { currency, vatRate = rate, marginPercent = 15 } }));
        Assert.True(parsed.Ok);
        Assert.Equal(new ProfileDefaults(currency.ToUpperInvariant(), rate, 15), parsed.Value!.Defaults);
    }

    [Fact]
    public void Profile_defaults_currency_falls_back_to_ron()
    {
        var parsed = ProfileUpdateParser.Parse(J(new { defaults = new { vatRate = 21, marginPercent = 10 } }));
        Assert.Equal("RON", parsed.Value!.Defaults!.Currency);
    }

    [Fact]
    public void Prompt_materials_get_romanian_retailer_links()
    {
        var vision = DesignVision.DetectMaterials("parchet stejar, caramida aparenta si canapea din catifea");
        var bom = BomBuilder.Build("interiors", "living room", "industrial", Dims, vision);
        Assert.All(bom.Items.Where(i => i.FromPrompt == true), i => Assert.Matches(@"(dedeman|ikea|leroymerlin|hornbach|bricodepot|mobexpert)", i.Links[0].Retailer));
        var brick = Assert.Single(bom.Items, i => i.Id == "proc-vp-exposed_brick");
        Assert.Equal("dedeman", brick.Links[0].Retailer);
    }

    // ── Optional French extras (kept) ────────────────────────────────────────

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
    public void Atelier_materials_get_romanian_retailer_links()
    {
        var vision = DesignVision.DetectMaterials("atelier parisien, verrière noire, briques et chêne");
        var bom = BomBuilder.Build("interiors", "living room", "industrial", Dims, vision);
        var verriere = Assert.Single(bom.Items, i => i.Id == "proc-vp-verriere");
        Assert.Equal("dedeman", verriere.Links[0].Retailer);
        Assert.Contains("verriere%20atelier", verriere.Links[0].Url);
        var brick = Assert.Single(bom.Items, i => i.Id == "proc-vp-exposed_brick");
        Assert.Equal(["dedeman", "hornbach", "bricodepot"], brick.Links.Select(l => l.Retailer));
    }

    // ── Legacy saved projects (French-market era) ─────────────────────────────

    [Fact]
    public void Stored_french_retailer_links_are_rebuilt_as_romanian_links_on_read()
    {
        // A project saved before the switch: Romanian query, French URLs in `links`.
        var stored = JsonSerializer.Serialize(new object[]
        {
            new
            {
                id = "proc-floor", cat = "finishes", procCategory = "construction",
                titleRo = "Parchet stejar", titleEn = "Oak parquet", qty = 29.7, unit = "m²", unitPrice = 28,
                query = "parchet stejar uleiat",
                links = new object[]
                {
                    new { retailer = "pointp", label = "Point.P", url = "https://www.pointp.fr/search?text=parquet" },
                    new { retailer = "leroymerlin", label = "Leroy Merlin", url = "https://www.leroymerlin.fr/search?keyword=parquet" },
                },
            },
            new
            {
                id = "proc-kit0", cat = "other", procCategory = "furniture",
                titleRo = "Canapea", titleEn = "Sofa", qty = 1, unit = "buc.", unitPrice = 520,
                query = "canapea 3 locuri",
                links = new object[] { new { retailer = "ikea", label = "IKEA France", url = "https://www.ikea.com/fr/fr/search/?q=canap" } },
            },
        });

        var (items, persisted) = ProcurementStore.Resolve(stored, "interiors", "living room", "scandinavian", null);

        Assert.True(persisted);
        Assert.Equal(2, items.Count);
        var urls = items.SelectMany(i => i.Links).Select(l => l.Url).ToList();
        Assert.All(urls, u => Assert.DoesNotContain(".fr/", u));
        Assert.All(urls, u => Assert.DoesNotContain("ikea.com/fr", u));
        Assert.All(items.SelectMany(i => i.Links), l => Assert.Contains(l.Retailer, RomanianRetail.Retailers.Keys));
        Assert.Equal(RomanianRetail.BuildLinks("parchet stejar uleiat", "construction"), items[0].Links);
        Assert.Equal(["ikea", "mobexpert", "dedeman"], items[1].Links.Select(l => l.Retailer));
    }
}
