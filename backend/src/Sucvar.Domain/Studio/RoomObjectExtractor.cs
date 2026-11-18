using System.Text.Json;
using System.Text.RegularExpressions;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Catalog;
using Sucvar.Domain.Procurement;

namespace Sucvar.Domain.Studio;

/// <summary>
/// One "Shop the look" hotspot on a generated render: what the object is, an indicative RON price and a Romanian
/// retailer search link. Coordinates are percentages of the image (<c>0..100</c>, origin top-left); the radius is a
/// percentage of the image width used for hover hit-testing.
/// </summary>
public sealed record DetectedItem(
    string Id,
    string Label,
    string Category,
    string MaterialNote,
    int EstimatedPriceRon,
    string RetailerName,
    string RetailerUrl,
    double XPercent,
    double YPercent,
    double RadiusPercent,
    bool Edited = false);

/// <summary>Inputs of <see cref="RoomObjectExtractor.Extract"/> (everything already validated / resolved).</summary>
/// <param name="Mode">Space mode (<c>interiors</c> / <c>exteriors</c> / <c>gardens</c>).</param>
/// <param name="SpaceType">Catalog space id (<c>kitchen</c>, <c>living room</c>…).</param>
/// <param name="StyleId">Resolved style id, <c>null</c> = none.</param>
/// <param name="Palette">Palette pill id, <c>null</c> = none.</param>
/// <param name="Lighting">Lighting pill id, <c>null</c> = none.</param>
/// <param name="CustomPrompt">The client's free-text vision.</param>
/// <param name="Budget">Budget tier (<c>economy</c> / <c>standard</c> / <c>luxury</c>).</param>
/// <param name="Region">Selection of an "Edit selected area" request, <c>null</c> = whole room.</param>
/// <param name="AreaSqm">Known floor area (m²) — sizes the flooring / wall quantities; <c>null</c> = typical room.</param>
public sealed record RoomObjectContext(
    string Mode,
    string SpaceType,
    string? StyleId,
    string? Palette,
    string? Lighting,
    string CustomPrompt,
    string Budget = "standard",
    SelectionRegion? Region = null,
    double? AreaSqm = null);

/// <summary>
/// Prompt-aware, fully deterministic "object inspector" metadata for a render. It needs no vision model:
/// <list type="bullet">
/// <item>the room type (catalog space, or the room the brief names: „dormitor”, „baie”, „terasă”…) gives a realistic,
/// spatially distributed layout (sofa centre-foreground, pendant in the upper zone, floor in the lower band…);</item>
/// <item>the style (plus „lux”, „mediteranean”, „clasic” in the brief) gives the materials, signature pieces and the
/// price tier;</item>
/// <item>the Romanian / English brief is parsed phrase by phrase: every object it names („canapea extensibilă gri”,
/// „masă din lemn masiv de stejar”, „perdele din in”, „fotoliu bouclé”) gets its own colour, material and features,
/// even when several objects share one sentence;</item>
/// <item>prices come from calibrated Romanian-market ranges per object (RON, 2026), positioned inside the range by
/// budget, style, material and features; surfaces are priced per m² × the room's area;</item>
/// <item>hotspots are kept ≥ <see cref="MinGapPercent"/> % apart inside <see cref="EdgeMinPercent"/>–
/// <see cref="EdgeMaxPercent"/> %, and a regional (masked) edit pins the edited object on the mask's centroid.</item>
/// </list>
///
/// <para>Every link is a search URL built by <see cref="RomanianRetail.Retailers"/> (IKEA România, Mobexpert,
/// Dedeman, Leroy Merlin, Hornbach), so it always opens a real result page — never a dead product URL.</para>
/// </summary>
public static class RoomObjectExtractor
{
    public const int MinItems = 4;
    public const int MaxItems = 7;

    /// <summary>Minimum Euclidean distance between two hotspots, in % of the image.</summary>
    public const double MinGapPercent = 18;

    /// <summary>Hotspots (except the edited one, which sits exactly on the painted area) stay inside this band.</summary>
    public const double EdgeMinPercent = 14;
    public const double EdgeMaxPercent = 86;

    /// <summary>Retailer ids an inspector link may point to (all present in <see cref="RomanianRetail.Retailers"/>).</summary>
    public static readonly string[] AllowedRetailers = ["ikea", "mobexpert", "dedeman", "leroymerlin", "hornbach"];

    // ── Grammar (Romanian agreement for colours / features) ─────────────────────

    /// <summary>Grammatical gender of a noun: masculine / neuter singular, feminine singular, plural.</summary>
    private enum G { M, F, P }

    /// <summary>Adjective → (masculine, feminine, plural). Words not listed are invariant („gri”, „bej”, „bordo”).</summary>
    private static readonly Dictionary<string, string[]> Inflections = new()
    {
        ["alb"] = ["alb", "albă", "albe"], ["negru"] = ["negru", "neagră", "negre"], ["albastru"] = ["albastru", "albastră", "albastre"],
        ["roșu"] = ["roșu", "roșie", "roșii"], ["galben"] = ["galben", "galbenă", "galbene"], ["mat"] = ["mat", "mată", "mate"],
        ["cald"] = ["cald", "caldă", "calde"], ["închis"] = ["închis", "închisă", "închise"], ["deschis"] = ["deschis", "deschisă", "deschise"],
        ["auriu"] = ["auriu", "aurie", "aurii"], ["argintiu"] = ["argintiu", "argintie", "argintii"], ["nisipiu"] = ["nisipiu", "nisipie", "nisipii"],
        ["cenușiu"] = ["cenușiu", "cenușie", "cenușii"], ["extensibil"] = ["extensibil", "extensibilă", "extensibile"],
        ["modular"] = ["modular", "modulară", "modulare"], ["minimalist"] = ["minimalist", "minimalistă", "minimaliste"],
        ["rotund"] = ["rotund", "rotundă", "rotunde"], ["oval"] = ["oval", "ovală", "ovale"], ["încastrat"] = ["încastrat", "încastrată", "încastrate"],
        ["dimabil"] = ["dimabil", "dimabilă", "dimabile"], ["pliabil"] = ["pliabil", "pliabilă", "pliabile"], ["suspendat"] = ["suspendat", "suspendată", "suspendate"],
        ["tapițat"] = ["tapițat", "tapițată", "tapițate"], ["periat"] = ["periat", "periată", "periate"], ["albit"] = ["albit", "albită", "albite"],
    };

    private static string Inflect(string phrase, G g) => string.Join(' ', phrase.Split(' ').Select(w =>
        Inflections.TryGetValue(w, out var forms) ? forms[(int)g] :
        Inflections.FirstOrDefault(kv => kv.Value.Contains(w)).Value is { } f ? f[(int)g] : w));

    // ── Templates ─────────────────────────────────────────────────────────────

