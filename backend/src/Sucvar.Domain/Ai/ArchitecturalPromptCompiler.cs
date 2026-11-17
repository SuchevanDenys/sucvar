using System.Globalization;
using System.Text.RegularExpressions;

namespace Sucvar.Domain.Ai;

/// <summary>
/// The compiled layers of a smart brief, in English and already conflict-stripped, for the natural-language
/// instruction (<see cref="ArchitecturalPromptCompiler.Instruction"/>). Empty strings / nulls are simply omitted.
/// </summary>
public sealed record InstructionBrief(
    string Mode,
    string Space,
    bool PreserveStructure,
    IReadOnlyList<string> UserSpecs,
    string Materials,
    string ClientWords,
    string? StyleName,
    string StyleDetails,
    string Palette,
    string Lighting,
    double? AreaSqm,
    double? CeilingHeight,
    string ScaleHint,
    string Details);

/// <summary>
/// One explicit instruction from the user's free text, compiled into English: the room element it targets
/// (<c>floor</c>, <c>walls</c>, <c>sofa</c>, <c>lighting</c>…) and the photorealistic phrase sent to the model.
/// </summary>
public sealed record UserSpec(string Slot, string PromptEn);

/// <summary>Physical size of the room as the user entered it (null = not given).</summary>
public sealed record RoomScale(double? Length, double? Width, double? Height, double AreaSqm, bool AreaKnown)
{
    public double? Volume => Height is { } h && AreaKnown ? Math.Round(AreaSqm * h, 1) : null;
}

/// <summary>
/// Architectural Prompt Compiler — the deterministic "visualization director" behind the smart Studio prompt.
/// <list type="bullet">
/// <item>Parses Romanian (and English) free text clause by clause, finds the room element each clause talks about
/// and composes a precise English material phrase (<c>pereți alb cald</c> → <c>warm alabaster white matte painted walls</c>).</item>
/// <item>Classifies preset / style / palette terms by element so a style default that contradicts an explicit user
/// choice is removed before it reaches the model (the model never "fights itself").</item>
/// <item>Turns the room's real dimensions into scale cues, and owns the photography directive, the anti-artifact
/// negative prompt and the structure-preserving strength calibration.</item>
/// </list>
/// Everything here is pure and deterministic; the optional LLM step only refines its output.
/// </summary>
public static partial class ArchitecturalPromptCompiler
{
    // ── Calibration (img2img prompt_strength / denoising) ────────────────────────
    /// <summary>Sweet spot with structure locked: finishes change completely, geometry stays.</summary>
    public const double PreserveStrengthMin = 0.62, PreserveStrengthMax = 0.8, RecommendedStrength = 0.72;
    public const double RedesignStrengthMin = 0.8, RedesignStrengthMax = 0.9;
    /// <summary>Smart-path defaults when the request carries no explicit AI settings (frontend mirrors them).</summary>
    public const int SmartInferenceStepsDefault = 40;
    public const double SmartGuidanceDefault = 9;

    /// <summary>Photography layer (kept compact: CLIP reads ~75 tokens).</summary>
    public static string PhotographyDirective(string mode) => mode == "interiors"
        ? "Architectural Digest interior photo, 24mm tilt-shift lens, soft global illumination, photorealistic, sharp focus"
        : "Architectural Digest photo, 24mm tilt-shift lens, natural realistic daylight, photorealistic, sharp focus";

    /// <summary>
    /// Anti-artifact negative prompt, ordered by importance (the encoder truncates the tail). The user's own
    /// negative (when it differs from the stock default) leads; structure-violation cues follow when preserving.
    /// </summary>
    public static string NegativePrompt(string mode, bool preserveStructure, string? userNegative)
    {
        var custom = string.IsNullOrWhiteSpace(userNegative) || userNegative.Trim() == AiLimits.DefaultNegativePrompt ? "" : userNegative;
        const string core = "deformed walls, crooked perspective, extra windows, missing windows, floating furniture, CGI render, " +
                            "plastic textures, oversaturated, cartoon, blurry, watermark, text";
        const string tail = "messy clutter, lowres, distorted furniture, warped lines, duplicated objects, logo";
        var merged = GenerationPrompt.MergeTerms(custom, core,
            preserveStructure ? "moved walls, changed window positions, altered room geometry" : "",
            tail,
            mode == "interiors" ? "empty room, unfurnished" : "");
        return FitTerms(merged, AiLimits.MaxPromptTokens);
    }

