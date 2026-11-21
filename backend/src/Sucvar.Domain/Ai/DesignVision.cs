using System.Text.Json;
using System.Text.RegularExpressions;
using Sucvar.Domain.Catalog;
using Sucvar.Domain.Studio;

namespace Sucvar.Domain.Ai;

/// <summary>
/// A material / finish recognised in the user's free-text vision (RO or EN).
/// <para><c>Slot</c> decides where it lands in the bill of materials:
/// floor | walls | lighting | furniture | fixtures | decor.</para>
/// </summary>
public sealed record VisionMaterial(
    string Id,
    string Slot,
    string TitleRo,
    string TitleEn,
    string PromptEn,
    string Query,
    string ProcCategory,
    double BasePrice,
    string Unit);

/// <summary>Optional modifier pill (palette / lighting) with its prompt fragment.</summary>
public sealed record VisionOption(string Id, string LabelRo, string LabelEn, string Prompt);

/// <summary>The resolved design brief of one Studio request (echoed to the client as <c>vision</c>).</summary>
public sealed record DesignBrief(
    string CustomPrompt,
    string? StyleId,
    bool StyleInferred,
    string? Palette,
    string? Lighting,
    string SpaceType,
    bool SpaceInferred,
    double AreaSqm,
    bool PreserveStructure,
    IReadOnlyList<VisionMaterial> Materials,
    string? Preset = null,
    RoomScale? Scale = null,
    string? OptimizationGoal = null,
    IReadOnlyList<string>? ErgonomicConstraints = null,
    bool Is3dScanSource = false,
    int? DoorCount = null,
    int? WindowCount = null)
{
    public bool HasCustomPrompt => CustomPrompt.Length > 0;

    /// <summary>"Optimizare spațiu" or "Aplică recomandările": the compiler adds a space-planning layer.</summary>
    public bool HasSpacePlanning => OptimizationGoal is not null || ErgonomicConstraints is { Count: > 0 };
}

/// <summary>
/// Parisian architectural preset (Studio inspiration chip): a base catalog style plus a rich English
/// enrichment that leads the synthesized prompt.
/// </summary>
public sealed record StylePreset(string Id, string LabelFr, string LabelEn, string LabelRo, string BaseStyleId, string PromptEn, string[] Keywords);

/// <summary>Validation failure for the flexible Studio contract.</summary>
public sealed record VisionError(string Code, string Message);

/// <summary>
/// Smart Prompt Synthesizer inputs: parses the flexible Studio contract (free-text <c>customPrompt</c> +
/// optional style / palette / lighting / room / area / structure), infers what was left out, and recognises
/// materials in the text so prompts and procurement lists match what the user actually typed.
/// </summary>
public static partial class DesignVision
{
    public const int CustomPromptMaxLength = 1000;
    public const double DefaultAreaSqm = 20, MinAreaSqm = 1, MaxAreaSqm = 10_000;
    public const string Auto = "auto";

    // ── Optional pills ──────────────────────────────────────────────────────
    public static readonly IReadOnlyList<VisionOption> Palettes =
    [
        new("warm_neutral", "Neutru cald", "Warm neutral", "warm neutral palette, cream, sand and soft white tones"),
        new("monochrome", "Monocrom", "Monochrome", "monochrome palette, black, white and grey tones"),
        new("earthy", "Pământiu", "Earthy", "earthy palette, terracotta, olive and natural wood tones"),
        new("cool_grey", "Gri rece", "Cool grey", "cool grey palette, concrete and stone tones"),
        new("dark_moody", "Întunecat", "Dark & moody", "dark moody palette, charcoal and deep walnut tones"),
        new("light_airy", "Luminos", "Light & airy", "light airy palette, white walls, pale wood"),
    ];

    public static readonly IReadOnlyList<VisionOption> LightingOptions =
    [
        new("natural", "Lumină naturală", "Natural daylight", "bright natural daylight from windows"),
        new("golden_hour", "Apus cald", "Golden hour", "warm golden hour sunlight, long soft shadows"),
        new("evening", "Seară ambientală", "Evening ambient", "warm evening ambient lighting, dimmed lamps"),
        new("studio", "Studio luminos", "Bright studio", "even bright diffused studio lighting"),
        new("dramatic", "Dramatic", "Dramatic", "dramatic contrast lighting, accent spotlights"),
    ];

