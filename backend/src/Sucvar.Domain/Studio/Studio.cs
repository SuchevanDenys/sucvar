using System.Text.Json;
using Sucvar.Domain.Catalog;

namespace Sucvar.Domain.Studio;

/// <summary>RoomDimensions (app/types/studio.ts). Serialized camelCase, identical to the TS shape.</summary>
public sealed record RoomDimensions
{
    public double Width { get; init; }
    public double Length { get; init; }
    public double Height { get; init; }
    public double DoorsCount { get; init; }
    public double WindowsCount { get; init; }
    public double AiStrength { get; init; }
    public string LayoutPreset { get; init; } = "";
    public string Budget { get; init; } = "standard";
    public string Scope { get; init; } = SucvarCatalog.DefaultScope;
    public IReadOnlyList<string> FocusIds { get; init; } = [];
}

/// <summary>EngineeringSpecs (result of calculateEngineering).</summary>
public sealed record EngineeringSpecs(
    double FloorArea,
    double Volume,
    double NetWallArea,
    double FlooringWithWaste,
    double PaintLiters,
    double BaseboardMeters,
    double TargetLux,
    double RequiredLumens,
    double LightFixtures,
    double PlasterboardSheets,
    double CeilingProfileMeters,
    double PerimeterProfileMeters,
    double CeilingHangers);

/// <summary>Port of app/lib/studio/validation.ts (sanitizeDimensions).</summary>
public static class DimensionSanitizer
{
    public static readonly string[] Budgets = ["economy", "standard", "luxury"];

    public static (double Min, double Max) HeightLimits(string mode) => mode == "interiors" ? (2, 6) : (2, 15);

    private static double ToNumber(JsonElement? value, double fallback)
    {
        if (value is null) return fallback;
        var v = value.Value;
        if (v.ValueKind == JsonValueKind.Null) return fallback;
        if (v.ValueKind == JsonValueKind.String && v.GetString() == "") return fallback;
        var parsed = Js.ToNumber(v);
        return double.IsFinite(parsed) ? parsed : fallback;
    }

    public static RoomDimensions Sanitize(JsonElement? raw, string mode = "interiors", string? spaceType = null)
    {
        JsonElement? source = null;
        if (raw is { ValueKind: JsonValueKind.String } str)
        {
            try
            {
                using var doc = JsonDocument.Parse(str.GetString()!);
                if (doc.RootElement.ValueKind is JsonValueKind.Object or JsonValueKind.Array) source = doc.RootElement.Clone();
            }
            catch (JsonException) { source = null; }
        }
        else if (raw is { ValueKind: JsonValueKind.Object or JsonValueKind.Array }) source = raw;

        JsonElement? P(string name) => Js.Prop(source, name);

        var h = HeightLimits(mode);
        var space = SucvarCatalog.GetSpace(mode, spaceType);
        var layoutId = Js.AsString(P("layoutPreset"));
        var budget = Js.AsString(P("budget"));
        var scope = Js.AsString(P("scope"));

        return new RoomDimensions
        {
            Width = Js.Clamp(ToNumber(P("width"), 4), 1, 100),
            Length = Js.Clamp(ToNumber(P("length"), 5), 1, 100),
            Height = Js.Clamp(ToNumber(P("height"), 2.6), h.Min, h.Max),
            DoorsCount = Js.Round(Js.Clamp(ToNumber(P("doorsCount"), 1), 0, 20)),
            WindowsCount = Js.Round(Js.Clamp(ToNumber(P("windowsCount"), 2), 0, 40)),
            AiStrength = Js.Round(Js.Clamp(ToNumber(P("aiStrength"), 75), 40, 100)),
            LayoutPreset = SucvarCatalog.GetLayout(space, layoutId).Id,
            Budget = budget is not null && Budgets.Contains(budget) ? budget : "standard",
            Scope = SucvarCatalog.IsScope(scope) ? scope! : SucvarCatalog.DefaultScope,
            FocusIds = SucvarCatalog.SanitizeFocusIds(space, P("focusIds")),
        };
    }
}

/// <summary>Port of calculateEngineering (app/data/catalog.ts).</summary>
public static class Engineering
{
    private const double DoorArea = 1.89, WindowArea = 2.1, DoorWidth = 0.9;
    private const double FlooringWaste = 1.1, BaseboardWaste = 1.05;
    private const double PaintCoats = 2, PaintCoverage = 10, PaintReserve = 1.1;
    private const double UtilizationFactor = 0.6, MaintenanceFactor = 0.9, LumensPerFixture = 800;
    private const double PlasterboardSheetArea = 3.0, PlasterboardWaste = 1.1, CeilingProfilePerSqm = 3.2, CeilingHangersPerSqm = 1.5;

    private static double Safe(double v) => double.IsFinite(v) && v > 0 ? v : 0;

    public static EngineeringSpecs Calculate(RoomDimensions dims, string mode = "interiors", string spaceType = "living room")
    {
        var width = Safe(dims.Width);
        var length = Safe(dims.Length);
        var height = Safe(dims.Height);
        var doors = Math.Floor(Safe(dims.DoorsCount));
        var windows = Math.Floor(Safe(dims.WindowsCount));

        var floorArea = Js.ToFixed(width * length, 2);
        var volume = Js.ToFixed(floorArea * height, 2);
        var perimeter = (width + length) * 2;
        var grossWallArea = perimeter * height;
        var openings = doors * DoorArea + windows * WindowArea;
        var netWallArea = Math.Max(0, Js.ToFixed(grossWallArea - openings, 2));

        var flooringWithWaste = Js.ToFixed(floorArea * FlooringWaste, 2);
        var paintLiters = Math.Ceiling(netWallArea * PaintCoats / PaintCoverage * PaintReserve);
        var baseboardMeters = Js.ToFixed(Math.Max(0, perimeter - doors * DoorWidth) * BaseboardWaste, 1);

        var targetLux = SucvarCatalog.GetSpace(mode, spaceType).TargetLux;
        var requiredLumens = Js.Round(targetLux * floorArea / (UtilizationFactor * MaintenanceFactor));
        var lightFixtures = floorArea > 0 ? Math.Max(1, Math.Ceiling(requiredLumens / LumensPerFixture)) : 0;

        var hasCeiling = mode == "interiors" && floorArea > 0;
        return new EngineeringSpecs(
            floorArea,
            volume,
            netWallArea,
            flooringWithWaste,
            paintLiters,
            baseboardMeters,
            targetLux,
            requiredLumens,
            lightFixtures,
            hasCeiling ? Math.Ceiling(floorArea * PlasterboardWaste / PlasterboardSheetArea) : 0,
            hasCeiling ? Math.Ceiling(floorArea * CeilingProfilePerSqm * 1.05) : 0,
            hasCeiling ? Math.Ceiling(perimeter * 1.05) : 0,
            hasCeiling ? Math.Ceiling(floorArea * CeilingHangersPerSqm) : 0);
    }
}