    // ── Natural-language instruction (FLUX Kontext & other instruction-following editors) ──────────

    /// <summary>
    /// Builds one cohesive English editing instruction (no 72-token CLIP clipping): what to redesign, what to keep
    /// (exact geometry and camera, or a full renovation), the client's explicit requirements first and marked as the
    /// highest priority, then style, palette, lighting, real room scale, the remaining design details and the
    /// photography direction.
    /// </summary>
    public static string Instruction(InstructionBrief b)
    {
        var sentences = new List<string>
        {
            $"Redesign this {b.Space} photo into a photorealistic {Subject(b.Mode, b.Space)}" +
            (string.IsNullOrWhiteSpace(b.StyleName) ? "" : $" in {Article(b.StyleName)} {b.StyleName} style"),
            StructureInstruction(b.Mode, b.PreserveStructure),
        };

        // The client's words lead every descriptive layer: element specs (exact), extra named items, then mood words
        var specs = b.UserSpecs.Where(s => s.Length > 0).ToList();
        if (specs.Count > 0) sentences.Add($"Client requirements, highest priority, follow them exactly: {string.Join("; ", specs)}");
        if (Clean(b.Materials) is { Length: > 0 } materials) sentences.Add($"Also include {materials}");
        if (Clean(b.ClientWords) is { Length: > 0 } words) sentences.Add($"Client brief: {words}");

        // Later layers repeat nothing already said (case-insensitive, term by term)
        var seen = new HashSet<string>(specs.SelectMany(s => s.Split(',')).Select(t => t.Trim()), StringComparer.OrdinalIgnoreCase);
        void Layer(string label, string terms)
        {
            var fresh = string.Join(", ", terms.Split(',').Select(t => t.Trim()).Where(t => t.Length > 0 && seen.Add(t)));
            if (Clean(fresh) is { Length: > 0 } text) sentences.Add($"{label}: {text}");
        }
        Layer("Style details", b.StyleDetails);
        Layer("Color palette", b.Palette);
        Layer("Lighting", b.Lighting);
        if (SizeSentence(b) is { Length: > 0 } size) sentences.Add(size);
        Layer("Design details", b.Details);
        sentences.Add(PhotographyInstruction(b.Mode));

        return string.Join(" ", sentences.Select(s => s.TrimEnd(' ', ',', ';', '.') + "."));
    }

    /// <summary>Instruction for legacy (style + dimensions only) requests: the historical layers as target design.</summary>
    public static string LegacyInstruction(string mode, string space, string targetDesign) => string.Join(" ",
        new[]
        {
            $"Redesign this {space} photo into a photorealistic {Subject(mode, space)}",
            StructureInstruction(mode, preserveStructure: true),
            Clean(targetDesign) is { Length: > 0 } design ? $"Target design: {design}" : "",
            PhotographyInstruction(mode),
        }.Where(s => s.Length > 0).Select(s => s.TrimEnd(' ', ',', ';', '.') + "."));

    /// <summary>What the instruction asks the model to keep (or free) — the core of structure preservation.</summary>
    public static string StructureInstruction(string mode, bool preserveStructure) => (mode, preserveStructure) switch
    {
        ("interiors", true) => "Preserve the exact room geometry: keep the same walls, ceiling, windows, doors, room proportions and " +
                               "the same camera position, angle and perspective; change only finishes, furniture, decor and lighting",
        (_, true) => "Preserve the exact architecture and site: keep the same building volumes, rooflines, windows, doors, terrain and " +
                     "the same camera position, angle and perspective; change only materials, planting, outdoor furniture and lighting",
        ("interiors", false) => "Perform a full architectural renovation: the layout, partitions, built-in joinery, ceiling design and openings " +
                                "may be reworked, while keeping the same camera viewpoint for a direct before and after comparison",
        _ => "Perform a full architectural renovation: facades, hardscape, planting and layout may be redesigned, " +
             "while keeping the same camera viewpoint for a direct before and after comparison",
    };