    public static VisionOption? GetPalette(string? id) => Palettes.FirstOrDefault(p => p.Id == id);
    public static VisionOption? GetLighting(string? id) => LightingOptions.FirstOrDefault(p => p.Id == id);

    // ── Material lexicon (keywords are diacritic-free, lower-case; RO + EN) ──
    private sealed record Entry(string[] Keywords, VisionMaterial Material);

    private static Entry E(string id, string slot, string ro, string en, string prompt, string query, string proc, double price, string unit, params string[] keywords) =>
        new(keywords, new VisionMaterial(id, slot, ro, en, prompt, query, proc, price, unit));

    private static readonly Entry[] Lexicon =
    [
        // Floors (first floor match wins, so the most specific pattern comes first)
        E("point_hongrie", "floor", "Parchet point de Hongrie", "Point de Hongrie parquet", "oak point de Hongrie chevron parquet floor", "parchet point de hongrie", "construction", 58, "m²",
            "point de hongrie", "parquet point de hongrie", "parquet en chevron", "chevron parquet"),
        E("herringbone", "floor", "Parchet în spic (herringbone)", "Herringbone parquet", "herringbone parquet floor", "parchet in spic herringbone", "construction", 42, "m²",
            "herringbone", "in spic", "spic de grau", "chevron", "baton rompu"),
        E("oak_floor", "floor", "Parchet stejar", "Oak flooring", "white oak wood flooring", "parchet stejar", "construction", 32, "m²",
            "parchet de stejar", "parchet stejar", "pardoseala stejar", "oak floor", "oak parquet", "oak flooring", "stejar", "parquet chene", "parquet en chene", "chene"),
        E("walnut_floor", "floor", "Parchet nuc", "Walnut flooring", "dark walnut wood flooring", "parchet nuc", "construction", 38, "m²",
            "parchet nuc", "walnut floor", "walnut flooring", "nuc", "noyer"),
        E("terrazzo", "floor", "Gresie terrazzo", "Terrazzo tiles", "terrazzo floor", "gresie terrazzo", "construction", 36, "m²", "terrazzo", "terazzo"),
        E("microcement", "floor", "Microciment", "Microcement", "seamless microcement surfaces", "microciment", "construction", 45, "m²",
            "microciment", "microcement", "beton slefuit", "polished concrete", "beton cire"),
        E("marble", "floor", "Marmură", "Marble", "polished marble surfaces", "gresie aspect marmura", "construction", 48, "m²", "marmura", "marble", "marbre"),
        E("travertine", "floor", "Travertin", "Travertine", "travertine stone", "travertin", "construction", 55, "m²", "travertin", "travertine"),
        // Walls
        E("limewash", "walls", "Vopsea decorativă cu var (limewash)", "Limewash paint", "textured limewash walls", "vopsea decorativa var", "construction", 9, "m²",
            "limewash", "var decorativ", "tencuiala venetiana", "venetian plaster", "pereti texturati", "chaux", "badigeon"),
        E("wood_panels", "walls", "Panouri riflaje lemn", "Wood slat wall panels", "vertical wood slat wall panels", "panouri riflaje lemn", "construction", 38, "m²",
            "riflaje", "lamele de lemn", "wood slat", "slatted wood", "wood paneling", "lambriu", "tasseaux", "lambris"),
        E("exposed_brick", "walls", "Placaj cărămidă aparentă", "Exposed brick cladding", "exposed brick wall", "placaj caramida aparenta", "construction", 30, "m²",
            "caramida aparenta", "caramida", "exposed brick", "brick wall", "brique", "briques"),
        E("wallpaper", "walls", "Tapet", "Wallpaper", "textured wallpaper accent wall", "tapet", "construction", 12, "m²", "tapet", "wallpaper", "papier peint"),
        E("paris_stone", "walls", "Placaj piatră de Paris", "Paris limestone cladding", "honed Paris limestone wall cladding", "piatra de paris", "construction", 95, "m²",
            "pierre de paris", "piatra de paris", "paris limestone", "pierre calcaire", "limestone"),
        // Lighting
        E("led_strip", "lighting", "Bandă LED ascunsă", "Hidden LED strip", "hidden LED strip lighting", "banda led profil aluminiu", "lighting", 14, "ml",
            "banda led", "benzi led", "led strip", "led strips", "lumina indirecta", "indirect lighting", "cove lighting", "ruban led", "eclairage indirect"),
        E("pendant", "lighting", "Lustră suspendată", "Pendant light", "statement pendant lamp", "lustra suspendata", "lighting", 120, "buc.",
            "lustra", "pendul", "pendant", "chandelier", "candelabru", "suspension", "lustre"),
        E("floor_lamp", "lighting", "Lampadar", "Floor lamp", "arc floor lamp", "lampadar", "lighting", 90, "buc.", "lampadar", "floor lamp", "lampadaire"),
        // Furniture
        E("linen_sofa", "furniture", "Canapea tapițată cu in", "Linen upholstered sofa", "linen upholstered sofa", "canapea in", "furniture", 640, "buc.",
            "canapea din in", "canapea de in", "canapea in crem", "linen sofa", "linen couch", "canape en lin", "canape lin"),
        E("velvet_sofa", "furniture", "Canapea din catifea", "Velvet sofa", "velvet sofa", "canapea catifea", "furniture", 720, "buc.",
            "canapea din catifea", "canapea catifea", "velvet sofa", "catifea", "velvet", "velours"),
        E("leather_sofa", "furniture", "Canapea din piele", "Leather sofa", "leather sofa", "canapea piele", "furniture", 980, "buc.",
            "canapea din piele", "canapea piele", "leather sofa", "leather couch", "canape en cuir", "canape cuir"),
        E("boucle", "furniture", "Fotoliu bouclé", "Bouclé armchair", "boucle armchair", "fotoliu boucle", "furniture", 340, "buc.", "boucle", "bucle", "bouclette"),
        E("rattan", "furniture", "Mobilier din ratan", "Rattan furniture", "rattan furniture", "scaun ratan", "furniture", 180, "buc.", "ratan", "rattan", "rachita", "wicker", "rotin", "osier"),
        E("dining_table", "furniture", "Masă dining lemn masiv", "Solid-wood dining table", "solid wood dining table", "masa dining lemn masiv", "furniture", 560, "buc.",
            "masa de dining", "masa dining", "masa din lemn", "dining table", "table a manger"),
        E("bookshelf", "furniture", "Bibliotecă / rafturi", "Bookshelf", "built-in bookshelves", "biblioteca rafturi", "furniture", 240, "buc.", "biblioteca", "rafturi", "bookshelf", "shelving", "bibliotheque", "etageres"),
        // Fixtures & finishes
        E("matte_black", "fixtures", "Accesorii negru mat", "Matte black fixtures", "matte black fixtures and accents", "baterie negru mat", "construction", 85, "buc.",
            "negru mat", "negre mate", "accente negre", "matte black", "black fixtures", "noir mat"),
        E("verriere", "fixtures", "Verrière atelier oțel negru", "Black steel atelier glass partition", "black steel framed glass verriere partition", "verriere atelier", "construction", 890, "buc.",
            "verriere", "verriere atelier", "steel glass partition", "perete sticla otel"),
        E("mouldings", "fixtures", "Mulaje decorative (moulures)", "Decorative plaster mouldings", "ornate plaster ceiling mouldings and cornices", "mulura decorativa", "construction", 16, "ml",
            "moulures", "moulure", "corniche", "mouldings", "cornices", "mulaje", "stucaturi"),
        E("brass", "fixtures", "Accesorii alamă", "Brass fixtures", "brushed brass details", "accesorii alama", "construction", 95, "buc.", "alama", "brass", "bronz", "auriu periat", "laiton"),
        E("quartz_top", "fixtures", "Blat cuarț", "Quartz worktop", "quartz countertop", "blat cuart", "construction", 220, "ml", "blat cuart", "cuart", "quartz"),
        // Decor
        E("plants", "decor", "Plante de interior mari", "Large indoor plants", "lush indoor plants", "plante interior mari", "furniture", 60, "buc.",
            "plante", "plants", "verdeata", "greenery", "ficus", "monstera", "plantes"),
        E("wool_rug", "decor", "Covor din lână", "Wool rug", "textured wool rug", "covor lana", "furniture", 210, "buc.", "covor", "rug", "carpet", "tapis"),
        E("linen_curtains", "decor", "Draperii din in", "Linen curtains", "sheer linen curtains", "draperii in", "furniture", 75, "buc.",
            "draperii", "perdele", "curtains", "drapes", "rideaux", "voilages", "lin naturel"),
    ];

