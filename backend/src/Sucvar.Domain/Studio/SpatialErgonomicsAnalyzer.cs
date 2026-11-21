using System.Globalization;

namespace Sucvar.Domain.Studio;

/// <summary>One of the four "Optimizare spațiu" presets (ids are the API contract, mirrored in the frontend).</summary>
public sealed record OptimizationGoal(string Id, string LabelRo, string LabelEn, string InstructionEn, string ClipEn);

/// <summary>One tailored recommendation: Romanian / English text for the Studio and the English rule sent to the model.</summary>
public sealed record ErgonomicRecommendation(string Id, string Ro, string En, string PromptEn);

/// <summary>Deterministic ergonomic analysis of one room (zero AI cost).</summary>
/// <param name="SpaceType">Catalog space id the rules were chosen for.</param>
/// <param name="LengthM">Long side (m).</param>
/// <param name="WidthM">Short side (m).</param>
/// <param name="HeightM">Ceiling height (m).</param>
/// <param name="AreaSqm">Floor area (m²).</param>
/// <param name="VolumeM3">Room volume (m³).</param>
/// <param name="Goal">Optimization goal id, or null.</param>
/// <param name="Recommendations">3–4 tailored recommendations.</param>
/// <param name="DimensionsAssumed">True when at least one dimension came from the room type's default.</param>
/// <param name="MinFurnitureSqm">30 % of the floor area — the lower bound of a balanced furniture footprint.</param>
/// <param name="MaxFurnitureSqm">35 % of the floor area — never exceed it, or circulation suffers.</param>
/// <param name="MinFreeSqm">Free circulation floor at the maximum footprint (65 %).</param>
/// <param name="MaxFreeSqm">Free circulation floor at the minimum footprint (70 %).</param>
/// <param name="WalkwayMinCm">Recommended minimum clear walkway width.</param>
/// <param name="WalkwayMaxCm">Comfortable walkway width.</param>
/// <param name="HighTraffic">Kitchen, entryway, café: the 90 cm rule applies.</param>
public sealed record ErgonomicReport(
    string SpaceType,
    double LengthM,
    double WidthM,
    double HeightM,
    bool DimensionsAssumed,
    double AreaSqm,
    double VolumeM3,
    double MinFurnitureSqm,
    double MaxFurnitureSqm,
    double MinFreeSqm,
    double MaxFreeSqm,
    int WalkwayMinCm,
    int WalkwayMaxCm,
    bool HighTraffic,
    string? Goal,
    IReadOnlyList<ErgonomicRecommendation> Recommendations)
{
    /// <summary>The English rules the prompt compiler receives (footprint, walkway, then each recommendation).</summary>
    public IReadOnlyList<string> PromptConstraints =>
    [
        $"keep the total furniture footprint within 30-35% of the {Fmt(AreaSqm)} m² floor (at most {Fmt(MaxFurnitureSqm)} m²), " +
        $"leaving about {Fmt(MinFreeSqm)} m² of free circulation floor",
        $"keep clear walkways at least {WalkwayMinCm} cm wide between furniture, doors and windows",
        .. Recommendations.Select(r => r.PromptEn),
    ];

    private static string Fmt(double v) => v.ToString("0.#", CultureInfo.InvariantCulture);
}

/// <summary>
/// Architectural ergonomics calculator behind "Optimizare spațiu" / "Analiză ergonomică": real space-planning
/// rules (30–35 % furniture footprint, 75–85 cm walkways, 90 cm in high-traffic rooms) and 3–4 recommendations
/// tailored to the actual dimensions, room type and goal. Pure and deterministic; the frontend mirrors it in
/// <c>app/lib/studio/ergonomics.ts</c> for instant feedback (same rules, same thresholds).
/// </summary>
public static class SpatialErgonomicsAnalyzer
{
    public const double FurnitureRatioMin = 0.30, FurnitureRatioMax = 0.35;
    public const int MaxRecommendations = 4;
    public const int MaxConstraints = 8, MaxConstraintLength = 220;