    /// <summary>Photography direction in prose (the CLIP tail's natural-language twin).</summary>
    public static string PhotographyInstruction(string mode) => mode == "interiors"
        ? "Photograph it like an Architectural Digest interior: 24mm tilt-shift lens, straight vertical lines, soft global illumination, " +
          "true-to-life materials and textures, realistic proportions, sharp focus, no text, logos or watermarks"
        : "Photograph it like an Architectural Digest feature: 24mm tilt-shift lens, straight vertical lines, natural realistic daylight, " +
          "true-to-life materials and textures, realistic proportions, sharp focus, no text, logos or watermarks";

    private static string Subject(string mode, string space) => mode switch
    {
        "interiors" => $"fully furnished {space} interior",
        "gardens" => $"landscaped {space}",
        _ => space,
    };

    private static string Article(string word) => "aeiouAEIOU".Contains(word[0]) ? "an" : "a";

    private static string SizeSentence(InstructionBrief b)
    {
        var parts = new List<string>();
        if (b.AreaSqm is { } a) parts.Add($"about {a.ToString("0.#", CultureInfo.InvariantCulture)} m²");
        if (b.Mode == "interiors" && b.CeilingHeight is { } h) parts.Add($"{h.ToString("0.00", CultureInfo.InvariantCulture)} m ceiling height");
        if (parts.Count == 0 && b.ScaleHint.Length == 0) return "";
        var label = b.Mode == "interiors" ? "Room size" : "Site size";
        var size = parts.Count > 0 ? $"{label}: {string.Join(", ", parts)}" : label;
        return b.ScaleHint.Length > 0 ? $"{size}; scale everything accordingly ({b.ScaleHint})" : $"{size}; scale everything accordingly";
    }

    private static string Clean(string? text) => Spaces().Replace(text ?? "", " ").Trim().Trim(',', ';', '.', ' ');

    /// <summary>Clamps the requested strength into the calibrated band for the structure mode.</summary>
    public static double CalibrateStrength(double requested, bool preserveStructure) => preserveStructure
        ? Math.Clamp(Math.Round(requested, 2), PreserveStrengthMin, PreserveStrengthMax)
        : Math.Clamp(Math.Round(requested, 2), RedesignStrengthMin, RedesignStrengthMax);

    // ── Scale-aware spatial cues ─────────────────────────────────────────────────

    /// <summary>English scale cues from the room's area and ceiling height ("" when the size is unknown).</summary>
    public static string ScaleHint(RoomScale? scale, string mode)
    {
        if (scale is null) return "";
        var terms = new List<string>();
        if (scale.AreaKnown)
        {
            var a = scale.AreaSqm;
            if (mode == "interiors")
            {
                terms.Add(a switch
                {
                    < 9 => "tiny room, slim space-saving furniture",
                    < 15 => "small apartment room, space-saving furniture",
                    < 25 => "medium-sized room, apartment-scale furniture",
                    < 40 => "spacious room, generous furniture",
                    _ => "large open-plan space",
                });
            }
            else if (mode == "gardens")
            {
                terms.Add(a switch { < 40 => "small urban garden", < 150 => "medium-sized garden", _ => "large landscaped garden" });
            }
        }
        if (mode == "interiors" && scale.Height is { } h)
        {
            if (h < 2.5) terms.Add("low ceiling, low-profile furniture");
            else if (h >= 3.6) terms.Add("double-height ceiling");
            else if (h >= 3.0) terms.Add("high ceiling");
        }
        return string.Join(", ", terms);
    }

    // ── RO → EN lexicon ───────────────────────────────────────────────────────────
    // Keys are lower-case and diacritic-free (DesignVision.Normalize form). Longest phrase wins.

    private sealed record ElementDef(string Slot, string[] Keywords);

    /// <summary>Room elements a clause can target (RO + EN). "light" alone is excluded on purpose ("light oak").</summary>
    private static readonly ElementDef[] Elements =
    [
        new("floor", ["pardoseala", "pardoseli", "pardoseala", "podea", "podeaua", "parchet", "parchetul", "gresie", "gresia", "dusumea",
            "floor", "floors", "flooring", "parquet"]),
        new("walls", ["pereti", "peretii", "perete", "peretele", "zid", "ziduri", "zidurile", "walls", "wall"]),
        new("ceiling", ["tavan", "tavanul", "plafon", "ceiling"]),
        new("sofa", ["canapea", "canapeaua", "canapele", "coltar", "coltarul", "sofa", "couch"]),
        new("armchair", ["fotoliu", "fotolii", "fotoliul", "armchair", "armchairs"]),
        new("bed", ["pat", "patul", "bed"]),
        new("cabinets", ["mobilier de bucatarie", "mobilier bucatarie", "mobila de bucatarie", "dulapuri", "dulapurile", "corpuri", "fronturi",
            "cabinets", "cabinetry"]),
        new("vanity", ["mobilier baie", "mobilier de baie", "lavoar", "vanity"]),
        new("countertop", ["blat", "blatul", "countertop", "worktop"]),
        new("tiles", ["faianta", "faianta baie", "wall tiles"]),
        new("curtains", ["draperii", "draperiile", "perdele", "perdelele", "curtains", "drapes"]),
        new("rug", ["covor", "covorul", "covoare", "rug", "carpet"]),
        new("coffee_table", ["masuta", "masuta de cafea", "coffee table"]),
        new("table", ["masa", "masa de dining", "masa dining", "dining table"]),
        new("chairs", ["scaune", "scaunele", "scaun", "chairs"]),
        new("doors", ["usi", "usile", "usa", "doors"]),
        new("lighting", ["lumina", "lumini", "luminile", "iluminat", "iluminatul", "iluminare", "lighting", "lights"]),
        new("furniture", ["mobilier", "mobilierul", "mobila", "furniture"]),
    ];

    private static readonly (string Key, string En)[] Colors =
    [
        ("alb cald", "warm alabaster white"), ("alba calda", "warm alabaster white"), ("albi calzi", "warm alabaster white"), ("albe calde", "warm alabaster white"),
        ("alb rece", "crisp cool white"), ("alb pur", "pure white"), ("alb", "soft white"), ("alba", "soft white"), ("albi", "soft white"), ("albe", "soft white"),
        ("ivoire", "ivory"), ("ivoriu", "ivory"), ("fildes", "ivory"), ("crem", "cream"), ("bej", "warm beige"), ("nisip", "sand beige"), ("nisipiu", "sand beige"),
        ("grej", "greige"), ("taupe", "taupe"), ("gri deschis", "light dove grey"), ("gri inchis", "charcoal grey"), ("gri antracit", "anthracite grey"),
        ("antracit", "anthracite grey"), ("gri", "warm grey"), ("negru", "black"), ("neagra", "black"), ("negre", "black"), ("negri", "black"),
        ("bordo", "deep bordeaux"), ("bordeaux", "deep bordeaux"), ("visiniu", "deep bordeaux"), ("grena", "deep bordeaux"), ("rosu", "deep red"), ("rosie", "deep red"),
        ("teracota", "terracotta"), ("caramiziu", "terracotta"), ("maro", "chocolate brown"), ("ciocolatiu", "chocolate brown"), ("coniac", "cognac"),
        ("caramel", "caramel"), ("verde salvie", "sage green"), ("salvie", "sage green"), ("verde smarald", "emerald green"), ("smarald", "emerald green"),
        ("verde masliniu", "olive green"), ("masliniu", "olive green"), ("oliv", "olive green"), ("verde inchis", "deep forest green"), ("verde", "green"),
        ("bleumarin", "navy blue"), ("albastru navy", "navy blue"), ("albastru petrol", "teal blue"), ("petrol", "teal blue"), ("albastru deschis", "pale sky blue"),
        ("bleu", "pale sky blue"), ("albastru", "blue"), ("turcoaz", "turquoise"), ("galben mustar", "mustard yellow"), ("mustar", "mustard yellow"),
        ("galben", "yellow"), ("roz pudrat", "dusty pink"), ("roz prafuit", "dusty pink"), ("roz", "blush pink"), ("lavanda", "lavender"), ("mov", "lavender"),
        ("auriu", "gold"), ("argintiu", "silver"),
    ];

    private enum Kind { Wood, Stone, Ceramic, Textile, Other }

    private static readonly (string Key, string En, Kind Kind)[] Materials =
    [
        ("stejar", "white oak", Kind.Wood), ("oak", "white oak", Kind.Wood), ("nuc", "walnut", Kind.Wood), ("walnut", "walnut", Kind.Wood),
        ("frasin", "ash wood", Kind.Wood), ("fag", "beech", Kind.Wood), ("pin", "pine", Kind.Wood), ("tec", "teak", Kind.Wood), ("cires", "cherry wood", Kind.Wood),
        ("bambus", "bamboo", Kind.Wood), ("lemn masiv", "solid wood", Kind.Wood), ("lemn", "natural wood", Kind.Wood),
        ("marmura", "polished marble", Kind.Stone), ("travertin", "honed travertine", Kind.Stone), ("granit", "granite", Kind.Stone),
        ("piatra naturala", "natural stone", Kind.Stone), ("piatra", "natural stone", Kind.Stone), ("cuart", "quartz", Kind.Stone),
        ("terrazzo", "terrazzo", Kind.Stone), ("teraco", "terrazzo", Kind.Stone), ("microciment", "seamless microcement", Kind.Stone),
        ("beton aparent", "exposed concrete", Kind.Stone), ("beton", "polished concrete", Kind.Stone),
        ("gresie portelanata", "large-format porcelain tile", Kind.Ceramic), ("gresie", "large-format porcelain tile", Kind.Ceramic),
        ("faianta", "glazed ceramic tile", Kind.Ceramic), ("mozaic", "mosaic tile", Kind.Ceramic), ("laminat", "laminate", Kind.Wood),
        ("vinil", "luxury vinyl plank", Kind.Wood), ("spc", "luxury vinyl plank", Kind.Wood),
        ("catifea", "velvet", Kind.Textile), ("din in", "natural linen", Kind.Textile), ("de in", "natural linen", Kind.Textile),
        ("in natural", "natural linen", Kind.Textile), ("piele", "leather", Kind.Textile), ("boucle", "boucle", Kind.Textile), ("bucle", "boucle", Kind.Textile),
        ("lana", "wool", Kind.Textile), ("bumbac", "cotton", Kind.Textile), ("matase", "silk", Kind.Textile), ("iuta", "jute", Kind.Textile),
        ("ratan", "rattan", Kind.Other), ("rachita", "wicker", Kind.Other), ("tapet", "wallpaper", Kind.Other),
        ("var", "limewash", Kind.Other), ("limewash", "limewash", Kind.Other), ("tencuiala decorativa", "venetian plaster", Kind.Other),
        ("tencuiala venetiana", "venetian plaster", Kind.Other), ("riflaje", "vertical wood slat", Kind.Wood),
        ("alama", "brushed brass", Kind.Other), ("cupru", "copper", Kind.Other), ("crom", "polished chrome", Kind.Other),
        ("inox", "brushed stainless steel", Kind.Other), ("fier forjat", "wrought iron", Kind.Other), ("otel", "blackened steel", Kind.Other),
        ("sticla", "glass", Kind.Other), ("lacuit", "lacquered", Kind.Other),
    ];

    private static readonly (string Key, string En)[] Finishes =
    [
        ("mat", "matte"), ("mata", "matte"), ("mate", "matte"), ("lucios", "high-gloss"), ("lucioasa", "high-gloss"), ("lucioase", "high-gloss"),
        ("satinat", "satin"), ("satinata", "satin"), ("periat", "brushed"), ("periata", "brushed"), ("texturat", "textured"), ("texturata", "textured"),
        ("natur", "natural"), ("naturala", "natural"), ("deschis", "light"), ("inchis", "dark"), ("decapat", "whitewashed"), ("afumat", "smoked"),
        ("uleiat", "oiled"), ("slefuit", "honed"),
    ];

    private static readonly (string Key, string En)[] Patterns =
    [
        ("in spic", "herringbone"), ("herringbone", "herringbone"), ("chevron", "chevron"), ("point de hongrie", "chevron"), ("in diagonala", "diagonal"),
    ];

    // ── Clause parser ────────────────────────────────────────────────────────────

    /// <summary>
    /// Compiles the explicit element instructions found in the text (one per clause), in the order written.
    /// Clauses with no element yield nothing here (their mood words go through <see cref="DesignVision.TranslateDescriptors"/>).
    /// </summary>
    public static IReadOnlyList<UserSpec> CompileUserSpecs(string? text) =>
        string.IsNullOrWhiteSpace(text) ? [] : SplitClauses(text).Select(CompileClause).OfType<UserSpec>()
            .GroupBy(s => s.Slot).Select(g => g.First()).ToList();

    /// <summary>The elements the user explicitly talks about (RO or EN), used for conflict resolution.</summary>
    public static IReadOnlySet<string> ExplicitSlots(string? text)
    {
        var slots = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(text)) return slots;
        foreach (var clause in SplitClauses(text))
            if (FindElement(clause) is { } el) slots.Add(el.Slot);
        return slots;
    }