    /// <summary>Style ids recognised in free text (most specific first).</summary>
    private static readonly (string StyleId, string[] Keywords)[] StyleKeywords =
    [
        ("minimalist_obsidian", ["obsidian", "monocrom negru", "all black", "total black"]),
        ("mid_century_modern", ["mid century", "mid-century", "retro anii 60", "anii 50", "anii 60"]),
        ("brutalist_concrete", ["brutalist", "brutal", "beton aparent", "exposed concrete"]),
        ("japandi", ["japandi", "japonez", "japanese", "wabi sabi", "wabi-sabi"]),
        ("scandinavian", ["scandinav", "nordic", "nordica", "hygge"]),
        ("industrial", ["industrial", "industriel", "loft"]),
        ("biophilic", ["biofil", "biophil", "organic", "organique", "plin de plante", "jungle"]),
        ("coastal", ["coastal", "mediteranean", "mediterranean", "mediterraneen", "marin", "beach", "plaja", "bord de mer"]),
        ("traditional", ["clasic", "classic", "classique", "parizian", "parisian", "parisien", "neoclasic", "neoclassic", "traditional", "traditionnel"]),
        ("minimalist", ["minimalist", "minimal", "monocrom", "monochrome"]),
        ("contemporary", ["contemporan", "contemporary", "contemporain"]),
        ("modern", ["modern"]),
    ];

