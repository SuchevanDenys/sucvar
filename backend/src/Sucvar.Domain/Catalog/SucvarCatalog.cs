using System.Text.Json;

namespace Sucvar.Domain.Catalog;

/// <summary>
/// Port of the catalog lookups from app/data/spaces.ts and app/data/catalog.ts.
/// Data is the embedded <c>catalog.json</c>, exported from the TypeScript source by
/// <c>tools/golden/gen.cjs</c> (re-run it whenever the frontend catalog changes).
/// </summary>
public static class SucvarCatalog
{
    public const int MaxFocusChips = 3;
    public const string DefaultScope = "renovation";
    public static readonly string[] Modes = ["interiors", "exteriors", "gardens"];

    private static readonly Dictionary<string, string> LegacySpaceIds = new()
    {
        ["townhouse facade"] = "modern villa exterior",
        ["commercial building"] = "modern villa exterior",
        ["backyard patio"] = "residential garden",
        ["poolside garden"] = "residential garden",
        ["front yard"] = "courtyard walkway",
    };

    private static readonly Lazy<CatalogData> Data = new(Load);

    public static CatalogData Current => Data.Value;
    public static IReadOnlyList<VisualStyle> Styles => Current.Styles;

    private static CatalogData Load()
    {
        using var stream = typeof(SucvarCatalog).Assembly.GetManifestResourceStream("Sucvar.Domain.Catalog.catalog.json")
            ?? throw new InvalidOperationException("catalog.json embedded resource missing");
        return JsonSerializer.Deserialize<CatalogData>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("catalog.json is empty");
    }

    public static bool IsMode(string? mode) => mode is not null && Current.SpaceModes.ContainsKey(mode);

    public static SpaceOption GetSpace(string mode, string? spaceId)
    {
        var spaces = Current.SpaceModes[mode].Spaces;
        var resolved = string.IsNullOrEmpty(spaceId) ? null : LegacySpaceIds.GetValueOrDefault(spaceId, spaceId);
        return spaces.FirstOrDefault(s => s.Id == resolved) ?? spaces[0];
    }

    public static LayoutOption GetLayout(SpaceOption space, string? layoutId) =>
        space.Layouts.FirstOrDefault(l => l.Id == layoutId) ?? space.Layouts[0];

    public static VisualStyle GetStyle(string? styleId) =>
        Current.Styles.FirstOrDefault(s => s.Id == styleId) ?? Current.Styles[0];

    public static bool IsKnownStyle(string? styleId) => styleId is not null && Current.Styles.Any(s => s.Id == styleId);

    public static ScopeOption GetScope(string? scopeId) =>
        Current.Scopes.FirstOrDefault(s => s.Id == scopeId) ?? Current.Scopes.First(s => s.Id == DefaultScope);

    public static bool IsScope(string? scopeId) => Current.Scopes.Any(s => s.Id == scopeId);

    /// <summary>isKnownSpace from app/lib/procurement.ts.</summary>
    public static bool IsKnownSpace(string? mode, string? spaceType) =>
        IsMode(mode) && spaceType is not null && Current.SpaceModes[mode!].Spaces.Any(s => s.Id == spaceType);

    /// <summary>Valid ids for the space, no duplicates, at most <see cref="MaxFocusChips"/>.</summary>
    public static List<string> SanitizeFocusIds(SpaceOption space, JsonElement? raw)
    {
        var result = new List<string>();
        if (raw is not { ValueKind: JsonValueKind.Array } arr) return result;
        var valid = space.Scenarios.Select(s => s.Id).ToHashSet();
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } id && valid.Contains(id) && !result.Contains(id))
                result.Add(id);
            if (result.Count >= MaxFocusChips) break;
        }
        return result;
    }

    public static IEnumerable<ScenarioOption> GetFocusScenarios(SpaceOption space, IEnumerable<string>? focusIds) =>
        (focusIds ?? []).Select(id => space.Scenarios.FirstOrDefault(s => s.Id == id)).OfType<ScenarioOption>();

    public static string BuildScenarioPrompt(SpaceOption space, IEnumerable<string>? focusIds) =>
        string.Join(", ", GetFocusScenarios(space, focusIds).Select(s => s.Prompt));
}