    /// <summary>Clauses without any recognised element (mood / style words such as "living minimalist cald").</summary>
    public static string FreeClauses(string? text) =>
        string.IsNullOrWhiteSpace(text) ? "" : string.Join(", ", SplitClauses(text).Where(c => FindElement(c) is null));

    /// <summary>Normalised clauses: split on punctuation and on the connectors și / plus / iar / cu / and / with.</summary>
    public static IReadOnlyList<string> SplitClauses(string text)
    {
        var flat = Js.StripDiacritics(text).ToLowerInvariant();
        return ClauseSplit().Split(flat)
            .Select(DesignVision.Normalize)
            .Where(c => c.Length > 0)
            .ToList();
    }

    private static int IndexOfPhrase(string clause, string key)
    {
        var i = $" {clause} ".IndexOf($" {key} ", StringComparison.Ordinal);
        return i; // index in the padded clause (−1 = absent)
    }

    private static ElementDef? FindElement(string clause)
    {
        ElementDef? best = null;
        int bestPos = int.MaxValue, bestLen = 0;
        foreach (var el in Elements)
        foreach (var k in el.Keywords)
        {
            var pos = IndexOfPhrase(clause, k);
            if (pos < 0) continue;
            if (pos < bestPos || (pos == bestPos && k.Length > bestLen)) { best = el; bestPos = pos; bestLen = k.Length; }
        }
        return best;
    }