    public static readonly IReadOnlyList<OptimizationGoal> Goals =
    [
        new("spaciousness", "Senzație de spațiu (Cameră mică)", "Sense of space (small room)",
            "make the room feel larger and airier: compact, wall-mounted and legged furniture, light-reflecting surfaces, " +
            "visual openness and an uncluttered floor",
            "space-saving wall-mounted furniture, uncluttered open floor, light reflective surfaces"),
        new("storage", "Depozitare maximă", "Maximum storage",
            "maximize storage without crowding the room: floor-to-ceiling built-in cabinetry, hidden storage and " +
            "multifunctional furniture with flush handle-less fronts",
            "floor-to-ceiling built-in cabinetry, hidden storage, multifunctional furniture"),
        new("home_office", "Colț Home Office", "Home office corner",
            "integrate an ergonomic home office corner: a desk placed near the window for natural side light, " +
            "acoustic and visual zoning from the rest of the room, cable-free minimalism",
            "ergonomic desk by the window, zoned home office corner, cable-free minimal workspace"),
        new("circulation", "Flux de circulație aerisit", "Airy circulation flow",
            "create an airy circulation flow: clear central walkways, balanced furniture zoning along the walls and " +
            "unobstructed access to every window and door",
            "clear central walkway, balanced furniture zoning, unobstructed windows and doors"),
    ];

    public static OptimizationGoal? GetGoal(string? id) =>
        string.IsNullOrWhiteSpace(id) ? null : Goals.FirstOrDefault(g => g.Id == id.Trim());

    /// <summary>Typical Romanian-apartment dimensions (length × width × height, m) per room type.</summary>
    public static (double Length, double Width, double Height) DefaultDimensions(string? spaceType) => spaceType switch
    {
        "kitchen" => (4.0, 3.0, 2.6),
        "master bedroom" => (4.2, 3.5, 2.6),
        "bathroom" => (2.6, 2.0, 2.5),
        "home office" => (3.5, 3.0, 2.6),
        "entryway" => (3.0, 1.6, 2.6),
        "attic loft" => (6.0, 4.5, 2.4),
        "walk-in closet" => (2.5, 2.0, 2.5),
        "commercial cafe" => (10.0, 7.0, 3.2),
        _ => (5.0, 4.0, 2.65), // living room / unknown
    };

    private static bool IsHighTraffic(string space) => space is "kitchen" or "entryway" or "commercial cafe";

    /// <summary>Analyzes a room; null or non-positive dimensions fall back to the room type's defaults.</summary>
    public static ErgonomicReport Analyze(string? spaceType, double? lengthM, double? widthM, double? heightM, string? goalId = null)
    {
        var space = string.IsNullOrWhiteSpace(spaceType) ? "living room" : spaceType.Trim();
        var defaults = DefaultDimensions(space);
        static double? Valid(double? v, double min, double max) => v is { } x && double.IsFinite(x) && x > 0 ? Math.Clamp(x, min, max) : null;
        var l = Valid(lengthM, 1, 100);
        var w = Valid(widthM, 1, 100);
        var h = Valid(heightM, 2, 15);
        var assumed = l is null || w is null || h is null;
        double length = l ?? defaults.Length, width = w ?? defaults.Width, height = h ?? defaults.Height;
        // The short side is the "width" for every rule (a 3 × 5 room and a 5 × 3 room plan the same)
        if (width > length) (length, width) = (width, length);

        var area = Round(length * width, 2);
        var volume = Round(area * height, 2);
        var highTraffic = IsHighTraffic(space);
        var goal = GetGoal(goalId);
        var (walkMin, walkMax) = highTraffic ? (90, 100) : goal?.Id == "circulation" ? (85, 90) : (75, 85);

        var report = new ErgonomicReport(
            space, Round(length, 2), Round(width, 2), Round(height, 2), assumed, area, volume,
            MinFurnitureSqm: Round(area * FurnitureRatioMin, 1),
            MaxFurnitureSqm: Round(area * FurnitureRatioMax, 1),
            MinFreeSqm: Round(area * (1 - FurnitureRatioMax), 1),
            MaxFreeSqm: Round(area * (1 - FurnitureRatioMin), 1),
            walkMin, walkMax, highTraffic, goal?.Id, []);
        return report with { Recommendations = Recommend(report, goal) };
    }

