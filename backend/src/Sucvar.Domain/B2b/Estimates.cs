using System.Text.Json;
using System.Text.RegularExpressions;

namespace Sucvar.Domain.B2b;

/// <summary>One line in the quote (line_items jsonb) — mirror of EstimateLineItem.</summary>
public sealed record EstimateLineItem(string Id, string Cat, string Ro, string En, string Unit, double Qty, double Price);

/// <summary>The end-client of the contractor (client jsonb) — mirror of EstimateClient.</summary>
public sealed record EstimateClient(string Name, string VatId, string Email, string Phone, string Address, string SiteAddress, string Notes);

/// <summary>EstimatePayload (camelCase API contract, maps 1:1 onto b2b_estimates).</summary>
public sealed record EstimatePayload(
    string? ProjectId,
    string DocNo,
    string Status,
    EstimateClient Client,
    string Region,
    string FinishLevel,
    double AreaM2,
    double Crew,
    double ContingencyPct,
    double MarginPct,
    double VatPct,
    IReadOnlyDictionary<string, double> Scope,
    IReadOnlyDictionary<string, double> RateOverride,
    IReadOnlyList<EstimateLineItem> LineItems,
    double Subtotal,
    double Total);

/// <summary>EstimateRecord = payload + system fields.</summary>
public sealed record EstimateRecord(
    string Id,
    string? ProjectId,
    string DocNo,
    string Status,
    EstimateClient Client,
    string Region,
    string FinishLevel,
    double AreaM2,
    double Crew,
    double ContingencyPct,
    double MarginPct,
    double VatPct,
    IReadOnlyDictionary<string, double> Scope,
    IReadOnlyDictionary<string, double> RateOverride,
    IReadOnlyList<EstimateLineItem> LineItems,
    double Subtotal,
    double Total,
    string CreatedAt,
    string UpdatedAt);

public sealed record ParsedEstimate(bool Ok, EstimatePayload? Value, string? Error)
{
    public static ParsedEstimate Fail(string error) => new(false, null, error);
}

/// <summary>Port of app/lib/server/estimates.ts — parses untrusted quote bodies with clamps and truncation.</summary>
public static partial class EstimateParser
{
    public const int MaxItems = 500;
    /// <summary>
    /// French market: TVA taux normal 20% by default; 10% (taux intermédiaire, rénovation d'un logement de plus
    /// de 2 ans) is the other one-click rate. Deliberate deviation from the monolith's 19% fallback. See migration 007.
    /// </summary>
    public const double DefaultVatPct = 20;
    /// <summary>TVA taux intermédiaire — travaux de rénovation dans un logement achevé depuis plus de 2 ans.</summary>
    public const double RenovationVatPct = 10;
    /// <summary>Rates offered as one-click choices in the /b2b editor and the /account defaults.</summary>
    public static readonly double[] FrenchVatRates = [DefaultVatPct, RenovationVatPct];
    /// <summary>Default pricing region (Paris intra-muros); the monolith used "bucharest".</summary>
    public const string DefaultRegion = "paris";
    public static readonly string[] Statuses = ["draft", "sent", "accepted", "rejected"];

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase)]
    public static partial Regex UuidPattern();

    /// <summary>projects.id is text: any short string without control characters. JS \w = [A-Za-z0-9_].</summary>
    [GeneratedRegex(@"^[A-Za-z0-9_.:-]{1,128}$")]
    public static partial Regex ProjectIdPattern();

    private static string Text(JsonElement? v, int max) => Js.AsString(v) is { } s ? Js.Slice(s.Trim(), max) : "";

    private static double Num(JsonElement? v, double min, double max, double? fallback = null)
    {
        var n = Js.ToNumber(v);
        return double.IsFinite(n) ? Math.Min(Math.Max(n, min), max) : fallback ?? min;
    }

    private static double Money(JsonElement? v) => Js.Round(Num(v, 0, 1e9) * 100) / 100;

    private static Dictionary<string, double> NumberMap(JsonElement? v)
    {
        var output = new Dictionary<string, double>();
        if (!Js.IsRecord(v)) return output;
        foreach (var prop in v!.Value.EnumerateObject().Take(20))
        {
            output[Js.Slice(prop.Name, 40)] = Num(prop.Value, 0, 1e6);
        }
        return output;
    }

    public static ParsedEstimate Parse(JsonElement? body)
    {
        if (!Js.IsRecord(body)) return ParsedEstimate.Fail("Corp invalid: se așteaptă un obiect JSON.");
        JsonElement? P(string n) => Js.Prop(body, n);

        string? projectId = null;
        var pid = P("projectId");
        if (pid is { } pidEl && pidEl.ValueKind != JsonValueKind.Null)
        {
            if (pidEl.ValueKind != JsonValueKind.String || !ProjectIdPattern().IsMatch(pidEl.GetString()!))
                return ParsedEstimate.Fail("projectId invalid.");
            projectId = pidEl.GetString();
        }

        // `body.status ?? 'draft'`: absent or null → draft; anything else must be a known string
        var statusEl = P("status");
        string status;
        if (statusEl is null || statusEl.Value.ValueKind == JsonValueKind.Null) status = "draft";
        else if (statusEl.Value.ValueKind == JsonValueKind.String && Statuses.Contains(statusEl.Value.GetString())) status = statusEl.Value.GetString()!;
        else return ParsedEstimate.Fail("status invalid.");

        var itemsEl = P("lineItems");
        if (itemsEl is not null && itemsEl.Value.ValueKind != JsonValueKind.Array) return ParsedEstimate.Fail("lineItems trebuie să fie o listă.");
        var rawItems = itemsEl is { } arr ? arr.EnumerateArray().ToList() : [];
        if (rawItems.Count > MaxItems) return ParsedEstimate.Fail($"Maxim {MaxItems} poziții în deviz.");

        var lineItems = rawItems
            .Where(it => it.ValueKind == JsonValueKind.Object)
            .Select((it, i) =>
            {
                JsonElement? I(string n) => Js.Prop(it, n);
                var id = Text(I("id"), 40);
                return new EstimateLineItem(id.Length > 0 ? id : $"l{i}", Text(I("cat"), 40), Text(I("ro"), 200), Text(I("en"), 200),
                    Text(I("unit"), 20), Num(I("qty"), 0, 1e7), Money(I("price")));
            })
            .ToList();

        var c = Js.IsRecord(P("client")) ? P("client") : null;
        JsonElement? C(string n) => Js.Prop(c, n);
        var client = new EstimateClient(Text(C("name"), 200), Text(C("vatId"), 40), Text(C("email"), 200), Text(C("phone"), 40),
            Text(C("address"), 300), Text(C("siteAddress"), 300), Text(C("notes"), 2000));

        var region = Text(P("region"), 40);
        var finish = Text(P("finishLevel"), 40);
        return new ParsedEstimate(true, new EstimatePayload(
            projectId,
            Text(P("docNo"), 60),
            status,
            client,
            region.Length > 0 ? region : DefaultRegion,
            finish.Length > 0 ? finish : "standard",
            Money(P("areaM2")),
            Js.Round(Num(P("crew"), 1, 500, 1)),
            Num(P("contingencyPct"), 0, 100, 0),
            Num(P("marginPct"), 0, 100, 0),
            Num(P("vatPct"), 0, 100, DefaultVatPct),
            NumberMap(P("scope")),
            NumberMap(P("rateOverride")),
            lineItems,
            Money(P("subtotal")),
            Money(P("total"))), null);
    }
}