    /// <summary>Parisian presets (explicit <c>preset</c> id in the request, or recognised in the free text).</summary>
    public static readonly IReadOnlyList<StylePreset> Presets =
    [
        new("haussmannien", "Haussmannien contemporain", "Contemporary Haussmannian", "Haussmannian contemporan", "traditional",
            "Haussmannian Parisian apartment, ornate plaster ceiling mouldings, oak point de Hongrie parquet, tall French windows, white marble fireplace, contemporary furniture",
            ["haussmann", "haussmannien", "haussmannienne", "haussmannian", "point de hongrie", "moulures"]),
        new("atelier-parisien", "Atelier parisien", "Parisian atelier", "Atelier parizian", "industrial",
            "Parisian artist atelier, black steel glass verriere partition, exposed brick, solid oak, tall factory windows, warm pendant lights",
            ["atelier parisien", "atelier-parisien", "parisian atelier", "atelier parizian", "verriere"]),
        new("rive-gauche", "Rive Gauche épuré", "Refined Rive Gauche", "Rive Gauche epurat", "contemporary",
            "Rive Gauche Parisian apartment, honed Paris limestone, natural linen upholstery, pale oak, quiet understated luxury",
            ["rive gauche", "rive-gauche", "pierre de paris", "saint-germain", "saint germain"]),
    ];

    public static StylePreset? GetPreset(string? id) =>
        string.IsNullOrWhiteSpace(id) ? null : Presets.FirstOrDefault(p => p.Id.Equals(id.Trim(), StringComparison.OrdinalIgnoreCase));

    public static StylePreset? InferPreset(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var n = Normalize(text);
        return Presets.FirstOrDefault(p => p.Keywords.Any(k => MatchesStem(n, k)));
    }

    /// <summary>Interior room types recognised in free text.</summary>
    private static readonly (string SpaceId, string[] Keywords)[] SpaceKeywords =
    [
        ("walk-in closet", ["dressing", "walk-in", "walk in closet"]),
        ("home office", ["birou", "office", "studiu", "bureau"]),
        ("master bedroom", ["dormitor", "bedroom", "chambre"]),
        ("bathroom", ["baie", "baia", "bathroom", "salle de bain", "salle de bains", "salle d eau"]),
        ("kitchen", ["bucatari", "kitchen", "cuisine"]),
        ("entryway", ["hol", "intrare", "entryway", "hallway", "entree"]),
        ("attic loft", ["mansarda", "attic", "combles", "sous les toits"]),
        ("commercial cafe", ["cafenea", "cafe", "restaurant", "bistro"]),
        ("living room", ["living", "sufragerie", "camera de zi", "salon", "lounge", "sejour"]),
    ];

    private static readonly HashSet<string> RomanianMarkers =
        ["si", "cu", "un", "o", "din", "de", "pe", "vreau", "doresc", "lumina", "pereti", "camera", "cald", "calda", "mat", "mate", "si", "fara", "accente", "naturala"];
    private static readonly HashSet<string> EnglishMarkers =
        ["and", "with", "the", "a", "an", "of", "want", "light", "walls", "room", "warm", "natural", "accents", "without", "floor"];