    /// <summary>Longest-key-first lookup of every match; consumed spans are blanked so "alb cald" is not also "alb".</summary>
    private static List<T> MatchAll<T>(ref string clause, IEnumerable<(string Key, T Value)> table)
    {
        var found = new List<(int Pos, T Value)>();
        foreach (var (key, value) in table.OrderByDescending(t => t.Key.Length))
        {
            var padded = $" {clause} ";
            var pos = padded.IndexOf($" {key} ", StringComparison.Ordinal);
            if (pos < 0) continue;
            found.Add((pos, value));
            clause = (padded[..(pos + 1)] + new string('_', key.Length) + padded[(pos + 1 + key.Length)..]).Trim();
        }
        return found.OrderBy(f => f.Pos).Select(f => f.Value).ToList();
    }

    private static UserSpec? CompileClause(string clause)
    {
        var element = FindElement(clause);
        if (element is null) return null;
        var rest = clause;
        var patterns = MatchAll(ref rest, Patterns.Select(p => (p.Key, p.En)));
        var materials = MatchAll(ref rest, Materials.Select(m => (m.Key, (m.En, m.Kind))));
        var colors = MatchAll(ref rest, Colors.Select(c => (c.Key, c.En))).Distinct().Take(2).ToList();
        var finishes = MatchAll(ref rest, Finishes.Select(f => (f.Key, f.En))).Distinct().ToList();
        // "parchet" names both the element and a wood floor; "gresie" both the element and porcelain tiles
        var isParquet = IndexOfPhrase(clause, "parchet") >= 0 || IndexOfPhrase(clause, "parchetul") >= 0 || IndexOfPhrase(clause, "parquet") >= 0;

        var color = string.Join(" and ", colors);
        var finish = string.Join(" ", finishes);
        var material = materials.Count > 0 ? materials[0].Item1 : "";
        var kind = materials.Count > 0 ? materials[0].Item2 : Kind.Other;
        var pattern = patterns.FirstOrDefault() ?? "";

        string phrase = element.Slot switch
        {
            "floor" => Floor(finish, color, material, kind, pattern, isParquet),
            "walls" => Join(color, finish.Length > 0 ? finish : (material.Length == 0 ? "matte" : ""), material, "walls"),
            "ceiling" => Join(finish, color, material, "ceiling"),
            "sofa" => Join(finish, color, material.Length > 0 ? material : "", "upholstered sofa"),
            "armchair" => Join(finish, color, material, "armchair"),
            "bed" => Join(finish, color, material, "upholstered bed"),
            "cabinets" => Join(finish.Length > 0 ? finish : "matte", color, material, "kitchen cabinetry"),
            "vanity" => Join(finish, color, material, "bathroom vanity"),
            "countertop" => Join(finish, color, material, "countertop"),
            "tiles" => Join(finish, color, material.Length > 0 ? material : "glazed ceramic", "wall tiles"),
            "curtains" => Join(color, material.Length > 0 ? material : "sheer", "curtains"),
            "rug" => Join(color, material, "textured rug"),
            "coffee_table" => Join(finish, color, material, "coffee table"),
            "table" => Join(finish, color, material, "dining table"),
            "chairs" => Join(finish, color, material, "chairs"),
            "doors" => Join(finish, color, material, "interior doors"),
            "lighting" => Lighting(clause),
            _ => Join(finish, color, material, FurnitureNoun(clause)),
        };
        // An element with no modifier at all ("canapea") adds nothing the scene does not already imply.
        var hasModifier = color.Length > 0 || finish.Length > 0 || material.Length > 0 || pattern.Length > 0 || isParquet ||
                          element.Slot == "lighting" || (element.Slot == "furniture" && phrase != "furniture");
        return hasModifier && phrase.Length > 0 ? new UserSpec(element.Slot, phrase) : null;
    }

