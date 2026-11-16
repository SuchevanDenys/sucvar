namespace Sucvar.Domain.Procurement;

/// <summary>
/// Romanian market retailer routing — exact mirror of frontend <c>app/lib/retailers.ts</c>.
///
/// <para>The bill of materials stores a Romanian, diacritic-free <c>query</c> (e.g. "parchet stejar"); it is used
/// verbatim in the search links, so stored lists, custom lines and golden fixtures need no translation.</para>
///
/// <para>Routing: trade / building materials (gips-carton, polistiren, șapă, parchet, gresie, faianță, tencuieli,
/// lemn) → Dedeman, Hornbach, Brico Dépôt; finishes and decor → Dedeman, Leroy Merlin, Hornbach; furniture →
/// IKEA, Mobexpert, Dedeman; lighting → IKEA, Dedeman, Leroy Merlin.</para>
/// </summary>
public static class RomanianRetail
{
    public static readonly IReadOnlyDictionary<string, (string Label, Func<string, string> Build)> Retailers =
        new Dictionary<string, (string, Func<string, string>)>
        {
            ["dedeman"] = ("Dedeman", q => $"https://www.dedeman.ro/ro/catalogsearch/result/?q={q}"),
            ["leroymerlin"] = ("Leroy Merlin", q => $"https://www.leroymerlin.ro/search?q={q}"),
            ["hornbach"] = ("Hornbach", q => $"https://www.hornbach.ro/s/{q}"),
            ["bricodepot"] = ("Brico Dépôt", q => $"https://www.bricodepot.ro/cautare/?q={q}"),
            ["ikea"] = ("IKEA România", q => $"https://www.ikea.com/ro/ro/search/?q={q}"),
            ["mobexpert"] = ("Mobexpert", q => $"https://mobexpert.ro/search?q={q}"),
        };

    /// <summary>Retailer order per routing lane (three links per line).</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Lanes = new Dictionary<string, string[]>
    {
        ["trade"] = ["dedeman", "hornbach", "bricodepot"],
        ["finish"] = ["dedeman", "leroymerlin", "hornbach"],
        ["furniture"] = ["ikea", "mobexpert", "dedeman"],
        ["lighting"] = ["ikea", "dedeman", "leroymerlin"],
        ["outdoorTrade"] = ["dedeman", "bricodepot", "hornbach"],
        ["outdoor"] = ["dedeman", "leroymerlin", "hornbach"],
    };

    /// <summary>Romanian stems that mark a trade / building material (matched on the diacritic-free query).</summary>
    private static readonly string[] TradeStems =
    [
        "gips carton", "polistiren", "vata", "sapa", "mortar", "adeziv", "parchet", "gresie", "faianta", "beton",
        "tencuiala", "amorsa", "membrana", "hidroizolatie", "rigla", "dale", "pamant", "bordura", "lemn lamelat",
        "grinzi", "gabion", "plinta", "glaf", "deck", "pietris", "travertin", "piatra", "terrazzo", "caramida",
        "microciment",
    ];

    public static string Lane(string procCategory, string query)
    {
        var trade = IsTrade(query);
        return procCategory switch
        {
            "construction" => trade ? "trade" : "finish",
            "furniture" => "furniture",
            "lighting" => "lighting",
            "outdoor" => trade ? "outdoorTrade" : "outdoor",
            _ => "finish",
        };
    }

    public static bool IsTrade(string query)
    {
        var n = Js.StripDiacritics(query).ToLowerInvariant();
        return TradeStems.Any(s => n.Contains(s, StringComparison.Ordinal));
    }

    public static IReadOnlyList<RetailerLink> BuildLinks(string query, string procCategory)
    {
        var ro = Js.Slice(query.Trim(), 120);
        var q = Js.EncodeUriComponent(ro);
        return Lanes[Lane(procCategory, ro)]
            .Select(id => new RetailerLink(id, Retailers[id].Label, Retailers[id].Build(q)))
            .ToList();
    }
}