    /// <summary>Lower-case, diacritic-free text with collapsed whitespace — the form all keyword matching uses.</summary>
    public static string Normalize(string text) =>
        Spaces().Replace(NonWord().Replace(Js.StripDiacritics(text).ToLowerInvariant(), " "), " ").Trim();

    private static bool ContainsPhrase(string normalized, string keyword)
    {
        var k = Normalize(keyword);
        return k.Length > 0 && $" {normalized} ".Contains($" {k} ", StringComparison.Ordinal);
    }

    /// <summary>Phrase match; keywords of 5+ letters also match as a word prefix ("scandinav" → "scandinavă").</summary>
    private static bool MatchesStem(string normalized, string keyword)
    {
        var k = Normalize(keyword);
        if (k.Length == 0) return false;
        return k.Length >= 5
            ? $" {normalized}".Contains($" {k}", StringComparison.Ordinal)
            : ContainsPhrase(normalized, k);
    }

    /// <summary>Materials mentioned in the text, in lexicon order, at most one per id (and per sofa slot).</summary>
    public static IReadOnlyList<VisionMaterial> DetectMaterials(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return [];
        var n = Normalize(text);
        var found = new List<VisionMaterial>();
        foreach (var entry in Lexicon)
        {
            if (!entry.Keywords.Any(k => MatchesStem(n, k))) continue;
            // One floor and one sofa at most: "parchet în spic de stejar" is herringbone, not herringbone + oak.
            if (entry.Material.Slot == "floor" && found.Any(m => m.Slot == "floor")) continue;
            if (entry.Material.Id.EndsWith("_sofa", StringComparison.Ordinal) && found.Any(m => m.Id.EndsWith("_sofa", StringComparison.Ordinal))) continue;
            found.Add(entry.Material);
        }
        return found;
    }

    public static string? InferStyle(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var n = Normalize(text);
        foreach (var (id, keywords) in StyleKeywords)
            if (keywords.Any(k => MatchesStem(n, k)))
                return SucvarCatalog.IsKnownStyle(id) ? id : null;
        return null;
    }

    public static string? InferSpace(string mode, string? text)
    {
        if (mode != "interiors" || string.IsNullOrWhiteSpace(text)) return null;
        var n = Normalize(text);
        foreach (var (id, keywords) in SpaceKeywords)
            if (keywords.Any(k => MatchesStem(n, k)) && SucvarCatalog.IsKnownSpace(mode, id)) return id;
        return null;
    }

    /// <summary>Romanian mood / colour / material descriptors → English prompt terms (stems, diacritic-free).</summary>
    private static readonly (string Stem, string En)[] Descriptors =
    [
        ("cald", "warm"), ("calda", "warm"), ("racoros", "cool tones"), ("luminos", "bright and airy"), ("aerisit", "airy open feel"),
        ("linistit", "calm serene"), ("relaxant", "relaxing"), ("primitor", "inviting cozy"), ("confortabil", "cozy"),
        ("elegant", "elegant"), ("luxos", "luxurious"), ("lux", "luxurious"), ("rustic", "rustic"), ("boem", "bohemian"),
        ("alb", "white"), ("negru", "black"), ("gri", "grey"), ("crem", "cream"), ("bej", "beige"), ("verde", "green"),
        ("albastru", "blue"), ("teracota", "terracotta"), ("auriu", "gold"), ("lemn", "natural wood"), ("piatra", "natural stone"),
        ("beton", "concrete"), ("sticla", "glass"), ("metal", "metal"), ("textil", "soft textiles"), ("plante", "plants"),
        ("ferestre mari", "large windows"), ("tavan inalt", "high ceiling"), ("semineu", "fireplace"), ("insula", "kitchen island"),
        ("cada", "freestanding bathtub"), ("dus walk-in", "walk-in shower"), ("oglinda", "large mirror"), ("open space", "open plan"),
        // French
        ("chaleureux", "warm"), ("chaleureuse", "warm"), ("lumineux", "bright and airy"), ("lumineuse", "bright and airy"),
        ("calme", "calm serene"), ("apaisant", "calm serene"), ("cosy", "cozy"), ("douillet", "cozy"), ("raffine", "refined elegant"),
        ("luxueux", "luxurious"), ("blanc", "white"), ("noir", "black"), ("gris", "grey"), ("creme", "cream"), ("beige", "beige"),
        ("vert", "green"), ("bleu", "blue"), ("bois", "natural wood"), ("pierre", "natural stone"), ("verre", "glass"), ("acier", "steel"),
        ("cheminee", "marble fireplace"), ("hauts plafonds", "high ceiling"), ("grandes fenetres", "large windows"), ("ilot", "kitchen island"),
        ("baignoire", "freestanding bathtub"), ("miroir", "large mirror"), ("balcon", "wrought-iron balcony"), ("lin", "natural linen"),
    ];

