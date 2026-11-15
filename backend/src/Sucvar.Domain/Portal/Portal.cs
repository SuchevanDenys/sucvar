using System.Text.Json;
using System.Text.RegularExpressions;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Studio;

namespace Sucvar.Domain.Portal;

public static class ClientStatuses
{
    public const string Pending = "pending";
    public static readonly string[] All = [Pending, "approved", "changes_requested"];
    public static readonly string[] Decisions = ["approved", "changes_requested"];
    public const int FeedbackMax = 500;

    public static string ToClientStatus(string? v) => v is not null && All.Contains(v) ? v : Pending;
}

/// <summary>Sharing state of a project, visible only to its owner.</summary>
public sealed record ProjectSharing(string ProjectId, bool IsPublic, string ClientStatus, string? ClientFeedback, string? ClientReviewedAt);

public sealed record PublicMaterial(string Category, string NameRo, string NameEn, string Unit, double Qty);

/// <summary>Retailer search link shown to the client (rebuilt server-side, never copied from stored JSON).</summary>
public sealed record PublicRetailerLink(string Retailer, string Label, string Url);

/// <summary>
/// One client-facing line of the specification sheet. `ClientUnitPrice` already includes every internal
/// uplift (contingency + margin) for B2B quotes, or is the indicative market price for Studio estimates —
/// the purchase price, the margin and its percentage are never part of this record.
/// </summary>
public sealed record PublicLineItem(
    string Id,
    string Category,
    string Name,
    string NameEn,
    double Quantity,
    string Unit,
    double ClientUnitPrice,
    double ClientLineTotal,
    string? RetailerName,
    string? RetailerUrl,
    IReadOnlyList<PublicRetailerLink> Links);

/// <summary>Where the final number comes from. `PricingSource` = "b2b_quote" | "studio_estimate".</summary>
public sealed record PricingBreakdown(
    double MaterialsSubtotal,
    double LaborSubtotal,
    double VatRate,
    double VatAmount,
    double GrandTotal,
    string Currency,
    string PricingSource);

public sealed record PublicDimensions(double Width, double Length, double Height, double DoorsCount, double WindowsCount);

/// <summary>
/// What the end client sees in /p/[id]. Built field-by-field: any new DB column stays private
/// until it is added here explicitly.
/// </summary>
public sealed record PublicProject(
    string Id,
    string Reference,
    string Title,
    string Mode,
    string SpaceType,
    string StyleId,
    PublicDimensions Dimensions,
    double AreaM2,
    string? OriginalImage,
    string? GeneratedImage,
    IReadOnlyList<PublicMaterial> Materials,
    double ClientTotal,
    bool VatIncluded,
    string ClientStatus,
    string? ClientReviewedAt,
    string CreatedAt,
    IReadOnlyList<PublicLineItem> Items,
    PricingBreakdown PricingBreakdown,
    // The designer's free-text vision (Studio "Descrie ce îți dorești"), stored as dimensions.brief.customPrompt
    string? DesignBrief = null);

public sealed record ReviewResult(string ClientStatus, string? ClientReviewedAt);

/// <summary>The public columns read from `projects` (user_id is only used to find the owner's estimate).</summary>
public sealed record PublicProjectSource(
    string Id,
    string? Title,
    string? Mode,
    string? SpaceType,
    string? StyleId,
    string? DimensionsJson,
    string? OriginalImage,
    string? GeneratedImage,
    double TotalBudget,
    string CreatedAt,
    string? ClientStatus,
    string? ClientReviewedAt,
    string? ProcurementItemsJson = null);

/// <summary>
/// Estimate columns the portal needs on the SERVER. Contingency / margin / VAT % and the net subtotal are
/// read only to bake them into client line prices (<see cref="PublicProjection.Pricing"/>); none of them is
/// ever copied into <see cref="PublicProject"/>. Rates, scope, crew and client notes are not even read.
/// </summary>
public sealed record PublicEstimateSource(
    string? DocNo,
    double AreaM2,
    string? LineItemsJson,
    double Total,
    double ContingencyPct = 0,
    double MarginPct = 0,
    double VatPct = 20,
    double NetSubtotal = 0);

/// <summary>French standard VAT — TVA taux normal (same value as EstimateParser.DefaultVatPct, kept here to avoid a B2B dependency).</summary>
public static class EstimateDefaults
{
    public const double VatPct = 20;
}