    /// <param name="Key">Stable item key.</param>
    /// <param name="Noun">Romanian noun shown as the label.</param>
    /// <param name="Gender">Grammatical gender used to inflect adjectives.</param>
    /// <param name="Query">Diacritic-free retailer search words.</param>
    /// <param name="Category">Display category.</param>
    /// <param name="X">Hotspot X (% of the frame).</param>
    /// <param name="Y">Hotspot Y (% of the frame).</param>
    /// <param name="R">Hotspot radius (% of the frame).</param>
    /// <param name="Slot">Which style material describes it: fabric · wood · metal · floor · stone · wall · plant.</param>
    /// <param name="Lane">Retailer lane: furniture · lighting · surface · decor · outdoor.</param>
    /// <param name="Min">Romanian-market price floor in RON (per m² when <paramref name="Sqm"/> ≠ 0).</param>
    /// <param name="Max">Romanian-market price ceiling in RON (per m² when <paramref name="Sqm"/> ≠ 0).</param>
    /// <param name="Size">Typical dimensions shown in the note („220×95 cm · 3 locuri”).</param>
    /// <param name="Sqm">Priced per m²: &gt; 0 = fixed quantity, −1 = floor area, −2 = wall area, 0 = per piece.</param>
    private sealed record Template(string Key, string Noun, G Gender, string Query, string Category, string Slot, string Lane,
        int Min, int Max, double X, double Y, double R, string Size, double Sqm = 0);

    private static Template T(string key, string noun, G g, string query, string category, string slot, string lane,
        int min, int max, double x, double y, double r, string size, double sqm = 0) =>
        new(key, noun, g, query, category, slot, lane, min, max, x, y, r, size, sqm);

    /// <summary>Every object the brief can name, with its default placement and RON price range (2026, RO retail).</summary>
    private static readonly Dictionary<string, Template> Objects = new[]
    {
        T("sofa", "Canapea", G.F, "canapea", "furniture", "fabric", "furniture", 3_200, 7_800, 50, 66, 14, "220×95 cm · 3 locuri"),
        T("armchair", "Fotoliu", G.M, "fotoliu", "furniture", "fabric", "furniture", 950, 2_400, 21, 64, 9, "80×85 cm"),
        T("chair", "Scaun tapițat", G.M, "scaun tapitat", "furniture", "fabric", "furniture", 350, 1_200, 34, 72, 7, "48×56 cm · h 82 cm"),
        T("stool", "Scaun de bar", G.M, "scaun bar", "furniture", "wood", "furniture", 280, 950, 36, 72, 7, "h șezut 65 cm"),
        T("coffee_table", "Măsuță de cafea", G.F, "masuta cafea", "furniture", "wood", "furniture", 450, 1_900, 48, 80, 8, "110×60 cm"),
        T("table", "Masă", G.F, "masa dining", "furniture", "wood", "furniture", 1_400, 5_200, 52, 70, 11, "160×90 cm · 6 locuri"),
        T("bed", "Pat dublu", G.M, "pat dublu", "furniture", "fabric", "furniture", 2_400, 7_500, 50, 66, 16, "160×200 cm"),
        T("nightstand", "Noptieră", G.F, "noptiera", "furniture", "wood", "furniture", 300, 1_200, 18, 66, 7, "45×40 cm"),
        T("wardrobe", "Dulap", G.M, "dulap", "furniture", "wood", "furniture", 1_900, 7_500, 84, 42, 12, "200×60×236 cm"),
        T("desk", "Birou", G.M, "birou", "furniture", "wood", "furniture", 800, 3_200, 50, 63, 12, "140×70 cm"),
        T("office_chair", "Scaun de birou", G.M, "scaun birou", "furniture", "fabric", "furniture", 650, 2_600, 40, 74, 8, "ergonomic · reglabil"),
        T("shelf", "Bibliotecă", G.F, "biblioteca", "furniture", "wood", "furniture", 450, 2_400, 82, 38, 10, "80×200 cm"),
        T("island", "Insulă de bucătărie", G.F, "insula bucatarie", "furniture", "stone", "furniture", 4_500, 14_000, 50, 66, 14, "240×100 cm"),
        T("cabinets", "Mobilier de bucătărie", G.M, "mobilier bucatarie", "furniture", "wood", "furniture", 9_000, 32_000, 76, 44, 13, "≈ 3,6 ml corpuri"),
        T("vanity", "Mobilier baie cu lavoar", G.M, "mobilier baie lavoar", "furniture", "wood", "furniture", 1_200, 4_800, 40, 64, 10, "80 cm · suspendat"),
        T("console", "Consolă", G.F, "consola", "furniture", "wood", "furniture", 500, 2_200, 50, 58, 10, "120×35 cm"),
        T("bench", "Bancă", G.F, "banca", "furniture", "wood", "furniture", 400, 1_600, 30, 74, 9, "120×40 cm"),
        T("pendant", "Lustră suspendată", G.F, "lustra suspendata", "lighting", "metal", "lighting", 350, 1_100, 50, 13, 7, "Ø 45 cm"),
        T("floor_lamp", "Lampadar", G.M, "lampadar", "lighting", "metal", "lighting", 300, 1_400, 81, 46, 7, "h 160 cm"),
        T("lamp", "Veioză", G.F, "veioza", "lighting", "metal", "lighting", 150, 650, 18, 48, 6, "h 45 cm"),
        T("sconce", "Aplică de perete", G.F, "aplica perete", "lighting", "metal", "lighting", 160, 750, 58, 26, 5, "LED integrat"),
        T("rug", "Covor", G.M, "covor", "decor", "fabric", "decor", 450, 1_800, 40, 90, 10, "200×300 cm"),
        T("curtains", "Draperii", G.P, "draperii", "decor", "fabric", "decor", 300, 1_400, 9, 32, 9, "2 panouri · 140×260 cm"),
        T("mirror", "Oglindă", G.F, "oglinda", "decor", "metal", "decor", 250, 1_500, 40, 32, 8, "60×180 cm"),
        T("plant", "Plantă decorativă", G.F, "planta decorativa", "decor", "plant", "decor", 120, 650, 88, 62, 7, "h 120 cm · ghiveci ceramic"),
        T("floor", "Pardoseală", G.F, "parchet", "surface", "floor", "surface", 55, 260, 50, 93, 9, "", -1),
        T("backsplash", "Faianță", G.F, "faianta", "surface", "stone", "surface", 60, 320, 24, 42, 9, "", 3.5),
        T("tiles", "Gresie", G.F, "gresie", "surface", "stone", "surface", 50, 280, 50, 92, 10, "", -1),
        T("wall", "Finisaj perete", G.M, "vopsea lavabila", "surface", "wall", "surface", 15, 60, 70, 28, 11, "", -2),
        // Outdoor
        T("facade", "Fațadă tencuială decorativă", G.F, "tencuiala decorativa", "surface", "wall", "surface", 45, 160, 50, 34, 16, "", 90),
        T("outdoor_set", "Set mobilier terasă", G.M, "set mobilier terasa", "furniture", "wood", "outdoor", 1_500, 6_500, 45, 72, 13, "masă + 4 scaune"),
        T("lounger", "Șezlong", G.M, "sezlong", "furniture", "wood", "outdoor", 900, 3_800, 30, 74, 10, "200×70 cm"),
        T("pergola", "Pergolă", G.F, "pergola", "outdoor", "wood", "outdoor", 4_500, 18_000, 68, 24, 14, "4×3 m"),
        T("deck", "Deck compozit", G.M, "deck compozit", "surface", "wood", "surface", 140, 380, 50, 91, 11, "", 18),
        T("outdoor_light", "Corp de iluminat exterior", G.M, "corp iluminat exterior", "lighting", "metal", "lighting", 120, 650, 20, 30, 6, "IP65"),
        T("planter", "Jardinieră cu plante", G.F, "jardiniera", "decor", "plant", "outdoor", 180, 900, 85, 70, 8, "100×40 cm"),
        T("paving", "Pavaj din piatră", G.M, "pavaj piatra", "surface", "stone", "surface", 70, 220, 50, 88, 12, "", 30),
        T("garden_bench", "Bancă de grădină", G.F, "banca gradina", "furniture", "wood", "outdoor", 500, 2_200, 30, 70, 10, "150 cm"),
        T("garden_light", "Lămpi solare de grădină", G.P, "lampa solara gradina", "lighting", "metal", "lighting", 150, 700, 74, 62, 6, "set 6 buc."),
        T("lawn", "Gazon rulou", G.M, "gazon rulou", "surface", "plant", "outdoor", 18, 35, 46, 74, 14, "", 50),
    }.ToDictionary(t => t.Key);