    /// <summary>English terms for the Romanian descriptors found in the text (in order, de-duplicated).</summary>
    public static string TranslateDescriptors(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var n = Normalize(text);
        var terms = new List<string>();
        foreach (var (stem, en) in Descriptors)
            if (ContainsPhrase(n, stem) && !terms.Contains(en)) terms.Add(en);
        return string.Join(", ", terms);
    }

    /// <summary>True when the text reads as English (CLIP-based models only understand English prompts).</summary>
    public static bool LooksEnglish(string text)
    {
        if (Js.StripDiacritics(text) != text) return false;
        var words = Normalize(text).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var ro = words.Count(RomanianMarkers.Contains);
        var en = words.Count(EnglishMarkers.Contains);
        return en > ro;
    }

    /// <summary>Free text made prompt-safe: single line, no prompt-weight syntax, trimmed to the max length.</summary>
    public static string CleanCustomPrompt(string? raw)
    {
        if (raw is null) return "";
        var single = Spaces().Replace(ControlChars().Replace(raw, " "), " ").Trim();
        return PromptSyntax().Replace(single, "").Trim();
    }

    private static bool IsBlank(JsonElement? el) =>
        el is null || el.Value.ValueKind == JsonValueKind.Null || (el.Value.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(el.Value.GetString()));

    /// <summary>The style id the request names (<c>style</c> preferred over the legacy <c>styleId</c>), or null.</summary>
    public static string? RequestedStyle(JsonElement payload)
    {
        foreach (var name in new[] { "style", "styleId" })
        {
            var v = Js.AsString(Js.Prop(payload, name))?.Trim();
            if (!string.IsNullOrEmpty(v) && !v.Equals(Auto, StringComparison.OrdinalIgnoreCase)) return v;
        }
        return null;
    }

