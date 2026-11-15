using System.Text.Json;
using Sucvar.Domain.Studio;

namespace Sucvar.Domain.Procurement;

/// <summary>
/// `projects.procurement_items` (migration 006): the Studio bill of materials saved with the project.
///
/// The column is written by the browser (Supabase client, RLS-owned row), so it is UNTRUSTED here:
/// every field is clamped/truncated and the retailer links are REBUILT from `query` + `procCategory`
/// (only the French retailer search URLs of FrenchRetail) — a stored URL is never echoed back.
/// When the column is NULL (older projects, or migration 006 not applied) the list is recomputed
/// deterministically with <see cref="BomBuilder"/> from the saved mode / space / style / dimensions.
/// </summary>
public static class ProcurementStore
{
    public const int MaxItems = 50;

    private static readonly HashSet<string> ProcCategories = ["construction", "furniture", "lighting", "outdoor"];

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Stored JSON → sanitized items; null when absent or not an array (caller recomputes).</summary>
    public static IReadOnlyList<BomItem>? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException)
        {
            return null;
        }
        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;
            return doc.RootElement.EnumerateArray()
                .Where(e => e.ValueKind == JsonValueKind.Object)
                .Take(MaxItems)
                .Select((e, i) => Sanitize(e, i))
                .Where(x => x is not null)
                .Select(x => x!)
                .ToList();
        }
    }

    private static BomItem? Sanitize(JsonElement e, int index)
    {
        string S(string name, int max) => Js.AsString(Js.Prop(e, name)) is { } s ? Js.Slice(s.Trim(), max) : "";
        double N(string name, double max)
        {
            var n = Js.ToNumber(Js.Prop(e, name));
            return double.IsFinite(n) ? Math.Clamp(n, 0, max) : 0;
        }

        var titleRo = S("titleRo", 200);
        var titleEn = S("titleEn", 200);
        if (titleRo.Length == 0 && titleEn.Length == 0) return null;
        if (titleRo.Length == 0) titleRo = titleEn;
        if (titleEn.Length == 0) titleEn = titleRo;

        var qty = Round2(N("qty", 1e7));
        if (qty <= 0) return null;
        var unitPrice = Round2(N("unitPrice", 1e7));
        var proc = S("procCategory", 20);
        if (!ProcCategories.Contains(proc)) proc = "construction";
        var query = S("query", 120);
        if (query.Length == 0) query = Js.Slice(Js.StripDiacritics(titleRo), 120);
        var id = S("id", 40);

        return new BomItem(
            id.Length > 0 ? id : $"proc-{index}",
            S("cat", 40) is { Length: > 0 } cat ? cat : "other",
            proc,
            titleRo,
            titleEn,
            S("specRo", 300),
            S("specEn", 300),
            qty,
            S("unit", 20),
            unitPrice,
            Round2(qty * unitPrice),
            query,
            BomBuilder.BuildRetailerLinks(query, proc));
    }

    /// <summary>Stored list when present, otherwise the deterministic Studio list (same code as /api/analyze-materials).</summary>
    public static (IReadOnlyList<BomItem> Items, bool Persisted) Resolve(string? storedJson, string? mode, string? spaceType, string? styleId, string? dimensionsJson)
    {
        if (Parse(storedJson) is { } stored) return (stored, true);
        return (Compute(mode, spaceType, styleId, dimensionsJson).Items, false);
    }

    public static BomResult Compute(string? mode, string? spaceType, string? styleId, string? dimensionsJson)
    {
        var m = mode is "exteriors" or "gardens" ? mode : "interiors";
        JsonElement? dims = null;
        if (!string.IsNullOrWhiteSpace(dimensionsJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(dimensionsJson);
                dims = doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                dims = null;
            }
        }
        var space = Catalog.SucvarCatalog.GetSpace(m, spaceType).Id;
        return BomBuilder.Build(m, space, styleId ?? "scandinavian", DimensionSanitizer.Sanitize(dims, m, space));
    }

    public static double Total(IReadOnlyList<BomItem> items) => Round2(items.Sum(i => i.Total));

    public static string Serialize(IReadOnlyList<BomItem> items) => JsonSerializer.Serialize(items, Json);

    private static double Round2(double n) => Js.Round(n * 100) / 100;
}