    /// <summary>The six default objects of each space (first = most important).</summary>
    private static readonly Dictionary<string, string[]> Rooms = new()
    {
        ["living room"] = ["sofa", "armchair", "coffee_table", "pendant", "floor_lamp", "rug"],
        ["dining room"] = ["table", "chair", "pendant", "console", "rug", "floor"],
        ["kitchen"] = ["island", "stool", "cabinets", "pendant", "backsplash", "floor"],
        ["master bedroom"] = ["bed", "nightstand", "lamp", "wardrobe", "rug", "curtains"],
        ["bathroom"] = ["vanity", "mirror", "sconce", "tiles", "plant", "wall"],
        ["home office"] = ["desk", "office_chair", "shelf", "lamp", "rug", "floor"],
        ["entryway"] = ["console", "mirror", "bench", "sconce", "plant", "floor"],
        ["attic loft"] = ["sofa", "armchair", "coffee_table", "pendant", "shelf", "floor"],
        ["walk-in closet"] = ["wardrobe", "mirror", "bench", "pendant", "rug", "floor"],
        ["commercial cafe"] = ["table", "chair", "pendant", "cabinets", "plant", "floor"],
        // Exteriors
        ["modern villa exterior"] = ["facade", "outdoor_set", "pergola", "outdoor_light", "planter", "deck"],
        ["terrace pergola"] = ["outdoor_set", "pergola", "planter", "outdoor_light", "deck", "garden_light"],
        ["balcony"] = ["outdoor_set", "planter", "outdoor_light", "deck", "plant"],
        ["poolside deck"] = ["lounger", "outdoor_set", "pergola", "planter", "outdoor_light", "deck"],
        // Gardens
        ["residential garden"] = ["paving", "garden_bench", "garden_light", "planter", "pergola", "lawn"],
        ["outdoor pavilion"] = ["pergola", "outdoor_set", "garden_light", "planter", "paving", "lawn"],
        ["courtyard walkway"] = ["paving", "garden_bench", "garden_light", "planter", "lawn"],
    };

    private static readonly HashSet<string> OutdoorSpaces =
    [
        "modern villa exterior", "terrace pergola", "balcony", "poolside deck", "residential garden", "outdoor pavilion", "courtyard walkway",
    ];

    /// <summary>Typical floor area per space (m²), used when the request has no dimensions.</summary>
    private static readonly Dictionary<string, double> TypicalArea = new()
    {
        ["living room"] = 22, ["dining room"] = 16, ["kitchen"] = 12, ["master bedroom"] = 15, ["bathroom"] = 6,
        ["home office"] = 10, ["entryway"] = 6, ["attic loft"] = 26, ["walk-in closet"] = 6, ["commercial cafe"] = 45,
    };

    /// <summary>Room words of the brief (diacritic-free) → space, used when the space is unknown or of another mode.</summary>
    private static readonly (string Word, string Space)[] RoomWords =
    [
        ("living", "living room"), ("sufragerie", "living room"), ("camera de zi", "living room"), ("open space", "living room"),
        ("dining", "dining room"), ("sala de mese", "dining room"), ("dormitor", "master bedroom"), ("bedroom", "master bedroom"),
        ("bucatarie", "kitchen"), ("kitchen", "kitchen"), ("baie", "bathroom"), ("bathroom", "bathroom"),
        ("birou", "home office"), ("office", "home office"), ("hol", "entryway"), ("holul", "entryway"), ("intrare", "entryway"),
        ("hallway", "entryway"), ("mansarda", "attic loft"), ("loft", "attic loft"), ("dressing", "walk-in closet"),
        ("cafenea", "commercial cafe"), ("restaurant", "commercial cafe"), ("terasa", "terrace pergola"), ("terrace", "terrace pergola"),
        ("balcon", "balcony"), ("piscina", "poolside deck"), ("gradina", "residential garden"), ("garden", "residential garden"),
    ];

    /// <summary>Style signature pieces that make no sense in a given room (no curtains above a bathroom sink…).</summary>
    private static readonly HashSet<(string Space, string Key)> SignatureMisfits =
    [
        ("bathroom", "curtains"), ("bathroom", "bench"), ("bathroom", "shelf"), ("bathroom", "floor_lamp"), ("bathroom", "sconce"),
        ("kitchen", "curtains"), ("kitchen", "floor_lamp"), ("kitchen", "bench"), ("walk-in closet", "plant"), ("walk-in closet", "curtains"),
        ("entryway", "curtains"), ("entryway", "floor_lamp"), ("commercial cafe", "curtains"),
    ];

    // ── Style materials ───────────────────────────────────────────────────────

    private sealed record StyleKit(string Fabric, string Wood, string Metal, string Stone, bool Premium, string[] Signature);

    private static readonly Dictionary<string, StyleKit> Kits = new()
    {
        ["scandinavian"] = new("țesătură gri deschis", "stejar albit", "alb mat", "cuarț alb", false, ["plant"]),
        ["modern"] = new("stofă antracit", "nuc", "negru mat", "ceramică mată", false, ["shelf"]),
        ["contemporary"] = new("bouclé crem", "stejar natur", "alamă periată", "marmură albă", true, ["sconce"]),
        ["minimalist"] = new("in natur", "frasin", "alb mat", "microciment", false, []),
        ["minimalist_obsidian"] = new("piele neagră", "nuc închis", "negru grafit", "marmură neagră", true, ["sconce"]),
        ["japandi"] = new("in bej", "stejar natur", "negru mat", "piatră naturală", false, ["plant", "bench"]),
        ["traditional"] = new("catifea", "cireș", "alamă", "marmură", true, ["mirror", "curtains"]),
        ["mid_century_modern"] = new("stofă muștar", "nuc", "alamă", "terrazzo", true, ["floor_lamp"]),
        ["coastal"] = new("in alb", "ratan", "alb mat", "travertin", false, ["curtains"]),
        ["industrial"] = new("piele coniac", "lemn reciclat", "negru mat", "beton", false, ["shelf"]),
        ["brutalist_concrete"] = new("lână gri", "stejar fumuriu", "oțel brut", "beton aparent", true, ["bench"]),
        ["biophilic"] = new("in verde salvie", "bambus", "alamă", "piatră naturală", false, ["plant"]),
        // Styles the brief can ask for outside the catalog
        ["luxury"] = new("catifea mată", "nuc lăcuit", "alamă periată", "marmură Calacatta", true, ["mirror", "sconce"]),
        ["mediterranean"] = new("in natur", "stejar decapat", "fier forjat", "teracotă", false, ["plant", "curtains"]),
    };

    private static readonly StyleKit DefaultKit = new("țesătură bej", "stejar", "negru mat", "ceramică", false, []);