    private static string Floor(string finish, string color, string material, Kind kind, string pattern, bool isParquet)
    {
        if (material.Length == 0 && isParquet) { material = "natural oak"; kind = Kind.Wood; }
        if (kind == Kind.Wood && material.Length > 0)
        {
            // Always state a sheen: unspecified wood renders as glossy lacquer in most diffusion models
            var f = finish.Length == 0 ? "natural matte"
                : SheenWord().IsMatch(finish) ? finish : $"{finish} matte";
            return pattern.Length > 0
                ? Join(f, color, material, $"{pattern} parquet flooring")
                : Join(f, color, material, "plank flooring");
        }
        return Join(finish, color, material.Length > 0 ? material : "", pattern.Length > 0 ? $"{pattern} pattern" : "", "flooring");
    }

    /// <summary>"lumină caldă" → "warm 3000K indirect architectural lighting"; "lumină naturală" → "abundant natural daylight".</summary>
    private static string Lighting(string clause)
    {
        bool Has(params string[] keys) => keys.Any(k => IndexOfPhrase(clause, k) >= 0);
        var warm = Has("calda", "cald", "calde", "warm");
        var cool = Has("rece", "reci", "cool");
        if (Has("naturala", "natural", "naturale", "zi", "daylight"))
            return warm ? "warm natural daylight" : "abundant natural daylight";
        var temp = warm ? "warm 3000K" : cool ? "cool 4000K" : Has("neutra", "neutral") ? "neutral 3500K" : "";
        var quality = Has("indirecta", "ascunsa", "ascunse", "indirect", "hidden") ? "indirect cove"
            : Has("difuza", "diffuse", "diffused") ? "soft diffused"
            : Has("ambientala", "ambient") ? "soft ambient"
            : Has("puternica", "multa", "bright") ? "bright even"
            : Has("dramatica", "dramatic") ? "dramatic accent"
            : Has("spoturi", "spots", "spotlights") ? "recessed spotlight" : "indirect architectural";
        return Join(temp, quality == "indirect architectural" && temp.Length > 0 ? "indirect" : quality, "lighting");
    }

