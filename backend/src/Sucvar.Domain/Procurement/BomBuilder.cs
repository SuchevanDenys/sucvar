using System.Text.Json.Serialization;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Catalog;
using Sucvar.Domain.Studio;

namespace Sucvar.Domain.Procurement;

public sealed record RetailerLink(string Retailer, string Label, string Url);

public sealed record BomItem(
    string Id,
    string Cat,
    string ProcCategory,
    string TitleRo,
    string TitleEn,
    string SpecRo,
    string SpecEn,
    double Qty,
    string Unit,
    double UnitPrice,
    double Total,
    string Query,
    IReadOnlyList<RetailerLink> Links,
    // true = matched from the user's free-text vision (omitted from JSON otherwise, so legacy payloads are unchanged)
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? FromPrompt = null);

public sealed record BomResult(IReadOnlyList<BomItem> Items, double Total, string Currency);

/// <summary>Port of app/lib/procurement.ts — deterministic bill of materials + retailer search links.</summary>
public static class BomBuilder
{
    /// <summary>
    /// French retailer search links (Leroy Merlin, Castorama, IKEA France, ManoMano, Brico Dépôt,
    /// La Plateforme du Bâtiment, Point.P) — routing and query translation live in <see cref="FrenchRetail"/>.
    /// </summary>
    public static IReadOnlyList<RetailerLink> BuildRetailerLinks(string query, string category) =>
        FrenchRetail.BuildLinks(query, category);

    private static readonly Dictionary<string, double> BudgetK = new() { ["economy"] = 0.8, ["standard"] = 1, ["luxury"] = 1.6 };

    private const double NumberEpsilon = 2.220446049250313e-16; // JS Number.EPSILON
    private static double Round2(double n) => Js.Round((n + NumberEpsilon) * 100) / 100;
    private static double Up1(double n) => Math.Ceiling(n * 10 - 1e-9) / 10;

    private static readonly Dictionary<string, (string Floor, string Wall)> StyleQuery = new()
    {
        ["scandinavian"] = ("parchet stejar uleiat", "vopsea lavabila alb cald"),
        ["modern"] = ("parchet laminat stejar gri", "vopsea lavabila alba mata"),
        ["contemporary"] = ("parchet triplustratificat nuc", "vopsea lavabila gri"),
        ["minimalist"] = ("gresie portelanata beton 80x80", "vopsea lavabila alba"),
        ["minimalist_obsidian"] = ("gresie portelanata neagra mata", "vopsea lavabila antracit"),
        ["japandi"] = ("parchet stejar natural periat", "vopsea lavabila bej"),
        ["traditional"] = ("parchet masiv stejar", "vopsea lavabila crem"),
        ["mid_century_modern"] = ("parchet nuc triplustratificat", "vopsea lavabila verde salvie"),
        ["coastal"] = ("parchet stejar albit", "vopsea lavabila albastru deschis"),
        ["industrial"] = ("gresie aspect beton", "vopsea lavabila gri beton"),
        ["brutalist_concrete"] = ("gresie portelanata beton", "amorsa decorativa aspect beton"),
        ["biophilic"] = ("parchet stejar natural", "vopsea lavabila verde"),
    };

    private sealed record Draft(string Key, string Cat, string ProcCategory, string TitleRo, string TitleEn, string SpecRo, string SpecEn,
        double Qty, string Unit, double BasePrice, bool WithStyle, string Query, bool FromPrompt = false);

    private sealed record Kit(string TitleRo, string TitleEn, string SpecRo, string SpecEn, double Qty, double Price, string Query);