    /// <summary>Style words in the brief that refine the kit beyond the catalog style.</summary>
    private static readonly (string Word, string Kit)[] StyleWords =
    [
        ("lux", "luxury"), ("luxos", "luxury"), ("luxoasa", "luxury"), ("luxury", "luxury"), ("premium", "luxury"),
        ("mediteranean", "mediterranean"), ("mediterranean", "mediterranean"), ("mediteraneana", "mediterranean"),
        ("clasic", "traditional"), ("clasica", "traditional"), ("classic", "traditional"), ("neoclasic", "traditional"),
    ];

    /// <summary>Style-specific names for the same object (chandelier in a classic room…).</summary>
    private static readonly Dictionary<(string Kit, string Key), string> StyleNouns = new()
    {
        [("traditional", "pendant")] = "Candelabru",
        [("luxury", "pendant")] = "Candelabru",
        [("industrial", "pendant")] = "Lustră industrială",
        [("industrial", "shelf")] = "Raft industrial",
        [("japandi", "coffee_table")] = "Măsuță joasă",
        [("coastal", "armchair")] = "Fotoliu din ratan",
    };

    // ── Brief vocabulary (diacritic-free, lowercase) ────────────────────────────

    /// <summary>
    /// Phrase → object key (+ optional noun override). A trailing <c>*</c> matches word prefixes
    /// („canapel*” → „canapelele”), otherwise whole words only („pat” ≠ „patio”). Longest phrases win.
    /// </summary>
    private static readonly (string Phrase, string Key, string? Noun)[] ObjectWords =
    [
        ("canape*", "sofa", null), ("sofa", "sofa", null), ("couch", "sofa", null), ("coltar*", "sofa", "Canapea de colț"),
        ("fotoli*", "armchair", null), ("armchair*", "armchair", null),
        ("scaun de birou", "office_chair", null), ("scaunul de birou", "office_chair", null), ("office chair", "office_chair", null),
        ("scaune de bar", "stool", null), ("scaun de bar", "stool", null), ("taburet*", "stool", "Taburet"), ("bar stool*", "stool", null),
        ("scaun*", "chair", null), ("chair", "chair", null), ("chairs", "chair", null),
        ("masuta*", "coffee_table", null), ("masute", "coffee_table", null), ("coffee table", "coffee_table", null),
        ("masa", "table", null), ("masa de dining", "table", "Masă de dining"), ("mese", "table", null), ("table", "table", null), ("dining table", "table", null),
        ("pat", "bed", null), ("patul", "bed", null), ("bed", "bed", null), ("noptier*", "nightstand", null), ("nightstand*", "nightstand", null),
        ("dulap*", "wardrobe", null), ("garderob*", "wardrobe", null), ("sifonier*", "wardrobe", null), ("wardrobe", "wardrobe", null),
        ("birou", "desk", null), ("biroul", "desk", null), ("desk", "desk", null),
        ("bibliotec*", "shelf", null), ("raft*", "shelf", "Raft"), ("bookshelf", "shelf", null), ("shelving", "shelf", null),
        ("insula", "island", null), ("insula de bucatarie", "island", null), ("island", "island", null), ("blat*", "island", null),
        ("corpuri de bucatarie", "cabinets", null), ("mobilier de bucatarie", "cabinets", null), ("cabinets", "cabinets", null),
        ("lavoar*", "vanity", null), ("chiuvet*", "vanity", null), ("vanity", "vanity", null),
        ("consol*", "console", null), ("banca", "bench", null), ("banci", "bench", null), ("bench", "bench", null),
        ("lustr*", "pendant", null), ("pendul*", "pendant", null), ("candelabr*", "pendant", "Candelabru"), ("chandelier", "pendant", "Candelabru"),
        ("pendant", "pendant", null), ("corp suspendat", "pendant", null),
        ("lampadar*", "floor_lamp", null), ("floor lamp", "floor_lamp", null), ("veioz*", "lamp", null), ("lampa", "lamp", null), ("lamp", "lamp", null),
        ("aplica", "sconce", null), ("aplice", "sconce", null), ("aplica de perete", "sconce", null), ("sconce*", "sconce", null),
        ("covor*", "rug", null), ("rug", "rug", null), ("carpet", "rug", null),
        ("draper*", "curtains", null), ("perdea", "curtains", "Perdele"), ("perdele*", "curtains", "Perdele"), ("curtain*", "curtains", null), ("drapes", "curtains", null),
        ("oglind*", "mirror", null), ("mirror", "mirror", null),
        ("plant*", "plant", null), ("ficus", "plant", "Ficus"), ("monstera", "plant", "Monstera"),
        ("parchet*", "floor", "Parchet"), ("pardoseal*", "floor", null), ("flooring", "floor", null), ("floor", "floor", null),
        ("gresie", "tiles", null), ("tiles", "tiles", null), ("faianta", "backsplash", null), ("backsplash", "backsplash", null),
        ("perete", "wall", null), ("peretele", "wall", null), ("pereti", "wall", null), ("peretii", "wall", null), ("walls", "wall", null),
        ("pergol*", "pergola", null), ("deck", "deck", null), ("pavaj*", "paving", null), ("paving", "paving", null),
        ("jardinier*", "planter", null), ("planter*", "planter", null), ("gazon*", "lawn", null), ("lawn", "lawn", null),
        ("fatad*", "facade", null), ("facade", "facade", null), ("sezlong*", "lounger", null), ("lounger*", "lounger", null),
        ("banca de gradina", "garden_bench", null),
    ];

    /// <summary>Colour phrase → display (masculine form; inflected to the noun's gender).</summary>
    private static readonly (string Match, string Display)[] Colors =
    [
        ("verde smarald", "verde smarald"), ("verde salvie", "verde salvie"), ("verde oliv", "verde oliv"), ("verde inchis", "verde închis"),
        ("albastru navy", "albastru navy"), ("albastru petrol", "albastru petrol"), ("negru mat", "negru mat"), ("alb cald", "alb cald"),
        ("gri deschis", "gri deschis"), ("gri inchis", "gri închis"), ("sage green", "verde salvie"), ("emerald", "verde smarald"),
        ("smarald", "verde smarald"), ("salvie", "verde salvie"), ("bordo", "bordo"), ("burgundy", "bordo"), ("coniac", "coniac"), ("cognac", "coniac"),
        ("crem", "crem"), ("cream", "crem"), ("ivoire", "ivoire"), ("ivory", "ivoire"), ("bej", "bej"), ("beige", "bej"), ("grej", "greige"),
        ("greige", "greige"), ("nisipiu", "nisipiu"), ("caramel", "caramel"), ("negru", "negru"), ("neagra", "negru"), ("negre", "negru"),
        ("black", "negru"), ("alb", "alb"), ("alba", "alb"), ("albe", "alb"), ("white", "alb"), ("gri", "gri"), ("grey", "gri"), ("gray", "gri"),
        ("antracit", "antracit"), ("grafit", "grafit"), ("charcoal", "antracit"), ("bleumarin", "bleumarin"), ("navy", "bleumarin"),
        ("albastru", "albastru"), ("albastra", "albastru"), ("blue", "albastru"), ("verde", "verde"), ("green", "verde"),
        ("terracotta", "teracotă"), ("teracota", "teracotă"), ("mustar", "muștar"), ("mustard", "muștar"), ("ocru", "ocru"),
        ("galben", "galben"), ("galbena", "galben"), ("roz", "roz pudrat"), ("pink", "roz pudrat"), ("maro", "maro"), ("brown", "maro"),
        ("auriu", "auriu"), ("aurie", "auriu"), ("gold", "auriu"), ("rosu", "roșu"), ("rosie", "roșu"), ("red", "roșu"),
        ("mov", "mov"), ("lavanda", "lavandă"), ("rugina", "ruginiu"),
    ];