    /// <summary>
    /// 3–4 recommendations: the goal's own rule first, then room-type rules, then the dimension-driven rules
    /// (narrow width, tall / low ceiling, small / large floor). Duplicates by id are skipped.
    /// </summary>
    private static IReadOnlyList<ErgonomicRecommendation> Recommend(ErgonomicReport r, OptimizationGoal? goal)
    {
        var list = new List<ErgonomicRecommendation>();
        void Add(ErgonomicRecommendation rec)
        {
            if (list.Count < MaxRecommendations && list.All(x => x.Id != rec.Id)) list.Add(rec);
        }
        var cm = r.WalkwayMinCm.ToString(CultureInfo.InvariantCulture);
        var longWall = r.LengthM.ToString("0.0#", CultureInfo.InvariantCulture);

        // 1. Goal
        switch (goal?.Id)
        {
            case "spaciousness":
                Add(new("goal_spaciousness",
                    "Mobilier suspendat sau pe picioare subțiri și o oglindă mare pe peretele opus ferestrei — podeaua vizibilă mărește optic camera.",
                    "Wall-mounted or slim-legged furniture and a large mirror opposite the window — visible floor makes the room look larger.",
                    "use wall-mounted and slim-legged furniture with visible floor beneath, and a large mirror opposite the window"));
                break;
            case "storage":
                Add(new("goal_storage",
                    $"Corpuri încastrate până în tavan pe peretele lung ({longWall} m), adâncime 35–60 cm, cu fronturi plane fără mânere.",
                    $"Floor-to-ceiling built-ins along the long wall ({longWall} m), 35–60 cm deep, with flat handle-less fronts.",
                    $"add floor-to-ceiling built-in cabinetry 35-60 cm deep along the {longWall} m long wall with flat handle-less fronts"));
                break;
            case "home_office":
                Add(new("goal_home_office",
                    "Birou de min. 120 × 60 cm perpendicular pe fereastră (lumină laterală, fără reflexii pe ecran), separat vizual cu un raft deschis.",
                    "A desk of at least 120 × 60 cm perpendicular to the window (side light, no screen glare), zoned with an open shelf.",
                    "place a desk of at least 120 x 60 cm perpendicular to the window for side light, zoned off with an open shelving unit"));
                break;
            case "circulation":
                Add(new("goal_circulation",
                    $"Traseu liber de {cm} cm de la ușă la fereastră; mobilierul se grupează pe zone, lângă pereți, fără a bloca golurile.",
                    $"A clear {cm} cm path from the door to the window; furniture grouped in zones along the walls, never blocking openings.",
                    $"keep a clear {cm} cm path from the door to the window with furniture grouped in zones along the walls"));
                break;
        }

        // 2. Room type
        switch (r.SpaceType)
        {
            case "master bedroom" when r.WidthM < 3.0:
                Add(new("bed_narrow",
                    "Cameră îngustă: pat de 140–160 cm, noptiere suspendate și dulap cu uși glisante (fără raza de deschidere a ușilor).",
                    "Narrow room: a 140–160 cm bed, floating nightstands and a sliding-door wardrobe (no door swing).",
                    "use a 140-160 cm wide bed with floating wall-mounted nightstands and a sliding-door wardrobe"));
                break;
            case "master bedroom":
                Add(new("bed_clearance",
                    "Pat de 160–180 cm cu minimum 60 cm liber pe ambele laturi și 90 cm în fața dulapului.",
                    "A 160–180 cm bed with at least 60 cm free on both sides and 90 cm in front of the wardrobe.",
                    "use a 160-180 cm bed with at least 60 cm clearance on both sides and 90 cm in front of the wardrobe"));
                break;
            case "kitchen":
                Add(new("kitchen_triangle",
                    "Triunghiul de lucru (frigider–chiuvetă–plită) între 4 și 7 m, cu 90–120 cm liberi între fronturile paralele.",
                    "Work triangle (fridge–sink–hob) of 4–7 m in total, with 90–120 cm between parallel fronts.",
                    "keep a compact fridge-sink-hob work triangle with 90-120 cm clearance between parallel counters"));
                break;
            case "bathroom":
                Add(new("bath_clearance",
                    "Lavoar suspendat și WC suspendat, cu 60–70 cm liberi în fața fiecăruia; duș walk-in cu sticlă clară în loc de cadă.",
                    "Wall-hung vanity and WC with 60–70 cm free in front of each; a walk-in shower with clear glass instead of a bathtub.",
                    "use a wall-hung vanity and toilet with 60-70 cm clearance in front, and a clear-glass walk-in shower"));
                break;
            case "living room":
                Add(new("living_distances",
                    "Canapeaua la 2,5–3 m de TV, măsuța la 40–45 cm de canapea; canapea cu brațe subțiri, nu colțar supradimensionat.",
                    "Sofa 2.5–3 m from the TV, coffee table 40–45 cm from the sofa; a slim-armed sofa rather than an oversized corner unit.",
                    "use a slim-armed sofa 2.5-3 m from the TV wall with the coffee table 40-45 cm in front, no oversized sectional"));
                break;
            case "home office":
                Add(new("office_desk",
                    "Birou de 140 × 70 cm lângă fereastră, scaun ergonomic cu 100 cm liberi în spate pentru retragere.",
                    "A 140 × 70 cm desk by the window and an ergonomic chair with 100 cm free behind it.",
                    "place a 140 x 70 cm desk by the window with an ergonomic chair and 100 cm free space behind it"));
                break;
            case "entryway":
                Add(new("entry_shallow",
                    "Corpuri de maximum 35 cm adâncime (pantofar, cuier încastrat) și o oglindă pe toată înălțimea.",
                    "Cabinets at most 35 cm deep (shoe cabinet, built-in coat rack) and a full-height mirror.",
                    "use shallow cabinets at most 35 cm deep, a built-in coat rack and a full-height mirror"));
                break;
            case "walk-in closet":
                Add(new("closet_aisle",
                    "Rafturi pe maximum două laturi, adâncime 55–60 cm, cu un culoar central de cel puțin 90 cm.",
                    "Shelving on at most two sides, 55–60 cm deep, with a central aisle of at least 90 cm.",
                    "fit 55-60 cm deep shelving on at most two walls with a central aisle of at least 90 cm"));
                break;
            case "attic loft":
                Add(new("attic_kneewall",
                    "Folosește zona joasă de sub pantă pentru depozitare încastrată; mobilierul înalt doar sub coama acoperișului.",
                    "Use the low area under the slope for built-in storage; tall furniture only under the roof ridge.",
                    "use the low knee-wall area under the sloped ceiling for built-in storage and keep tall furniture under the ridge"));
                break;
            case "commercial cafe":
                Add(new("cafe_service",
                    "Culoar de serviciu de 120 cm între bar și mese; mese de 60–70 cm pentru două persoane, la 45 cm între scaune.",
                    "A 120 cm service aisle between the bar and the tables; 60–70 cm tables for two, 45 cm between chairs.",
                    "keep a 120 cm service aisle between the counter and the tables, with compact 60-70 cm tables"));
                break;
        }

        // 3. Dimensions
        if (r.HeightM >= 2.7)
            Add(new("tall_ceiling",
                $"Tavan de {r.HeightM.ToString("0.00", CultureInfo.InvariantCulture)} m: depozitare verticală până în tavan, eliberând podeaua.",
                $"{r.HeightM.ToString("0.00", CultureInfo.InvariantCulture)} m ceiling: vertical floor-to-ceiling storage that frees the floor.",
                "exploit the ceiling height with vertical floor-to-ceiling storage that keeps the floor free"));
        else if (r.HeightM < 2.5)
            Add(new("low_ceiling",
                "Tavan jos: mobilier low-profile, fără lustre suspendate — spoturi încastrate și lumină indirectă.",
                "Low ceiling: low-profile furniture, no hanging pendants — recessed spots and indirect light.",
                "use low-profile furniture and recessed ceiling lights instead of hanging pendants"));

        if (r.AreaSqm < 14)
            Add(new("small_area",
                "Sub 14 m²: scaune și canapele pe picioare sau suspendate, nuanțe neutre calde și deschise, maximum 2–3 piese mari.",
                "Under 14 m²: legged or floating seating, light warm neutrals and no more than 2–3 large pieces.",
                "use legged or floating seating, light warm neutral tones and no more than three large furniture pieces"));
        else if (r.AreaSqm >= 25)
            Add(new("large_area",
                "Peste 25 m²: zonează cu covoare și corpuri de iluminat dedicate; mobilierul poate sta desprins de pereți.",
                "Over 25 m²: zone the space with rugs and dedicated lighting; furniture can float away from the walls.",
                "define distinct functional zones with rugs and dedicated lighting, letting furniture float away from the walls"));
        else
            Add(new("anchor_walls",
                "Piesele mari (canapea, pat, dulap) pe pereții plini; diagonala ușă–fereastră rămâne liberă, ca un culoar natural.",
                "Large pieces (sofa, bed, wardrobe) on the solid walls; the door–window diagonal stays free as a natural walkway.",
                "anchor the large furniture pieces against the solid walls and keep the diagonal from the door to the window free"));

        if (r.WidthM < 2.6 && r.SpaceType is not ("master bedroom" or "entryway" or "walk-in closet" or "bathroom"))
            Add(new("narrow_room",
                "Cameră îngustă: mobilierul pe o singură latură lungă, culoarul pe cealaltă; fronturi glisante sau pliante.",
                "Narrow room: furniture along one long wall, the walkway along the other; sliding or folding fronts.",
                "place furniture along one long wall and keep the walkway along the opposite wall"));

        // Always end with a daylight rule when there is still room (keeps the list at 3–4 items)
        Add(new("daylight",
            "Nimic mai înalt de 90 cm în fața ferestrei; draperii subțiri montate la tavan, ca lumina naturală să intre nestingherită.",
            "Nothing taller than 90 cm in front of the window; sheer curtains hung from the ceiling to let daylight in.",
            "keep everything in front of the windows below 90 cm with sheer ceiling-hung curtains to maximize daylight"));
        return list;
    }

    /// <summary>
    /// Client-supplied English constraints (untrusted): strings only, control / prompt-weight syntax removed,
    /// each capped at <see cref="MaxConstraintLength"/>, at most <see cref="MaxConstraints"/>, de-duplicated.
    /// </summary>
    public static IReadOnlyList<string> SanitizeConstraints(IEnumerable<string?> raw) => raw
        .Select(s => Ai.DesignVision.CleanCustomPrompt(s))
        .Select(s => s.Length > MaxConstraintLength ? s[..MaxConstraintLength] : s)
        .Select(s => s.Trim().TrimEnd('.', ';', ','))
        .Where(s => s.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Take(MaxConstraints)
        .ToList();

    /// <summary>Exact twin of ergonomics.ts <c>round</c>: <c>Math.round((v + Number.EPSILON) * 10^d) / 10^d</c> (1.005 → 1.01).</summary>
    private static double Round(double v, int digits)
    {
        var f = Math.Pow(10, digits);
        return Js.Round((v + NumberEpsilon) * f) / f;
    }

    private const double NumberEpsilon = 2.220446049250313e-16; // JS Number.EPSILON
}