    private static readonly Dictionary<string, Kit[]> SpaceKit = new()
    {
        ["living room"] =
        [
            new("Canapea 3 locuri tapițată", "3-seat upholstered sofa", "Structură lemn masiv, spumă HR", "Solid-wood frame, HR foam", 1, 520, "canapea 3 locuri"),
            new("Măsuță de cafea + comodă TV", "Coffee table + TV unit", "MDF furniruit, 140–180 cm", "Veneered MDF, 140–180 cm", 1, 260, "comoda tv living"),
        ],
        ["kitchen"] =
        [
            new("Corpuri bucătărie (baze + suspendate)", "Kitchen cabinetry (base + wall)", "MDF melaminat, balamale amortizate", "Melamine MDF, soft-close hinges", 0, 240, "corpuri bucatarie"),
            new("Blat de lucru postformat 38 mm", "Post-formed worktop 38 mm", "PAL laminat HPL, rezistent la umezeală", "HPL laminate chipboard, moisture-resistant", 0, 55, "blat bucatarie"),
        ],
        ["master bedroom"] =
        [
            new("Pat 160×200 cu somieră", "Bed 160×200 with slatted base", "Cadru lemn, tăblie tapițată", "Wood frame, upholstered headboard", 1, 480, "pat 160x200"),
            new("Dulap cu uși glisante", "Sliding-door wardrobe", "Structură PAL 18 mm, oglindă", "Chipboard 18 mm carcass, mirror", 1, 420, "dulap dormitor usi glisante"),
        ],
        ["bathroom"] =
        [
            new("Set sanitar suspendat (vas WC + lavoar)", "Wall-hung sanitary set (WC + basin)", "Porțelan sanitar, rezervor încastrat", "Vitreous china, concealed cistern", 1, 390, "vas wc suspendat rezervor incastrat"),
            new("Cabină de duș + baterie termostatică", "Shower enclosure + thermostatic mixer", "Sticlă securizată 8 mm", "8 mm tempered glass", 1, 340, "cabina dus sticla securizata"),
        ],
        ["home office"] =
        [
            new("Birou 140×70 cm", "Desk 140×70 cm", "Blat 25 mm, reglaj cabluri", "25 mm top, cable management", 1, 220, "birou 140x70"),
            new("Scaun ergonomic", "Ergonomic chair", "Suport lombar, înălțime reglabilă", "Lumbar support, height-adjustable", 1, 190, "scaun birou ergonomic"),
        ],
        ["entryway"] =
        [
            new("Pantofar cu bancă", "Shoe cabinet with bench", "PAL melaminat, 100 cm", "Melamine chipboard, 100 cm", 1, 160, "pantofar cu banca"),
            new("Cuier + oglindă hol", "Coat rack + hall mirror", "Metal vopsit, oglindă 80 cm", "Painted metal, 80 cm mirror", 1, 90, "oglinda hol cuier"),
        ],
        ["attic loft"] =
        [
            new("Canapea / pat de zi", "Sofa / day bed", "Structură lemn, înălțime joasă", "Wood frame, low profile", 1, 450, "canapea extensibila"),
            new("Rafturi sub înclinare", "Under-slope shelving", "PAL 18 mm, la comandă", "Made-to-measure 18 mm chipboard", 1, 280, "raft mansarda"),
        ],
        ["walk-in closet"] =
        [
            new("Sistem dressing modular", "Modular dressing system", "Montanți + rafturi + bare", "Uprights + shelves + rails", 1, 650, "sistem dressing modular"),
            new("Comodă cu sertare", "Chest of drawers", "Sertare cu amortizare", "Soft-close drawers", 1, 210, "comoda sertare"),
        ],
        ["commercial cafe"] =
        [
            new("Mese de cafenea (set 4)", "Cafe tables (set of 4)", "Blat HPL, picior metalic", "HPL top, metal base", 1, 380, "masa cafenea"),
            new("Scaune HoReCa (set 8)", "Commercial chairs (set of 8)", "Stivuibile, rezistente la uz intens", "Stackable, heavy-duty", 1, 480, "scaun cafenea horeca"),
        ],
    };

    private static readonly Kit[] OutdoorKit =
    [
        new("Set mobilier exterior (masă + 4 scaune)", "Outdoor furniture set (table + 4 chairs)", "Aluminiu / ratan sintetic, rezistent UV", "Aluminium / synthetic rattan, UV-resistant", 1, 420, "set mobilier gradina"),
        new("Jardinieră / ghivece mari", "Large planters", "Beton sau polipropilenă, Ø40–60 cm", "Concrete or polypropylene, Ø40–60 cm", 2, 70, "ghivece mari exterior"),
    ];

    private static readonly HashSet<string> WetSpaces = ["bathroom", "kitchen"];