    /// <summary>
    /// Validates the flexible contract. Image checks stay in the endpoint; here: <c>customPrompt</c> length and
    /// "at least one of customPrompt or style".
    /// </summary>
    public static VisionError? Validate(JsonElement payload)
    {
        var raw = Js.Prop(payload, "customPrompt");
        if (raw is { } r && r.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
            return new("INVALID_PROMPT", "Descrierea trebuie să fie text.");
        var prompt = CleanCustomPrompt(Js.AsString(raw));
        if (prompt.Length > CustomPromptMaxLength)
            return new("PROMPT_TOO_LONG", $"Descrierea poate avea cel mult {CustomPromptMaxLength} de caractere.");
        if (Js.Prop(payload, "ergonomicConstraints") is { } ec && ec.ValueKind is not (JsonValueKind.Array or JsonValueKind.Null))
            return new("INVALID_CONSTRAINTS", "Recomandările ergonomice trebuie să fie o listă de texte.");
        // "Optimizare spațiu": a known goal is a complete intent on its own (no description or style needed)
        if (prompt.Length == 0 && RequestedStyle(payload) is null && RequestedGoal(payload) is null)
            return new("PROMPT_OR_STYLE_REQUIRED", "Descrie ce îți dorești sau alege un stil (cel puțin una dintre ele).");
        return null;
    }

    /// <summary>True when the request uses the new contract (anything beyond the legacy styleId/dimensions/ai shape).</summary>
    public static bool IsSmartRequest(JsonElement payload) =>
        !IsBlank(Js.Prop(payload, "customPrompt")) || RequestedStyle(payload) is null ||
        !IsBlank(Js.Prop(payload, "palette")) || !IsBlank(Js.Prop(payload, "lighting")) || !IsBlank(Js.Prop(payload, "preset")) ||
        Js.Prop(payload, "preserveStructure") is { ValueKind: JsonValueKind.True or JsonValueKind.False } ||
        RequestedGoal(payload) is not null || ReadConstraints(payload).Count > 0 || Is3dScanRequest(payload);

    /// <summary>
    /// "Proiect scanat 3D (LiDAR)": the source image is the Studio's perspective render of an imported 3D room scan
    /// (shaded planes + structural wireframe), not a photograph. Interiors only; any other value / mode = photo source.
    /// </summary>
    public static bool Is3dScanRequest(JsonElement payload) =>
        Js.Prop(payload, "is3dScanSource") is { ValueKind: JsonValueKind.True } &&
        (Js.AsString(Js.Prop(payload, "mode")) ?? "interiors") == "interiors";

    /// <summary>
    /// Door / window counts detected by the scan: explicit <c>doorCount</c> / <c>windowCount</c> win, else the Studio's
    /// <c>dimensions.doorsCount</c> / <c>windowsCount</c>; null when absent or not a number (0–50, rounded).
    /// </summary>
    public static (int? Doors, int? Windows) ReadOpeningCounts(JsonElement payload)
    {
        var dims = Js.IsRecord(Js.Prop(payload, "dimensions")) ? Js.Prop(payload, "dimensions") : null;
        int? Count(JsonElement? primary, JsonElement? fallback)
        {
            foreach (var el in new[] { primary, fallback })
            {
                var v = GenerationPrompt.ReadNumber(el, 0, 50, double.NaN);
                if (!double.IsNaN(v)) return (int)Math.Round(v);
            }
            return null;
        }
        return (Count(Js.Prop(payload, "doorCount"), Js.Prop(dims, "doorsCount")),
                Count(Js.Prop(payload, "windowCount"), Js.Prop(dims, "windowsCount")));
    }

    /// <summary>The known "Optimizare spațiu" goal of the request (unknown ids are ignored), or null.</summary>
    public static OptimizationGoal? RequestedGoal(JsonElement payload) =>
        SpatialErgonomicsAnalyzer.GetGoal(Js.AsString(Js.Prop(payload, "optimizationGoal")));

    /// <summary>Optional <c>ergonomicConstraints</c> (array of English rules from the Studio), sanitized.</summary>
    public static IReadOnlyList<string> ReadConstraints(JsonElement payload) =>
        Js.Prop(payload, "ergonomicConstraints") is { ValueKind: JsonValueKind.Array } arr
            ? SpatialErgonomicsAnalyzer.SanitizeConstraints(arr.EnumerateArray()
                .Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()).Take(SpatialErgonomicsAnalyzer.MaxConstraints * 2))
            : [];

    /// <summary>Builds the resolved brief: explicit values win, then inference from the text, then defaults.</summary>
    public static DesignBrief Resolve(JsonElement payload, string mode)
    {
        var customPrompt = Js.Slice(CleanCustomPrompt(Js.AsString(Js.Prop(payload, "customPrompt"))), CustomPromptMaxLength);

        var requestedStyle = RequestedStyle(payload);
        string? styleId = requestedStyle is not null ? SucvarCatalog.GetStyle(requestedStyle).Id : null;
        var styleInferred = false;
        var preset = GetPreset(Js.AsString(Js.Prop(payload, "preset"))) ?? InferPreset(customPrompt);
        if (styleId is null && preset is not null && SucvarCatalog.IsKnownStyle(preset.BaseStyleId)) { styleId = preset.BaseStyleId; styleInferred = true; }
        if (styleId is null && InferStyle(customPrompt) is { } inferred) { styleId = inferred; styleInferred = true; }

        var requestedSpace = Js.AsString(Js.Prop(payload, "roomType")) ?? Js.AsString(Js.Prop(payload, "spaceType"));
        var spaceInferred = false;
        string spaceId;
        if (!string.IsNullOrWhiteSpace(requestedSpace) && !requestedSpace.Equals(Auto, StringComparison.OrdinalIgnoreCase))
            spaceId = SucvarCatalog.GetSpace(mode, requestedSpace).Id;
        else if (InferSpace(mode, customPrompt) is { } s) { spaceId = s; spaceInferred = true; }
        else spaceId = SucvarCatalog.GetSpace(mode, null).Id;

        var scale = ResolveScale(payload);
        var area = scale.AreaSqm;
        var preserve = Js.Prop(payload, "preserveStructure") is not { ValueKind: JsonValueKind.False };

        // Space planning: the client's rules win (what the Studio showed); a goal alone gets the server's analysis
        var goal = RequestedGoal(payload);
        var constraints = ReadConstraints(payload);
        if (goal is not null && constraints.Count == 0)
            constraints = SpatialErgonomicsAnalyzer.Analyze(spaceId, scale.Length, scale.Width, scale.Height, goal.Id).PromptConstraints;

        // 3D LiDAR source: the scan IS the architecture, so the shell is always kept (the toggle cannot free it)
        var scan3d = mode == "interiors" && Is3dScanRequest(payload);
        var (doors, windows) = scan3d ? ReadOpeningCounts(payload) : (null, null);
        if (scan3d) preserve = true;

        return new DesignBrief(
            customPrompt,
            styleId,
            styleInferred,
            GetPalette(Js.AsString(Js.Prop(payload, "palette")))?.Id,
            GetLighting(Js.AsString(Js.Prop(payload, "lighting")))?.Id,
            spaceId,
            spaceInferred,
            Js.Round(area * 10) / 10,
            preserve,
            DetectMaterials(customPrompt),
            preset?.Id,
            scale,
            goal?.Id,
            constraints.Count > 0 ? constraints : null,
            scan3d,
            doors,
            windows);
    }