    /// <param name="Match">Diacritic-free phrase matched in the client's text.</param>
    /// <param name="Display">Romanian display form.</param>
    /// <param name="Query">Diacritic-free search word(s) for the retailer link.</param>
    /// <param name="Factor">Price multiplier relative to the template's base.</param>
    /// <param name="Gender">Grammatical gender of the material word.</param>
    /// <param name="Quality">Short practical benefit shown in the note.</param>
    /// <param name="Adjective">The material follows the noun directly („Fotoliu bouclé”).</param>
    private sealed record MaterialDef(string Match, string Display, string Query, double Factor, G Gender, string? Quality, bool Adjective = false);

    /// <summary>Material phrases (longest first). <c>Adjective</c> materials follow the noun directly („Fotoliu bouclé”).</summary>
    private static readonly MaterialDef[] Materials =
    [
        new("lemn masiv de stejar", "lemn masiv de stejar", "stejar masiv", 1.5, G.M, "îmbinări solide, se poate reșlefui"),
        new("lemn masiv de nuc", "lemn masiv de nuc", "nuc masiv", 1.6, G.M, "esență nobilă, finisaj ulei"),
        new("stejar masiv", "stejar masiv", "stejar masiv", 1.5, G.M, "îmbinări solide, se poate reșlefui"),
        new("lemn masiv", "lemn masiv", "lemn masiv", 1.35, G.M, "durabil, se poate reșlefui"),
        new("solid wood", "lemn masiv", "lemn masiv", 1.35, G.M, "durabil, se poate reșlefui"),
        new("parchet stratificat", "parchet stratificat", "parchet stratificat", 1.15, G.M, "strat nobil 3 mm"),
        new("parchet masiv", "parchet masiv", "parchet masiv", 1.45, G.M, "se poate recondiționa"),
        new("parchet laminat", "parchet laminat", "parchet laminat", 0.75, G.M, "AC4, rezistent la zgârieturi"),
        new("laminat", "parchet laminat", "parchet laminat", 0.75, G.M, "AC4, rezistent la zgârieturi"),
        new("gresie portelanata", "gresie porțelanată", "gresie portelanata", 1.2, G.F, "rezistentă la uzură"),
        new("lemn de stejar", "stejar", "stejar", 1.3, G.M, null), new("stejar", "stejar", "stejar", 1.3, G.M, null), new("oak", "stejar", "stejar", 1.3, G.M, null),
        new("lemn de nuc", "nuc", "nuc", 1.4, G.M, null), new("nuc", "nuc", "nuc", 1.4, G.M, null), new("walnut", "nuc", "nuc", 1.4, G.M, null),
        new("frasin", "frasin", "frasin", 1.15, G.M, null), new("tec", "tec", "tec", 1.4, G.M, "rezistent la umiditate"),
        new("catifea", "catifea mată", "catifea", 1.25, G.F, "rezistentă la trafic"), new("velvet", "catifea mată", "catifea", 1.25, G.F, "rezistentă la trafic"),
        new("boucle", "bouclé", "boucle", 1.2, G.M, "tușeu moale", Adjective: true),
        new("piele ecologica", "piele ecologică", "piele ecologica", 1.05, G.F, "ușor de întreținut"),
        new("piele", "piele naturală", "piele", 1.6, G.F, "se patinează frumos"), new("leather", "piele naturală", "piele", 1.6, G.F, "se patinează frumos"),
        new("din in", "in", "in", 1.05, G.M, "respirabil, aspect natural"), new("de in", "in", "in", 1.05, G.M, "respirabil, aspect natural"),
        new("linen", "in", "in", 1.05, G.M, "respirabil, aspect natural"), new("lana", "lână", "lana", 1.15, G.F, "caldă, fonoabsorbantă"),
        new("wool", "lână", "lana", 1.15, G.F, "caldă, fonoabsorbantă"), new("iuta", "iută", "iuta", 0.95, G.F, "fibră naturală"),
        new("marmura", "marmură", "marmura", 1.7, G.F, "șlefuită, sigilată"), new("marble", "marmură", "marmura", 1.7, G.F, "șlefuită, sigilată"),
        new("travertin", "travertin", "travertin", 1.5, G.M, null), new("alama", "alamă", "alama", 1.35, G.F, null), new("brass", "alamă", "alama", 1.35, G.F, null),
        new("ratan", "ratan", "ratan", 1.1, G.M, "împletit manual"), new("rattan", "ratan", "ratan", 1.1, G.M, "împletit manual"),
        new("microciment", "microciment", "microciment", 1.3, G.M, "fără rosturi"), new("beton", "beton", "beton", 1.1, G.M, null),
        new("concrete", "beton", "beton", 1.1, G.M, null), new("cuart", "cuarț", "cuart", 1.45, G.M, "rezistent la pete"),
        new("sticla", "sticlă", "sticla", 1.1, G.F, null), new("glass", "sticlă", "sticla", 1.1, G.F, null),
        new("otel", "oțel", "otel", 1.05, G.M, null), new("metal", "metal", "metal", 1.0, G.M, null), new("bambus", "bambus", "bambus", 1.05, G.M, null),
        new("terrazzo", "terrazzo", "terrazzo", 1.4, G.M, null), new("ceramica", "ceramică", "ceramica", 1.0, G.F, null),
        new("lemn", "lemn", "lemn", 1.2, G.M, null), new("wood", "lemn", "lemn", 1.2, G.M, null),
    ];

    /// <summary>Feature words (stem*, masculine display, price factor): „canapea extensibilă”, „lustră minimalistă”.</summary>
    private static readonly (string Match, string Display, double Factor)[] Features =
    [
        ("extensibil*", "extensibil", 1.25), ("extendable", "extensibil", 1.25), ("modular*", "modular", 1.2),
        ("de colt", "de colț", 1.3), ("minimalist*", "minimalist", 1.0), ("rotund*", "rotund", 1.05), ("round", "rotund", 1.05),
        ("oval*", "oval", 1.05), ("incastrat*", "încastrat", 1.2), ("built in", "încastrat", 1.2), ("dimabil*", "dimabil", 1.1),
        ("dimmable", "dimabil", 1.1), ("pliabil*", "pliabil", 0.9), ("vintage", "vintage", 1.1), ("retro", "retro", 1.05),
        ("cu led", "cu LED", 1.08), ("led", "cu LED", 1.08), ("smart", "smart", 1.2),
    ];