    private static string FurnitureNoun(string clause)
    {
        foreach (var (k, en) in new[] { ("minimalist", "minimalist"), ("modern", "modern"), ("scandinav", "Scandinavian"), ("vintage", "vintage"), ("clasic", "classic"), ("low profile", "low-profile") })
            if (IndexOfPhrase(clause, k) >= 0) return $"{en} furniture";
        return "furniture";
    }

    private static string Join(params string[] parts) =>
        Spaces().Replace(string.Join(" ", parts.Where(p => p.Length > 0)), " ").Trim();

    // ── Conflict resolution ──────────────────────────────────────────────────────

    /// <summary>The element slots a model-facing English term describes (empty = slot-neutral, always kept).</summary>
    public static IReadOnlySet<string> TermSlots(string term)
    {
        var t = term.ToLowerInvariant();
        var slots = new HashSet<string>(StringComparer.Ordinal);
        if (FloorTerm().IsMatch(t)) slots.Add("floor");
        if (WallTerm().IsMatch(t)) slots.Add("walls");
        if (SurfacesTerm().IsMatch(t)) { slots.Add("floor"); slots.Add("walls"); }
        if (CeilingTerm().IsMatch(t)) slots.Add("ceiling");
        if (SofaTerm().IsMatch(t)) { slots.Add("sofa"); slots.Add("armchair"); }
        if (LightTerm().IsMatch(t)) slots.Add("lighting");
        if (CountertopTerm().IsMatch(t)) slots.Add("countertop");
        if (CabinetTerm().IsMatch(t)) slots.Add("cabinets");
        if (CurtainTerm().IsMatch(t)) slots.Add("curtains");
        if (RugTerm().IsMatch(t)) slots.Add("rug");
        return slots;
    }