    /// <summary>
    /// Room size from the request: explicit <c>areaSqm</c> wins, else <c>dimensions.width × length</c>, else the
    /// default (marked unknown so no scale cue is invented). Height comes from <c>dimensions.height</c>.
    /// </summary>
    public static RoomScale ResolveScale(JsonElement payload)
    {
        var dims = Js.IsRecord(Js.Prop(payload, "dimensions")) ? Js.Prop(payload, "dimensions") : null;
        double? Dim(string name, double min, double max)
        {
            var v = GenerationPrompt.ReadNumber(Js.Prop(dims, name), min, max, double.NaN);
            return double.IsNaN(v) ? null : Math.Round(v, 2);
        }
        var width = Dim("width", 1, 100);
        var length = Dim("length", 1, 100);
        var height = Dim("height", 2, 15);
        var explicitArea = GenerationPrompt.ReadNumber(Js.Prop(payload, "areaSqm"), MinAreaSqm, MaxAreaSqm, double.NaN);
        if (!double.IsNaN(explicitArea)) return new RoomScale(length, width, height, explicitArea, true);
        if (width is { } w && length is { } l) return new RoomScale(length, width, height, w * l, true);
        return new RoomScale(length, width, height, DefaultAreaSqm, false);
    }

    /// <summary>Client-facing summary of the brief (camelCase JSON via the web serializer).</summary>
    public static object ToResponse(DesignBrief b) => new
    {
        customPrompt = b.CustomPrompt,
        styleId = b.StyleId,
        styleInferred = b.StyleInferred,
        palette = b.Palette,
        lighting = b.Lighting,
        spaceType = b.SpaceType,
        spaceInferred = b.SpaceInferred,
        areaSqm = b.AreaSqm,
        preserveStructure = b.PreserveStructure,
        preset = b.Preset,
        optimizationGoal = b.OptimizationGoal,
        ergonomicConstraints = b.ErgonomicConstraints ?? [],
        is3dScanSource = b.Is3dScanSource,
        doorCount = b.DoorCount,
        windowCount = b.WindowCount,
        dimensions = b.Scale is { } sc
            ? new { length = sc.Length, width = sc.Width, height = sc.Height, areaSqm = Js.Round(sc.AreaSqm * 10) / 10, volumeM3 = sc.Volume }
            : null,
        // What the compiler understood from the free text (element → English phrase) — shown in "Prompt optimizat AI"
        userSpecs = ArchitecturalPromptCompiler.CompileUserSpecs(b.CustomPrompt).Select(s => new { slot = s.Slot, promptEn = s.PromptEn }).ToList(),
        materials = b.Materials.Select(m => new { id = m.Id, slot = m.Slot, titleRo = m.TitleRo, titleEn = m.TitleEn }).ToList(),
    };

    [GeneratedRegex(@"[^\p{L}\p{N}\-]+")]
    private static partial Regex NonWord();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    [GeneratedRegex(@"[\p{Cc}\p{Cf}]")]
    private static partial Regex ControlChars();

    // Prompt-weighting / embedding syntax a user could use to hijack the model: (term:1.5), [term], <lora:...>
    [GeneratedRegex(@"<[^>]*>|[\[\]{}()]|:\s*\d+(\.\d+)?")]
    private static partial Regex PromptSyntax();
}