    public static BomResult Build(string mode, string spaceType, string styleId, RoomDimensions dims,
        IReadOnlyList<VisionMaterial>? vision = null)
    {
        var space = SucvarCatalog.GetSpace(mode, spaceType);
        var style = SucvarCatalog.GetStyle(styleId);
        var scope = SucvarCatalog.GetScope(dims.Scope);
        var f = scope.Factors;
        var eng = Engineering.Calculate(dims, mode, space.Id);
        var kelvin = Js.Str(style.LightingSpec.Kelvin);
        var sq = StyleQuery.TryGetValue(style.Id, out var found) ? found : ("parchet laminat", "vopsea lavabila alba");
        static double Share(double k) => Math.Min(Math.Max(k, 0), 1);
        var perimeter = (Math.Max(dims.Width, 0) + Math.Max(dims.Length, 0)) * 2;
        var wet = mode == "interiors" && WetSpaces.Contains(space.Id);

        var drafts = new List<Draft>();
        void Add(Draft d) => drafts.Add(d);

        if (eng.FloorArea > 0 && mode == "interiors")
        {
            if (scope.Id == "shell")
                Add(new("screed", "structure", "construction", "Șapă autonivelantă 40 mm", "Self-levelling screed 40 mm", "Mortar ciment, ~2 kg/m²/mm; strat nou pe structură brută", "Cement mortar, ~2 kg/m²/mm; new layer on raw structure", Up1(eng.FloorArea), "m²", 9, false, "sapa autonivelanta"));
            if (Share(f.Floor) > 0)
            {
                Add(wet
                    ? new("floor", "finishes", "construction", "Gresie porțelanată 60×60 cm", "Porcelain floor tile 60×60 cm", "Antiderapantă R10, rectificată; include 10% pierderi", "Anti-slip R10, rectified; incl. 10% waste", Up1(eng.FlooringWithWaste * Share(f.Floor)), "m²", 24, true, "gresie portelanata 60x60 antiderapanta")
                    : new("floor", "finishes", "construction", style.Materials.Flooring.Ro, style.Materials.Flooring.En, "Include 10% pierderi la tăiere; adeziv / folie suport separat", "Incl. 10% cutting waste; underlay / adhesive separate", Up1(eng.FlooringWithWaste * Share(f.Floor)), "m²", 28, true, sq.Item1));
            }
            if (Share(f.Walls) > 0)
            {
                if (wet)
                {
                    var bath = space.Id == "bathroom";
                    var tiled = eng.NetWallArea * (bath ? 0.65 : 0.25) * Share(f.Walls);
                    Add(new("walltile", "finishes", "construction", "Faianță 30×60 cm", "Wall tile 30×60 cm",
                        bath ? "Zonă duș + lavoar; hidroizolație și adeziv flexibil separat" : "Backsplash și zona de lucru; include 10% pierderi",
                        bath ? "Shower + basin zone; waterproofing and flexible adhesive separate" : "Backsplash and work zone; incl. 10% waste",
                        Up1(tiled * 1.1), "m²", 20, true, "faianta 30x60"));
                    Add(new("paint", "finishes", "construction", "Vopsea lavabilă pentru spații umede", "Moisture-resistant washable paint", "Zonele netăiate cu faianță; 2 straturi + grund", "Non-tiled areas; 2 coats + primer", Up1(Math.Max(eng.NetWallArea * Share(f.Walls) - tiled, 0) + eng.FloorArea), "m²", 4.5, false, "vopsea lavabila anti mucegai baie"));
                }
                else
                {
                    Add(new("paint", "finishes", "construction", style.Materials.Walls.Ro, style.Materials.Walls.En, $"Aprox. {Js.Str(eng.PaintLiters)} L (2 straturi) + grund; arie netă fără goluri", $"About {Js.Str(eng.PaintLiters)} L (2 coats) + primer; net area excl. openings", Up1(eng.NetWallArea * Share(f.Walls)), "m²", 4.5, true, sq.Item2));
                }
            }
            if (Share(f.Baseboard) > 0 && eng.BaseboardMeters > 0)
                Add(new("base", "finishes", "construction", "Plintă MDF 80 mm", "MDF baseboard 80 mm", "Perimetru minus uși, +5% rezervă", "Perimeter minus doors, +5% reserve", Up1(eng.BaseboardMeters * Share(f.Baseboard)), "ml", 4, false, "plinta mdf 80 mm"));
            if (Share(f.Ceiling) > 0 && eng.PlasterboardSheets > 0)
                Add(new("ceiling", "structure", "construction", "Gips-carton 12,5 mm + profile CD/UD", "Plasterboard 12.5 mm + CD/UD profiles", $"{Js.Str(eng.PlasterboardSheets)} plăci 1,2×2,5 m, +10% pierderi; sistem de suspendare inclus", $"{Js.Str(eng.PlasterboardSheets)} sheets 1.2×2.5 m, +10% waste; hanger system included", Up1(eng.FloorArea * 1.1 * Share(f.Ceiling)), "m²", 11, false, "placa gips carton 12.5 mm"));
            if (Share(f.Light) > 0 && perimeter > 0)
                Add(new("led", "electric", "lighting", $"Bandă LED {kelvin}K cu profil aluminiu încastrat", $"{kelvin}K LED strip with recessed aluminium profile", "IP20, 12 W/m, difuzor opal; sursă de alimentare separat", "IP20, 12 W/m, opal diffuser; power supply separate", Up1(perimeter * Share(f.Light)), "ml", 14, true, $"banda led {kelvin}k profil aluminiu"));
            if (Share(f.Light) > 0 && eng.LightFixtures > 0)
                Add(new("spots", "electric", "lighting", $"Spot LED încastrat {kelvin}K", $"Recessed LED downlight {kelvin}K", $"{Js.Str(eng.TargetLux)} lx țintă → {Js.Str(eng.RequiredLumens)} lm total (metoda lumenului)", $"{Js.Str(eng.TargetLux)} lx target → {Js.Str(eng.RequiredLumens)} lm total (lumen method)", Math.Max(1, Math.Ceiling(eng.LightFixtures * Share(f.Light))), "buc.", 12, true, $"spot led incastrat {kelvin}k"));

            var kit = SpaceKit.GetValueOrDefault(space.Id) ?? [];
            for (var i = 0; i < kit.Length; i++)
            {
                var k = kit[i];
                var kitchen = space.Id == "kitchen";
                var kitchenMl = Up1(Math.Max(perimeter * 0.27, 1));
                var qty = kitchen ? kitchenMl : k.Qty;
                Add(new($"kit{i}", "other", "furniture", k.TitleRo, k.TitleEn,
                    kitchen && i == 0 ? $"{k.SpecRo}; ~{Js.Str(qty)} ml de linie" : k.SpecRo,
                    kitchen && i == 0 ? $"{k.SpecEn}; ~{Js.Str(qty)} ml run" : k.SpecEn,
                    qty, kitchen ? "ml" : "buc.", k.Price, true, k.Query));
            }
        }
        else if (eng.FloorArea > 0 && mode == "exteriors")
        {
            var facade = space.CostBasis == "facade";
            if (facade && Share(f.Envelope) > 0)
            {
                Add(new("etics", "finishes", "construction", "Polistiren expandat EPS 100 – 10 cm", "EPS 100 insulation – 10 cm", "Termosistem; dibluri, plasă și adeziv separat; +5% pierderi", "ETICS; fixings, mesh and adhesive separate; +5% waste", Up1(eng.NetWallArea * Share(f.Envelope) * 1.05), "m²", 9, false, "polistiren expandat eps 100 10 cm"));
                Add(new("render", "finishes", "construction", style.Materials.Walls.Ro, style.Materials.Walls.En, "Tencuială decorativă siliconică + amorsă", "Silicone decorative render + primer", Up1(eng.NetWallArea * Share(f.Envelope)), "m²", 8, true, "tencuiala decorativa siliconica fatada"));
                Add(new("sills", "finishes", "construction", "Glaf exterior aluminiu", "Aluminium exterior window sill", "Una per fereastră, lățime ~1,2 m", "One per window, ~1.2 m wide", Math.Max(dims.WindowsCount, 1) * 1.2, "ml", 18, false, "glaf exterior aluminiu"));
            }
            else if (Share(f.Envelope) > 0)
            {
                Add(new("deck", "finishes", "outdoor", style.Materials.Flooring.Ro, style.Materials.Flooring.En, "Deck / dale exterioare; +10% pierderi", "Outdoor decking / pavers; +10% waste", Up1(eng.FlooringWithWaste * Share(f.Envelope)), "m²", 36, true, "deck exterior wpc"));
                Add(new("joists", "structure", "outdoor", "Rigle de susținere tratate", "Treated support joists", "Axe la 40 cm; lemn tratat autoclavizat", "40 cm centres; pressure-treated timber", Up1(Math.Max(dims.Width, 0) / 0.4 * Math.Max(dims.Length, 0)), "ml", 3.2, false, "rigla lemn tratat autoclavizat"));
            }
            if (Share(f.Light) > 0 && eng.LightFixtures > 0)
                Add(new("outlight", "electric", "outdoor", $"Aplică LED exterior IP65 {kelvin}K", $"Exterior LED wall light IP65 {kelvin}K", "Rezistentă la ploaie și praf, corp aluminiu", "Rain- and dust-proof, aluminium body", Math.Max(1, Math.Ceiling(eng.LightFixtures * Share(f.Light))), "buc.", 32, true, $"aplica led exterior ip65 {kelvin}k"));
            AddOutdoorKit(Add);
        }
        else if (eng.FloorArea > 0)
        {
            var hard = eng.FlooringWithWaste * space.HardscapeShare * Share(f.Envelope);
            var green = eng.FloorArea * (1 - space.HardscapeShare) * Share(f.Envelope);
            var pct = Js.Str(Js.Round(space.HardscapeShare * 100));
            if (hard > 0)
                Add(new("paving", "finishes", "outdoor", "Dale / pavele de exterior", "Outdoor paving slabs", $"{pct}% din arie; +10% pierderi; strat de nisip și piatră separat", $"{pct}% of area; +10% waste; sand and gravel bed separate", Up1(hard), "m²", 22, true, "dale beton exterior"));
            if (green > 0)
            {
                var m3 = Js.ToFixedString(green * 0.05, 1);
                Add(new("turf", "other", "outdoor", "Gazon în rulou", "Turf rolls", "Zona verde; pământ vegetal separat", "Planted zone; topsoil separate", Up1(green), "m²", 4.5, false, "gazon rulou"));
                Add(new("soil", "other", "outdoor", "Pământ vegetal 5 cm strat", "Topsoil, 5 cm layer", $"~{m3} m³ pentru zona verde", $"~{m3} m³ for the planted zone", Up1(green), "m²", 2.2, false, "pamant vegetal"));
            }
            Add(new("edging", "finishes", "outdoor", "Bordură de grădină", "Garden edging", "Pe perimetrul zonei amenajate", "Along the landscaped perimeter", Up1(perimeter), "ml", 3.5, false, "bordura gradina"));
            if (Share(f.Light) > 0 && eng.LightFixtures > 0)
                Add(new("gardenlight", "electric", "outdoor", $"Balizi LED de grădină {kelvin}K", $"LED garden bollards {kelvin}K", "IP65, 12 V; transformator și cablu separat", "IP65, 12 V; transformer and cable separate", Math.Max(1, Math.Ceiling(eng.LightFixtures * Share(f.Light))), "buc.", 30, true, $"baliza led gradina {kelvin}k"));
            AddOutdoorKit(Add);
        }

        var chips = space.Scenarios
            .Where(s => dims.FocusIds.Contains(s.Id))
            .Select(s => new Draft($"sc-{s.Id}", "other", mode == "interiors" ? "construction" : "outdoor", s.LabelRo, s.LabelEn,
                $"{s.MaterialRo} — pachet orientativ", $"{s.MaterialEn} — indicative allowance", 1, "buc.", 240, true,
                Js.StripDiacritics(s.MaterialRo.Split(',')[0])))
            .ToList();

        if (vision is { Count: > 0 } && eng.FloorArea > 0)
        {
            ApplyVision(drafts, vision, mode, space.Id, wet, eng, perimeter);
            // What the user asked for comes first (stable: the rest keeps its order)
            var ordered = drafts.OrderByDescending(d => d.FromPrompt).ToList();
            drafts.Clear();
            drafts.AddRange(ordered);
        }

        var room = Math.Max(0, 10 - drafts.Count);
        var all = drafts.Concat(chips.Take(room)).Take(10);

        var budgetK = BudgetK.GetValueOrDefault(dims.Budget, 1);
        var items = all
            .Where(d => d.Qty > 0)
            .Select(d =>
            {
                var unitPrice = Round2(d.BasePrice * budgetK * (d.WithStyle ? style.CostFactor : 1));
                var qty = d.Unit == "buc." ? Math.Ceiling(d.Qty) : Round2(d.Qty);
                return new BomItem($"proc-{d.Key}", d.Cat, d.ProcCategory, d.TitleRo, d.TitleEn, d.SpecRo, d.SpecEn, qty, d.Unit,
                    unitPrice, Round2(qty * unitPrice), d.Query, BuildRetailerLinks(d.Query, d.ProcCategory), d.FromPrompt ? true : null);
            })
            .ToList();

        return new BomResult(items, Round2(items.Aggregate(0.0, (s, i) => s + i.Total)), "EUR");
    }