    private static readonly Regex ClauseSplit = new(@"[,.;:!?\n]+|\s+si\s+|\s+iar\s+|\s+and\s+|\s+plus\s+", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex Words = new(@"[a-z0-9]+", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>What the brief says about one object.</summary>
    private sealed record Modifier(MaterialDef? Material, string? Color, IReadOnlyList<(string Display, double Factor)> Features, string? Noun)
    {
        public static readonly Modifier Empty = new(null, null, [], null);
        public bool HasDetail => Material is not null || Color is not null || Features.Count > 0;
        public double Factor => (Material?.Factor ?? 1) * Features.Aggregate(1.0, (f, x) => f * x.Factor);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>Context from a Studio payload and its compiled plan (the brief resolves inferred room / style).</summary>
    public static RoomObjectContext ContextFrom(JsonElement payload, GenerationPlan plan, SelectionRegion? region = null)
    {
        var brief = plan.Brief;
        var space = brief?.SpaceType ?? Js.AsString(Js.Prop(payload, "spaceType")) ?? Js.AsString(Js.Prop(payload, "roomType")) ?? "";
        var style = brief?.StyleId ?? DesignVision.RequestedStyle(payload);
        var prompt = brief?.CustomPrompt ?? DesignVision.CleanCustomPrompt(Js.AsString(Js.Prop(payload, "customPrompt")));
        var budget = Js.AsString(Js.Prop(Js.Prop(payload, "dimensions"), "budget"));
        var scale = DesignVision.ResolveScale(payload);
        return new RoomObjectContext(
            plan.Mode, space, style,
            brief?.Palette ?? DesignVision.GetPalette(Js.AsString(Js.Prop(payload, "palette")))?.Id,
            brief?.Lighting ?? DesignVision.GetLighting(Js.AsString(Js.Prop(payload, "lighting")))?.Id,
            prompt, budget is "economy" or "luxury" ? budget : "standard", region ?? plan.Region,
            scale.AreaKnown ? scale.AreaSqm : null);
    }

    /// <summary>4–7 hotspots for the render described by <paramref name="ctx"/> (same input → same output).</summary>
    public static IReadOnlyList<DetectedItem> Extract(RoomObjectContext ctx)
    {
        var style = SucvarCatalog.GetStyle(ctx.StyleId);
        var prompt = Normalize(ctx.CustomPrompt);
        var tokens = Tokens(prompt);
        var kitId = StyleWords.FirstOrDefault(w => ContainsPhrase(tokens, w.Word)).Kit ?? style.Id;
        var kit = Kits.GetValueOrDefault(kitId) ?? DefaultKit;
        var space = ResolveSpace(ctx, tokens);
        var mentions = ParseMentions(prompt);
        var seed = StableHash($"{ctx.Mode}|{space}|{kitId}|{ctx.Palette}|{prompt}");

        // 1. Room template, then the objects the brief names (most important first), then the style's signature piece
        var keys = Rooms[space].ToList();
        foreach (var key in mentions.Keys.Where(k => !keys.Contains(k)))
        {
            if (keys.Count >= MaxItems) keys.RemoveAt(keys.Count - 1);
            keys.Insert(Math.Min(2, keys.Count), key);
        }
        if (ctx.Mode is not ("exteriors" or "gardens"))
            foreach (var key in kit.Signature.Where(k => !keys.Contains(k) && !SignatureMisfits.Contains((space, k))).Take(MaxItems - keys.Count))
                keys.Add(key);

        var pricing = new Pricing(ctx.Budget, style.CostFactor, kit.Premium,
            Math.Clamp(ctx.AreaSqm ?? TypicalArea.GetValueOrDefault(space, 18), 3, 150));
        var items = new List<DetectedItem>();
        for (var i = 0; i < keys.Count; i++)
        {
            var template = Objects[keys[i]];
            items.Add(Build(template, $"{template.Key}-{i + 1}", mentions.GetValueOrDefault(template.Key), kit, kitId, style, ctx, pricing,
                template.X + Jitter(seed, i * 2), template.Y + Jitter(seed, i * 2 + 1), template.R, i, seed, edited: false));
        }

        // 2. Regional edit: the painted area IS the edited object; hotspots it covers are replaced by it
        Exclusion? exclusion = null;
        if (ctx.Region is { } region)
        {
            (items, exclusion) = ApplyRegion(items, region, mentions, kit, kitId, style, ctx, pricing, seed);
        }

        return Place(items.Take(MaxItems).ToList(), exclusion);
    }

    /// <summary>Retailer search URL for a diacritic-free Romanian query (never a product deep link → never a 404).</summary>
    public static string SearchUrl(string retailerId, string query) =>
        RomanianRetail.Retailers[retailerId].Build(Js.EncodeUriComponent(Js.Slice(query.Trim(), 80)));

    // ── Building blocks ───────────────────────────────────────────────────────

    private sealed record Pricing(string Budget, double StyleFactor, bool Premium, double AreaSqm);

    private static DetectedItem Build(Template t, string id, Modifier? mod, StyleKit kit, string kitId, VisualStyle style,
        RoomObjectContext ctx, Pricing pricing, double x, double y, double r, int index, uint seed, bool edited)
    {
        mod ??= Modifier.Empty;
        var noun = mod.Noun ?? StyleNouns.GetValueOrDefault((kitId, t.Key)) ?? t.Noun;
        var defaultMaterial = DefaultMaterial(t.Slot, kit, style);
        var label = mod.HasDetail ? CustomLabel(noun, t.Gender, mod) : DefaultLabel(noun, t, defaultMaterial);

        // Price: position inside the object's market range by budget, style, premium kit, material and features
        var position = pricing.Budget switch { "economy" => 0.12, "luxury" => 0.78, _ => 0.4 }
            + (pricing.StyleFactor - 1) * 0.5
            + (pricing.Premium ? 0.1 : 0)
            + (mod.Factor - 1) * 0.6
            + (((seed >> (index % 24)) & 7) - 3.5) * 0.01; // ±3.5 % so neighbouring items never look templated
        position = Math.Clamp(position, 0, 1);
        var unit = t.Min + (t.Max - t.Min) * position;
        var qty = Quantity(t, pricing.AreaSqm);
        var price = qty > 0 ? RoundTo(unit * qty, 10) : RetailPrice(unit);

        var note = Note(t, mod, kit, style, ctx, defaultMaterial, (int)Math.Round(unit), qty);
        var retailer = PickRetailer(t.Lane, kit.Premium, index);
        var query = string.Join(' ', new[]
        {
            t.Query,
            mod.Features.Count > 0 ? Normalize(mod.Features[0].Display) : null,
            mod.Material?.Query ?? (mod.HasDetail ? null : Normalize(FirstWord(defaultMaterial))),
            mod.Color is { } c ? Normalize(c) : null,
        }.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct());

        return new DetectedItem(id, Capitalize(label), t.Category, note, price, RomanianRetail.Retailers[retailer].Label,
            SearchUrl(retailer, query), Pct(x), Pct(y), Math.Round(Math.Clamp(r, 4, 20), 1), edited);
    }

    /// <summary>„Canapea extensibilă gri”, „Masă din lemn masiv de stejar”, „Fotoliu bouclé crem”, „Perdele din in albe”.</summary>
    private static string CustomLabel(string noun, G gender, Modifier mod)
    {
        var parts = new List<string> { noun };
        parts.AddRange(mod.Features.Select(f => Inflect(f.Display, gender)));
        var colorGender = gender;
        if (mod.Material is { } m)
        {
            if (m.Display.StartsWith(noun, StringComparison.OrdinalIgnoreCase))
                parts[0] = m.Display; // „Parchet” + „parchet stratificat” → „Parchet stratificat”
            else
                parts.Add(m.Adjective ? m.Display : $"din {m.Display}");
            if (!m.Adjective) colorGender = m.Gender; // the colour agrees with the material („din piele neagră”)
        }
        if (mod.Color is { } c) parts.Add(Inflect(c, colorGender));
        return string.Join(' ', parts);
    }

    private static string DefaultLabel(string noun, Template t, string material) => t.Slot switch
    {
        "floor" => $"{noun} {Lower(material.Split([",", " sau ", " + "], StringSplitOptions.None)[0])}",
        "plant" or "wall" => noun,
        _ when material.Length == 0 => noun,
        // Finishes that are adjectives agree with the noun („Lustră neagră mată”); materials take „din”
        "metal" when Inflections.ContainsKey(FirstWord(material)) => $"{noun} {Inflect(material, t.Gender)}",
        "stone" when t.Key is "backsplash" or "tiles" => $"{noun} {material}",
        _ when t.Sqm != 0 => noun,
        _ => $"{noun} din {material}",
    };

    private static string Note(Template t, Modifier mod, StyleKit kit, VisualStyle style, RoomObjectContext ctx, string defaultMaterial, int unit, double qty)
    {
        var kelvin = ctx.Lighting is "golden_hour" or "evening" ? 2700 : (int)Math.Round(style.LightingSpec.Kelvin);
        var material = mod.Material is { } m
            ? string.Join(' ', new[] { m.Display, mod.Color is { } c ? Inflect(c, m.Gender) : null }.Where(s => s is not null))
            : t.Slot switch
                {
                    "fabric" => $"{kit.Fabric}, structură {kit.Wood}",
                    "wood" => $"{kit.Wood}, accente {kit.Metal}",
                    "metal" => kit.Metal,
                    "stone" => kit.Stone,
                    "floor" => style.Materials.Flooring.Ro,
                    "wall" => style.Materials.Walls.Ro,
                    "plant" => "plante naturale",
                    _ => defaultMaterial,
                };
        var parts = new List<string> { Capitalize(material) };
        if (mod.Material is null && mod.Color is { } color) parts[0] = $"Nuanță {color} · {Lower(parts[0])}";
        if (mod.Material?.Quality is { } quality) parts.Add(quality);
        if (qty > 0) parts.Add($"≈ {unit} lei/m² × {qty:0.#} m²");
        else if (t.Size.Length > 0) parts.Add(t.Size);
        if (t.Lane == "lighting") parts.Add($"{kelvin} K");
        return string.Join(" · ", parts.Distinct());
    }

    private static double Quantity(Template t, double area) => t.Sqm switch
    {
        -1 => Math.Round(area * 1.08), // + 8 % cut-off waste
        -2 => Math.Round(Math.Sqrt(area) * 4 * 2.6 * 0.85), // perimeter × height − openings
        > 0 => t.Sqm,
        _ => 0,
    };

    /// <summary>„…9” endings under 1 000 lei (549), round fifties above (2 450).</summary>
    private static int RetailPrice(double v) => v < 1_000 ? Math.Max(19, RoundTo(v, 10) - 1) : RoundTo(v, 50);

    private static int RoundTo(double v, int step) => (int)(Math.Round(v / step) * step);

    private sealed record Exclusion(double Left, double Top, double Right, double Bottom)
    {
        public bool Contains(double x, double y) => x >= Left && x <= Right && y >= Top && y <= Bottom;
    }

    private static (List<DetectedItem>, Exclusion) ApplyRegion(List<DetectedItem> items, SelectionRegion region, Dictionary<string, Modifier> mentions,
        StyleKit kit, string kitId, VisualStyle style, RoomObjectContext ctx, Pricing pricing, uint seed)
    {
        double left = region.X * 100, top = region.Y * 100, right = (region.X + region.Width) * 100, bottom = (region.Y + region.Height) * 100;
        double cx = region.X * 100 + region.Width * 100 / 2, cy = region.Y * 100 + region.Height * 100 / 2;
        var zone = new Exclusion(left - 2, top - 2, right + 2, bottom + 2);

        // Which object: the one the brief names, else the template object nearest to the painted area
        var nearest = items.OrderBy(d => Math.Pow(d.XPercent - cx, 2) + Math.Pow(d.YPercent - cy, 2)).FirstOrDefault();
        var key = mentions.Keys.FirstOrDefault() ?? nearest?.Id[..nearest.Id.LastIndexOf('-')] ?? "plant";
        var template = Objects[key];
        // A brief with colour / material but no noun („fă-l verde smarald”) still customises the selected object
        var mod = mentions.GetValueOrDefault(key) ?? ClauseModifier(Tokens(Normalize(ctx.CustomPrompt)));
        var radius = Math.Clamp(Math.Max(region.Width, region.Height) * 50, 5, 18);
        var edited = Build(template, $"edit-{key}", mod, kit, kitId, style, ctx, pricing, cx, cy, radius, 0, seed, edited: true);

        var rest = items.Where(d => !zone.Contains(d.XPercent, d.YPercent) && !d.Id.StartsWith(key + "-", StringComparison.Ordinal)).ToList();
        rest.Insert(0, edited);
        return (rest, zone);
    }

    /// <summary>
    /// Non-overlapping placement: each hotspot (most important first) keeps its template spot when it is free, else
    /// moves to the nearest candidate — preferring sideways moves so furniture stays in its band — that is ≥
    /// <see cref="MinGapPercent"/> from every placed hotspot, inside the edge band and outside the painted area.
    /// The edited hotspot is never moved: it marks the mask's centroid exactly.
    /// </summary>
    private static List<DetectedItem> Place(List<DetectedItem> items, Exclusion? exclusion)
    {
        var placed = new List<DetectedItem>();
        foreach (var item in items.OrderByDescending(i => i.Edited))
        {
            if (item.Edited) { placed.Add(item); continue; }
            bool Free(double x, double y) =>
                placed.All(p => Math.Sqrt(Math.Pow(p.XPercent - x, 2) + Math.Pow(p.YPercent - y, 2)) >= MinGapPercent)
                && exclusion?.Contains(x, y) != true;

            double sx = Edge(item.XPercent), sy = Edge(item.YPercent);
            (double X, double Y)? spot = Free(sx, sy) ? (sx, sy) : null;
            for (var ring = 4; spot is null && ring <= 72; ring += 4)
                foreach (var deg in SearchAngles)
                {
                    double x = Edge(sx + ring * Math.Cos(deg * Math.PI / 180)), y = Edge(sy + ring * Math.Sin(deg * Math.PI / 180));
                    if (Free(x, y)) { spot = (x, y); break; }
                }
            // Crowded frame: the grid point farthest from everything already placed
            spot ??= Grid().OrderBy(g => exclusion?.Contains(g.X, g.Y) == true ? 1 : 0)
                .ThenByDescending(g => placed.Count == 0 ? 0 : placed.Min(p => Math.Pow(p.XPercent - g.X, 2) + Math.Pow(p.YPercent - g.Y, 2)))
                .First();

            placed.Add(item with { XPercent = Math.Round(spot.Value.X, 1), YPercent = Math.Round(spot.Value.Y, 1) });
        }
        // Original priority order (edited first, as before)
        return placed;
    }

    private static readonly int[] SearchAngles = [0, 180, 20, 160, 340, 200, 45, 135, 315, 225, 70, 110, 290, 250, 90, 270];

    private static IEnumerable<(double X, double Y)> Grid()
    {
        for (var y = EdgeMinPercent; y <= EdgeMaxPercent; y += 6)
            for (var x = EdgeMinPercent; x <= EdgeMaxPercent; x += 6)
                yield return (x, y);
    }

    private static double Edge(double v) => Math.Clamp(v, EdgeMinPercent, EdgeMaxPercent);

    private static string PickRetailer(string lane, bool premium, int index) => lane switch
    {
        "furniture" => premium ? (index % 3 == 2 ? "ikea" : "mobexpert") : (index % 2 == 0 ? "ikea" : "mobexpert"),
        "lighting" => index % 2 == 0 ? "ikea" : "dedeman",
        "decor" => premium ? "mobexpert" : "ikea",
        "outdoor" => index % 2 == 0 ? "leroymerlin" : "dedeman",
        _ => (index % 3) switch { 0 => "dedeman", 1 => "leroymerlin", _ => "hornbach" },
    };

    private static string DefaultMaterial(string slot, StyleKit kit, VisualStyle style) => slot switch
    {
        "fabric" => kit.Fabric,
        "wood" => kit.Wood,
        "metal" => kit.Metal,
        "stone" => kit.Stone,
        "floor" => Lower(style.Materials.Flooring.Ro),
        _ => "",
    };

    // ── Brief parsing ─────────────────────────────────────────────────────────

    /// <summary>The space whose objects to show: the catalog space, else the room the brief names, else a living room.</summary>
    private static string ResolveSpace(RoomObjectContext ctx, string[] tokens)
    {
        if (Rooms.ContainsKey(ctx.SpaceType)) return ctx.SpaceType;
        var outdoor = ctx.Mode is "exteriors" or "gardens";
        var spaceTokens = Tokens(Normalize(ctx.SpaceType));
        var fromText = RoomWords
            .Where(r => OutdoorSpaces.Contains(r.Space) == outdoor)
            .FirstOrDefault(r => ContainsPhrase(spaceTokens, r.Word) || ContainsPhrase(tokens, r.Word)).Space;
        if (fromText is not null) return fromText;
        return ctx.Mode switch
        {
            "exteriors" => "modern villa exterior",
            "gardens" => "residential garden",
            _ => "living room",
        };
    }

    /// <summary>
    /// Per object key: its colour, material and features. Each clause is scanned for every object it names; a
    /// descriptor belongs to the nearest object before it (Romanian adjectives follow the noun: „canapea gri cu
    /// fotoliu bouclé” → gri → canapea, bouclé → fotoliu), or the first one after it („velvet sofa”).
    /// </summary>
    private static Dictionary<string, Modifier> ParseMentions(string prompt)
    {
        var result = new Dictionary<string, Modifier>();
        if (prompt.Length == 0) return result;
        foreach (var clause in ClauseSplit.Split(prompt))
        {
            var tokens = Tokens(clause);
            if (tokens.Length == 0) continue;
            // Objects and materials are matched independently (a material may contain an object word: „parchet
            // stratificat”, „gresie porțelanată”); colours and features only use the words left over.
            var objectUsed = new bool[tokens.Length];
            var objects = Match(tokens, objectUsed, ObjectWords.Select(o => (o.Phrase, (Key: o.Key, Noun: o.Noun))));
            if (objects.Count == 0) continue;
            var materialUsed = new bool[tokens.Length];
            var materials = Match(tokens, materialUsed, Materials.Select(m => (m.Match, m)));
            var used = objectUsed.Zip(materialUsed, (a, b) => a || b).ToArray();
            var colors = Match(tokens, used, Colors.Select(c => (c.Match, c.Display)));
            var features = Match(tokens, used, Features.Select(f => (f.Match, (f.Display, f.Factor))));

            var owners = objects.OrderBy(o => o.Index).ToList();
            int Owner(int index)
            {
                var before = owners.Where(o => o.Index <= index).ToList();
                return before.Count > 0 ? before[^1].Index : owners[0].Index;
            }

            foreach (var obj in owners)
            {
                var key = obj.Value.Key;
                if (result.TryGetValue(key, out var existing) && existing.HasDetail) continue;
                bool Mine(int i) => Owner(i) == obj.Index;
                result[key] = new Modifier(
                    materials.Where(m => Mine(m.Index)).OrderBy(m => m.Index).Select(m => m.Value).FirstOrDefault(),
                    colors.Where(c => Mine(c.Index)).OrderBy(c => c.Index).Select(c => c.Value).FirstOrDefault(),
                    features.Where(f => Mine(f.Index)).OrderBy(f => f.Index).Select(f => f.Value).DistinctBy(f => f.Display).ToList(),
                    obj.Value.Noun);
            }
        }
        return result;
    }

    /// <summary>Descriptors of a clause with no object noun („fă-l verde smarald”), or null when it has none.</summary>
    private static Modifier? ClauseModifier(string[] tokens)
    {
        var used = new bool[tokens.Length];
        Match(tokens, used, ObjectWords.Select(o => (o.Phrase, o.Key))); // „schimbă-l” has none; any noun is not a colour
        var material = Match(tokens, used, Materials.Select(m => (m.Match, m))).OrderBy(m => m.Index).Select(m => m.Value).FirstOrDefault();
        var color = Match(tokens, used, Colors.Select(c => (c.Match, c.Display))).OrderBy(c => c.Index).Select(c => c.Value).FirstOrDefault();
        var features = Match(tokens, used, Features.Select(f => (f.Match, (f.Display, f.Factor)))).Select(f => f.Value).ToList();
        var mod = new Modifier(material, color, features, null);
        return mod.HasDetail ? mod : null;
    }

    /// <summary>
    /// All non-overlapping occurrences of the phrases in <paramref name="tokens"/> (longest phrases first; a matched
    /// token is consumed so „lemn masiv de stejar” is not also read as „lemn” + „stejar”).
    /// </summary>
    private static List<(int Index, TValue Value)> Match<TValue>(string[] tokens, bool[] used, IEnumerable<(string Phrase, TValue Value)> phrases)
    {
        var found = new List<(int, TValue)>();
        foreach (var (phrase, value) in phrases.OrderByDescending(p => p.Phrase.Count(c => c == ' ')).ThenByDescending(p => p.Phrase.Length))
        {
            var prefix = phrase.EndsWith('*');
            var words = phrase.TrimEnd('*').Split(' ');
            for (var i = 0; i + words.Length <= tokens.Length; i++)
            {
                var ok = true;
                for (var w = 0; w < words.Length && ok; w++)
                {
                    var last = w == words.Length - 1;
                    ok = !used[i + w] && (prefix && last ? tokens[i + w].StartsWith(words[w], StringComparison.Ordinal) : tokens[i + w] == words[w]);
                }
                if (!ok) continue;
                for (var w = 0; w < words.Length; w++) used[i + w] = true;
                found.Add((i, value));
            }
        }
        return found;
    }

    private static bool ContainsPhrase(string[] tokens, string phrase)
    {
        var words = phrase.Split(' ');
        for (var i = 0; i + words.Length <= tokens.Length; i++)
            if (words.Select((w, k) => tokens[i + k] == w).All(b => b)) return true;
        return false;
    }

    // ── Small helpers ─────────────────────────────────────────────────────────

    private static string[] Tokens(string normalized) => Words.Matches(normalized).Select(m => m.Value).ToArray();

    private static string Normalize(string? s) => Js.StripDiacritics(s ?? "").ToLowerInvariant().Trim();

    private static string Lower(string s) => s.Length == 0 ? s : char.ToLowerInvariant(s[0]) + s[1..];

    private static string Capitalize(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];

    private static string FirstWord(string s) => s.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";

    private static double Pct(double v) => Math.Round(Math.Clamp(v, 3, 97), 1);

    /// <summary>±3 % placement variation per render brief (stable: FNV-1a of the brief).</summary>
    private static double Jitter(uint seed, int salt) => (int)((seed >> (salt % 28)) % 7) - 3;

    private static uint StableHash(string s)
    {
        var h = 2166136261u;
        foreach (var c in s) h = (h ^ c) * 16777619u;
        return h;
    }
}