    /// <summary>
    /// Removes from a non-user prompt layer (preset, style, palette, budget…) every term describing an element
    /// the user specified explicitly — e.g. "polished microcement floor" from Industrial when the user asked for oak.
    /// </summary>
    public static string StripConflicts(string segment, IReadOnlySet<string> userSlots)
    {
        if (userSlots.Count == 0 || string.IsNullOrWhiteSpace(segment)) return segment;
        return string.Join(", ", segment.Split(',').Select(t => t.Trim())
            .Where(t => t.Length > 0 && !TermSlots(t).Overlaps(userSlots)));
    }

    /// <summary>Keeps whole terms from the front until the token budget is used.</summary>
    public static string FitTerms(string terms, int maxTokens)
    {
        var kept = new List<string>();
        foreach (var term in terms.Split(',').Select(t => t.Trim()).Where(t => t.Length > 0))
        {
            var candidate = string.Join(", ", kept.Append(term));
            if (GenerationPrompt.EstimateTokens(candidate) > maxTokens) break;
            kept.Add(term);
        }
        return string.Join(", ", kept);
    }

    // ":" is not a separator: the Studio writes element refinements as "pereți: verde salvie mat".
    [GeneratedRegex(@"[,;.!?\n\r]+|\s+(?:si|plus|iar|cu|and|with)\s+")]
    private static partial Regex ClauseSplit();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
    [GeneratedRegex(@"\b(matte|gloss|high-gloss|satin|oiled|honed|brushed)\b")]
    private static partial Regex SheenWord();
    [GeneratedRegex(@"\b(floor|floors|flooring|parquet|planks?)\b")]
    private static partial Regex FloorTerm();
    [GeneratedRegex(@"\b(walls?|wainscoting|plaster|wallpaper|paneling|panels|cladding|brick)\b")]
    private static partial Regex WallTerm();
    [GeneratedRegex(@"\bsurfaces\b")]
    private static partial Regex SurfacesTerm();
    [GeneratedRegex(@"\b(ceilings?|cornices|beams|mouldings)\b")]
    private static partial Regex CeilingTerm();
    [GeneratedRegex(@"\b(sofa|couch|upholstery|upholstered|leather)\b")]
    private static partial Regex SofaTerm();
    // "light" counts only as the last word ("soft diffused light"), never as "light oak" / "light airy palette"
    [GeneratedRegex(@"\b(lighting|lights|glow|sconces?|lamps?|daylight|sunlight|\d{4}k)\b|\blight$")]
    private static partial Regex LightTerm();
    [GeneratedRegex(@"\b(countertops?|worktops?)\b")]
    private static partial Regex CountertopTerm();
    [GeneratedRegex(@"\b(cabinetry|cabinets)\b")]
    private static partial Regex CabinetTerm();
    [GeneratedRegex(@"\b(curtains?|drapery|drapes)\b")]
    private static partial Regex CurtainTerm();
    [GeneratedRegex(@"\b(rugs?|carpets?)\b")]
    private static partial Regex RugTerm();
}