    private static readonly HashSet<string> WetSafeFloors = ["terrazzo", "microcement", "marble", "travertine"];
    private static readonly HashSet<string> AccentWalls = ["wood_panels", "exposed_brick", "wallpaper", "paris_stone"];

    /// <summary>
    /// Context-aware matching: each material from the user's text replaces the generic item of its slot
    /// (floor, wall finish, LED, sofa) or is added as its own line, with a retailer search for exactly that material.
    /// </summary>
    private static void ApplyVision(List<Draft> drafts, IReadOnlyList<VisionMaterial> vision, string mode, string spaceId, bool wet,
        EngineeringSpecs eng, double perimeter)
    {
        const string SpecRo = "Ales din descrierea ta — caută exact acest material";
        const string SpecEn = "Picked from your description — search for this exact material";

        bool Replace(Func<Draft, bool> match, VisionMaterial m)
        {
            var i = drafts.FindIndex(d => !d.FromPrompt && match(d));
            if (i < 0) return false;
            var d = drafts[i];
            drafts[i] = d with
            {
                TitleRo = m.TitleRo, TitleEn = m.TitleEn, SpecRo = $"{SpecRo}; {d.SpecRo}", SpecEn = $"{SpecEn}; {d.SpecEn}",
                Query = m.Query, BasePrice = Math.Max(d.BasePrice, m.BasePrice), FromPrompt = true,
            };
            return true;
        }

        void AddNew(VisionMaterial m)
        {
            var qty = m.Unit switch
            {
                "m²" when m.Slot == "floor" => eng.FlooringWithWaste,
                "m²" when AccentWalls.Contains(m.Id) => eng.NetWallArea * 0.3, // one accent wall
                "m²" => eng.NetWallArea,
                "ml" when m.Id == "quartz_top" => Math.Max(perimeter * 0.27, 1),
                "ml" => perimeter,
                _ when m.Id == "plants" => 3,
                _ => 1,
            };
            var proc = mode == "interiors" ? m.ProcCategory : "outdoor";
            drafts.Add(new($"vp-{m.Id}", m.Slot is "floor" or "walls" or "fixtures" ? "finishes" : m.Slot == "lighting" ? "electric" : "other",
                proc, m.TitleRo, m.TitleEn, SpecRo, SpecEn, Up1(qty), m.Unit, m.BasePrice, true, m.Query, true));
        }

        foreach (var m in vision)
        {
            if (drafts.Any(d => d.Key == $"vp-{m.Id}")) continue;
            var handled = m.Slot switch
            {
                "floor" when mode == "interiors" && (!wet || WetSafeFloors.Contains(m.Id)) => Replace(d => d.Key == "floor", m),
                "floor" when mode != "interiors" => Replace(d => d.Key is "deck" or "paving", m),
                "walls" when mode == "interiors" && !wet && !AccentWalls.Contains(m.Id) => Replace(d => d.Key == "paint", m),
                "lighting" when m.Id == "led_strip" => Replace(d => d.Key == "led", m),
                "furniture" when m.Id.EndsWith("_sofa", StringComparison.Ordinal) => Replace(d => d.Key.StartsWith("kit", StringComparison.Ordinal) && d.Query.Contains("canapea"), m),
                "fixtures" when m.Id == "quartz_top" && spaceId == "kitchen" => Replace(d => d.Query == "blat bucatarie", m),
                _ => false,
            };
            if (!handled && !(m.Slot == "floor" && wet)) AddNew(m);
        }
    }

    private static void AddOutdoorKit(Action<Draft> add)
    {
        for (var i = 0; i < OutdoorKit.Length; i++)
        {
            var k = OutdoorKit[i];
            add(new($"kit{i}", "other", "outdoor", k.TitleRo, k.TitleEn, k.SpecRo, k.SpecEn, k.Qty, "buc.", k.Price, true, k.Query));
        }
    }
}