/// <summary>Port of getPublicProject's projection (app/lib/server/db.ts).</summary>
public static partial class PublicProjection
{
    public static IReadOnlyList<PublicMaterial> ToPublicMaterials(string? lineItemsJson)
    {
        if (string.IsNullOrEmpty(lineItemsJson)) return [];
        using var doc = JsonDocument.Parse(lineItemsJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];

        static string Str(JsonElement it, string name)
        {
            var v = Js.Prop(it, name);
            if (v is null || v.Value.ValueKind == JsonValueKind.Null) return "";
            return v.Value.ValueKind switch
            {
                JsonValueKind.String => v.Value.GetString()!,
                JsonValueKind.Number => Js.Str(v.Value.GetDouble()),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => v.Value.GetRawText(),
            };
        }
        static bool Truthy(JsonElement it, string name) => Js.AsString(Js.Prop(it, name)) is { Length: > 0 }
            || Js.Prop(it, name) is { ValueKind: JsonValueKind.Number or JsonValueKind.True or JsonValueKind.Object or JsonValueKind.Array };

        return doc.RootElement.EnumerateArray()
            .Where(it => it.ValueKind == JsonValueKind.Object && Js.ToNumber(Js.Prop(it, "qty")) > 0 && (Truthy(it, "ro") || Truthy(it, "en")))
            .Take(200)
            .Select(it =>
            {
                var ro = Str(it, "ro");
                var en = Str(it, "en");
                return new PublicMaterial(
                    Js.Slice(Str(it, "cat"), 40),
                    Js.Slice(ro.Length > 0 ? ro : en, 200),
                    Js.Slice(en.Length > 0 ? en : ro, 200),
                    Js.Slice(Str(it, "unit"), 20),
                    Js.Round(Js.ToNumber(Js.Prop(it, "qty")) * 100) / 100);
            })
            .ToList();
    }

    public static PublicProject Project(PublicProjectSource row, PublicEstimateSource? estimate)
    {
        var mode = row.Mode is "exteriors" or "gardens" ? row.Mode : "interiors";
        var spaceType = row.SpaceType ?? "kitchen";
        JsonElement? dimsEl = null;
        if (!string.IsNullOrEmpty(row.DimensionsJson))
        {
            using var doc = JsonDocument.Parse(row.DimensionsJson);
            dimsEl = doc.RootElement.Clone();
        }
        var dims = DimensionSanitizer.Sanitize(dimsEl, mode, spaceType);
        var estimateTotal = estimate?.Total is { } t && double.IsFinite(t) ? t : 0;
        var estimateArea = estimate?.AreaM2 is { } a && double.IsFinite(a) ? a : 0;
        var docNo = estimate?.DocNo?.Trim() ?? "";
        var title = (row.Title ?? "").Trim();
        var (items, pricing) = Pricing(row, mode, spaceType, estimate);

        return new PublicProject(
            row.Id,
            docNo.Length > 0 ? docNo : $"SUC-{Js.Slice(NonAlnum().Replace(row.Id, ""), 8).ToUpperInvariant()}",
            title.Length > 0 ? title : "Proiect SUCVAR",
            mode,
            spaceType,
            row.StyleId ?? "scandinavian",
            new PublicDimensions(dims.Width, dims.Length, dims.Height, dims.DoorsCount, dims.WindowsCount),
            estimateArea > 0 ? estimateArea : Engineering.Calculate(dims, mode, spaceType).FloorArea,
            row.OriginalImage,
            row.GeneratedImage,
            ToPublicMaterials(estimate?.LineItemsJson),
            Js.Round((estimateTotal > 0 ? estimateTotal : row.TotalBudget) * 100) / 100,
            estimateTotal > 0,
            ClientStatuses.ToClientStatus(row.ClientStatus),
            row.ClientReviewedAt,
            row.CreatedAt,
            items,
            pricing,
            ReadDesignBrief(dimsEl));
    }

    /// <summary>dimensions.brief.customPrompt (written by the Studio since the smart-prompt release), cleaned; null when absent.</summary>
    public static string? ReadDesignBrief(JsonElement? dimensions)
    {
        var text = Js.AsString(Js.Prop(Js.Prop(dimensions, "brief"), "customPrompt"));
        var clean = Sucvar.Domain.Ai.DesignVision.CleanCustomPrompt(text);
        return clean.Length == 0 ? null : Js.Slice(clean, Sucvar.Domain.Ai.DesignVision.CustomPromptMaxLength);
    }

    // ── Client pricing (computed on the server; internal economics never leave this method) ──

    private sealed record RawLine(string Id, string Cat, string Ro, string En, string Unit, double Qty, double Price);

    private static double Round2(double n) => Js.Round(n * 100) / 100;

    private static List<RawLine> ParseLines(string? json)
    {
        if (string.IsNullOrEmpty(json)) return [];
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
        static string S(JsonElement it, string name) => Js.AsString(Js.Prop(it, name))?.Trim() ?? "";
        static double N(JsonElement it, string name)
        {
            var n = Js.ToNumber(Js.Prop(it, name));
            return double.IsFinite(n) ? Math.Clamp(n, 0, 1e9) : 0;
        }
        return doc.RootElement.EnumerateArray()
            .Where(it => it.ValueKind == JsonValueKind.Object)
            .Select((it, i) => new RawLine(
                Js.Slice(S(it, "id") is { Length: > 0 } id ? id : $"l{i}", 40),
                Js.Slice(S(it, "cat"), 40), Js.Slice(S(it, "ro"), 200), Js.Slice(S(it, "en"), 200), Js.Slice(S(it, "unit"), 20),
                Round2(N(it, "qty")), N(it, "price")))
            .Where(l => l.Qty > 0 && (l.Ro.Length > 0 || l.En.Length > 0))
            .Take(200)
            .ToList();
    }

    private static IReadOnlyList<PublicRetailerLink> ToPublicLinks(IReadOnlyList<RetailerLink> links) =>
        links.Select(l => new PublicRetailerLink(l.Retailer, l.Label, l.Url)).ToList();

    private static PublicLineItem Line(string id, string cat, string ro, string en, double qty, string unit, double unitPrice,
        IReadOnlyList<PublicRetailerLink> links) =>
        new(id, cat, ro.Length > 0 ? ro : en, en.Length > 0 ? en : ro, qty, unit, unitPrice, Round2(qty * unitPrice),
            links.Count > 0 ? links[0].Label : null, links.Count > 0 ? links[0].Url : null, links);

    /// <summary>B2B line category → retailer family (decides which shops are listed first).</summary>
    private static string ProcCategoryFor(string cat, string mode) =>
        mode != "interiors" ? "outdoor" : cat == "other" ? "furniture" : "construction";

    /// <summary>
    /// Itemised client lines + cost summary.
    /// • B2B quote: each purchase price is multiplied by (1 + contingency) × (1 + margin) — exactly how /b2b
    ///   spreads them pro-rata on invoice lines — so the client sees one final unit price per line. Labour is the
    ///   rest of the quote's net amount; VAT = total − net. The factor is capped so materials never exceed net.
    /// • No quote: the Studio's indicative market prices (BOM), labour = Studio estimate − materials, standard VAT.
    /// </summary>
    public static (IReadOnlyList<PublicLineItem> Items, PricingBreakdown Pricing) Pricing(
        PublicProjectSource row, string mode, string spaceType, PublicEstimateSource? estimate)
    {
        var (bom, _) = ProcurementStore.Resolve(row.ProcurementItemsJson, mode, spaceType, row.StyleId, row.DimensionsJson);
        var total = estimate is { Total: var t } && double.IsFinite(t) && t > 0 ? t : 0;

        if (estimate is not null && total > 0)
        {
            var lines = ParseLines(estimate.LineItemsJson);
            var vatRate = double.IsFinite(estimate.VatPct) ? Math.Clamp(estimate.VatPct, 0, 100) : EstimateDefaults.VatPct;
            var net = estimate.NetSubtotal > 0 && estimate.NetSubtotal <= total ? estimate.NetSubtotal : total / (1 + vatRate / 100);
            var uplift = (1 + Math.Clamp(estimate.ContingencyPct, 0, 100) / 100) * (1 + Math.Clamp(estimate.MarginPct, 0, 100) / 100);
            var raw = lines.Sum(l => l.Qty * l.Price);
            if (raw > 0 && raw * uplift > net) uplift = net / raw; // stale/partial quote: never let materials exceed the net amount

            var byId = bom.GroupBy(b => b.Id).ToDictionary(g => g.Key, g => g.First());
            var items = lines.Select(l =>
            {
                var links = byId.TryGetValue(l.Id, out var b)
                    ? b.Links
                    : BomBuilder.BuildRetailerLinks(Js.StripDiacritics(l.Ro.Length > 0 ? l.Ro : l.En), ProcCategoryFor(l.Cat, mode));
                return Line(l.Id, l.Cat, l.Ro, l.En, l.Qty, l.Unit, Round2(l.Price * uplift), ToPublicLinks(links));
            }).ToList();

            var materials = Round2(items.Sum(i => i.ClientLineTotal));
            var labor = Math.Max(Round2(net - materials), 0);
            var vat = Math.Max(Round2(total - net), 0);
            return (items, new PricingBreakdown(materials, labor, vatRate, vat, Round2(materials + labor + vat), "EUR", "b2b_quote"));
        }

        var studioItems = bom.Select(b => Line(b.Id, b.Cat, b.TitleRo, b.TitleEn, b.Qty, b.Unit, b.UnitPrice, ToPublicLinks(b.Links))).ToList();
        var studioMaterials = Round2(studioItems.Sum(i => i.ClientLineTotal));
        var studioNet = Math.Max(Round2(double.IsFinite(row.TotalBudget) ? row.TotalBudget : 0), studioMaterials);
        var studioLabor = Round2(studioNet - studioMaterials);
        var studioVat = Round2(studioNet * EstimateDefaults.VatPct / 100);
        return (studioItems, new PricingBreakdown(studioMaterials, studioLabor, EstimateDefaults.VatPct, studioVat,
            Round2(studioNet + studioVat), "EUR", "studio_estimate"));
    }

    /// <summary>Strip C0/C1 control characters except \t \n \r, then trim (review route).</summary>
    public static string CleanFeedback(string? feedback) => ControlChars().Replace(feedback ?? "", "").Trim();

    [GeneratedRegex("[^a-z0-9]", RegexOptions.IgnoreCase)]
    private static partial Regex NonAlnum();

    [GeneratedRegex("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]")]
    private static partial Regex ControlChars();
}
