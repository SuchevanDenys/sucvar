using System.Text.RegularExpressions;

namespace Sucvar.Domain.Procurement;

/// <summary>
/// French market (Paris &amp; Île-de-France) retailer routing — mirror of frontend <c>app/lib/retailers.ts</c>.
///
/// <para>The bill of materials keeps its historical (Romanian, diacritic-free) <c>query</c> so stored lists and
/// golden fixtures stay compatible; the search links are built from a deterministic French translation of that
/// query (<see cref="TranslateQuery"/>). Unknown queries (e.g. a custom line saved by the browser) are used as-is.</para>
///
/// <para>Routing: pro trade materials (plasterboard / BA13, insulation, screed, flooring, tiles, technical coatings,
/// timber) go to the trade counters (Point.P, La Plateforme du Bâtiment, Brico Dépôt); decor, fixtures, paint,
/// furniture and lighting go to Leroy Merlin, Castorama, IKEA France and ManoMano.</para>
/// </summary>
public static partial class FrenchRetail
{
    public static readonly IReadOnlyDictionary<string, (string Label, Func<string, string> Build)> Retailers =
        new Dictionary<string, (string, Func<string, string>)>
        {
            ["leroymerlin"] = ("Leroy Merlin", q => $"https://www.leroymerlin.fr/search?keyword={q}"),
            ["castorama"] = ("Castorama", q => $"https://www.castorama.fr/search?term={q}"),
            ["ikea"] = ("IKEA France", q => $"https://www.ikea.com/fr/fr/search/?q={q}"),
            ["manomano"] = ("ManoMano", q => $"https://www.manomano.fr/recherche/{q}"),
            ["bricodepot"] = ("Brico Dépôt", q => $"https://www.bricodepot.fr/catalogue/recherche?q={q}"),
            ["laplateforme"] = ("La Plateforme du Bâtiment", q => $"https://www.laplateforme.com/recherche?q={q}"),
            ["pointp"] = ("Point.P", q => $"https://www.pointp.fr/search?text={q}"),
        };

    /// <summary>Retailer order per routing lane (three links per line, like before).</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Lanes = new Dictionary<string, string[]>
    {
        ["trade"] = ["pointp", "laplateforme", "bricodepot"],
        ["finish"] = ["leroymerlin", "castorama", "manomano"],
        ["furniture"] = ["ikea", "manomano", "castorama"],
        ["lighting"] = ["ikea", "leroymerlin", "manomano"],
        ["outdoorTrade"] = ["bricodepot", "laplateforme", "leroymerlin"],
        ["outdoor"] = ["leroymerlin", "castorama", "manomano"],
    };

    /// <summary>French stems that mark a pro trade material (matched on the diacritic-free French query).</summary>
    private static readonly string[] TradeStems =
    [
        "plaque de platre", "ba13", "placo", "rail", "isolant", "laine", "polystyrene", "ragreage", "chape", "mortier",
        "parquet", "stratifie", "carrelage", "gres cerame", "faience", "beton", "enduit", "membrane", "etancheite",
        "lambourde", "bois autoclave", "dalle", "terre vegetale", "bordure", "lamelle-colle", "poutre", "gabion",
        "plinthe", "appui de fenetre", "terrasse composite", "gravier", "travertin", "pierre", "terrazzo", "plaquette",
    ];

    public static string Lane(string procCategory, string frenchQuery)
    {
        var trade = IsTrade(frenchQuery);
        return procCategory switch
        {
            "construction" => trade ? "trade" : "finish",
            "furniture" => "furniture",
            "lighting" => "lighting",
            "outdoor" => trade ? "outdoorTrade" : "outdoor",
            _ => "finish",
        };
    }

    public static bool IsTrade(string frenchQuery)
    {
        var n = Js.StripDiacritics(frenchQuery).ToLowerInvariant();
        return TradeStems.Any(s => n.Contains(s, StringComparison.Ordinal));
    }

    public static IReadOnlyList<RetailerLink> BuildLinks(string query, string procCategory)
    {
        var fr = Js.Slice(TranslateQuery(query).Trim(), 120);
        var q = Js.EncodeUriComponent(fr);
        return Lanes[Lane(procCategory, fr)]
            .Select(id => new RetailerLink(id, Retailers[id].Label, Retailers[id].Build(q)))
            .ToList();
    }

    /// <summary>Lower-case, diacritic-free, single-spaced key; colour temperatures become the {k} placeholder.</summary>
    public static string Key(string query) =>
        KelvinPattern().Replace(Spaces().Replace(Js.StripDiacritics(query).Trim().ToLowerInvariant(), " "), "{k}k");

    /// <summary>Romanian BOM query → French retailer query (unknown queries pass through unchanged).</summary>
    public static string TranslateQuery(string query)
    {
        var key = Key(query);
        if (!QueryMap.TryGetValue(key, out var fr)) return query;
        if (!fr.Contains("{k}", StringComparison.Ordinal)) return fr;
        var kelvin = KelvinPattern().Match(Js.StripDiacritics(query).ToLowerInvariant());
        return fr.Replace("{k}", kelvin.Success ? kelvin.Groups[1].Value : "3000", StringComparison.Ordinal);
    }

    private static readonly Dictionary<string, string> QueryMap = new(StringComparer.Ordinal)
    {
        // Space kits (furniture, sanitary)
        ["canapea 3 locuri"] = "canapé 3 places",
        ["comoda tv living"] = "meuble tv",
        ["corpuri bucatarie"] = "meuble de cuisine",
        ["blat bucatarie"] = "plan de travail cuisine",
        ["pat 160x200"] = "lit 160x200 avec sommier",
        ["dulap dormitor usi glisante"] = "armoire portes coulissantes",
        ["vas wc suspendat rezervor incastrat"] = "wc suspendu avec bâti-support",
        ["cabina dus sticla securizata"] = "paroi de douche verre trempé",
        ["birou 140x70"] = "bureau 140x70",
        ["scaun birou ergonomic"] = "fauteuil de bureau ergonomique",
        ["pantofar cu banca"] = "banc à chaussures",
        ["oglinda hol cuier"] = "miroir d'entrée portemanteau",
        ["canapea extensibila"] = "canapé convertible",
        ["raft mansarda"] = "étagère sous pente",
        ["sistem dressing modular"] = "dressing modulable",
        ["comoda sertare"] = "commode tiroirs",
        ["masa cafenea"] = "table bistrot",
        ["scaun cafenea horeca"] = "chaise CHR empilable",
        ["set mobilier gradina"] = "salon de jardin",
        ["ghivece mari exterior"] = "grand pot de fleurs extérieur",
        // Style floors / walls
        ["parchet stejar uleiat"] = "parquet chêne huilé",
        ["vopsea lavabila alb cald"] = "peinture murale blanc cassé mat",
        ["parchet laminat stejar gri"] = "sol stratifié chêne gris",
        ["vopsea lavabila alba mata"] = "peinture murale blanche mate",
        ["parchet triplustratificat nuc"] = "parquet contrecollé noyer",
        ["vopsea lavabila gri"] = "peinture murale grise",
        ["gresie portelanata beton 80x80"] = "carrelage grès cérame effet béton 80x80",
        ["vopsea lavabila alba"] = "peinture murale blanche",
        ["gresie portelanata neagra mata"] = "carrelage grès cérame noir mat",
        ["vopsea lavabila antracit"] = "peinture murale anthracite",
        ["parchet stejar natural periat"] = "parquet chêne brossé",
        ["vopsea lavabila bej"] = "peinture murale beige",
        ["parchet masiv stejar"] = "parquet massif chêne",
        ["vopsea lavabila crem"] = "peinture murale crème",
        ["parchet nuc triplustratificat"] = "parquet contrecollé noyer",
        ["vopsea lavabila verde salvie"] = "peinture murale vert sauge",
        ["parchet stejar albit"] = "parquet chêne blanchi",
        ["vopsea lavabila albastru deschis"] = "peinture murale bleu clair",
        ["gresie aspect beton"] = "carrelage effet béton",
        ["vopsea lavabila gri beton"] = "peinture murale gris béton",
        ["gresie portelanata beton"] = "carrelage grès cérame effet béton",
        ["amorsa decorativa aspect beton"] = "enduit décoratif effet béton",
        ["parchet stejar natural"] = "parquet chêne naturel",
        ["vopsea lavabila verde"] = "peinture murale verte",
        ["parchet laminat"] = "sol stratifié",
        ["vopsea lavabila"] = "peinture murale",
        // Geometry-driven lines
        ["sapa autonivelanta"] = "ragréage autonivelant",
        ["gresie portelanata 60x60 antiderapanta"] = "carrelage grès cérame 60x60 antidérapant",
        ["faianta 30x60"] = "faïence murale 30x60",
        ["vopsea lavabila anti mucegai baie"] = "peinture salle de bain anti-humidité",
        ["plinta mdf 80 mm"] = "plinthe MDF 80 mm",
        ["placa gips carton 12.5 mm"] = "plaque de plâtre BA13",
        ["banda led {k}k profil aluminiu"] = "ruban LED {k}K profilé aluminium",
        ["spot led incastrat {k}k"] = "spot LED encastrable {k}K",
        ["polistiren expandat eps 100 10 cm"] = "isolant polystyrène expansé ITE 100 mm",
        ["tencuiala decorativa siliconica fatada"] = "enduit de façade siloxane",
        ["glaf exterior aluminiu"] = "appui de fenêtre aluminium",
        ["deck exterior wpc"] = "lame de terrasse composite",
        ["rigla lemn tratat autoclavizat"] = "lambourde bois autoclave",
        ["aplica led exterior ip65 {k}k"] = "applique LED extérieure IP65 {k}K",
        ["dale beton exterior"] = "dalle béton extérieure",
        ["gazon rulou"] = "gazon en rouleau",
        ["pamant vegetal"] = "terre végétale",
        ["bordura gradina"] = "bordure de jardin",
        ["baliza led gradina {k}k"] = "borne LED jardin {k}K",
        // Vision lexicon
        ["parchet in spic herringbone"] = "parquet chêne bâton rompu",
        ["parchet point de hongrie"] = "parquet chêne point de Hongrie",
        ["parchet stejar"] = "parquet chêne",
        ["parchet nuc"] = "parquet noyer",
        ["gresie terrazzo"] = "carrelage terrazzo",
        ["microciment"] = "béton ciré",
        ["gresie aspect marmura"] = "carrelage effet marbre",
        ["travertin"] = "carrelage travertin",
        ["vopsea decorativa var"] = "peinture à la chaux",
        ["panouri riflaje lemn"] = "panneau tasseaux bois",
        ["placaj caramida aparenta"] = "plaquette de parement brique",
        ["tapet"] = "papier peint intissé",
        ["banda led profil aluminiu"] = "ruban LED profilé aluminium",
        ["lustra suspendata"] = "suspension luminaire",
        ["lampadar"] = "lampadaire",
        ["canapea in"] = "canapé lin",
        ["canapea catifea"] = "canapé velours",
        ["canapea piele"] = "canapé cuir",
        ["fotoliu boucle"] = "fauteuil bouclette",
        ["scaun ratan"] = "chaise rotin",
        ["masa dining lemn masiv"] = "table à manger bois massif",
        ["biblioteca rafturi"] = "bibliothèque étagère",
        ["baterie negru mat"] = "robinetterie noir mat",
        ["accesorii alama"] = "poignées laiton",
        ["blat cuart"] = "plan de travail quartz",
        ["plante interior mari"] = "grande plante d'intérieur",
        ["covor lana"] = "tapis laine",
        ["draperii in"] = "rideaux lin",
        ["mulura decorativa"] = "moulure décorative plafond",
        ["verriere atelier"] = "verrière atelier acier noir",
        ["piatra de paris"] = "parement pierre de Paris",
        // Scenario chips (first material of each scenario)
        ["piatra naturala placata"] = "parement pierre naturelle",
        ["masa extensibila"] = "table extensible",
        ["rafturi mdf pana in tavan"] = "bibliothèque sur mesure",
        ["tamplarie glisanta aluminiu"] = "baie vitrée coulissante aluminium",
        ["blat cuart 20 mm"] = "plan de travail quartz 20 mm",
        ["corpuri 60 cm modulare"] = "meuble de cuisine 60 cm",
        ["masa dining 160 cm"] = "table à manger 160 cm",
        ["coloane h 240 cm"] = "colonne de cuisine",
        ["lambriu mdf vopsit"] = "lambris MDF à peindre",
        ["sticla securizata 8 mm"] = "paroi de douche verre 8 mm",
        ["draperii dublu-strat pe sina ascunsa"] = "rail à rideaux encastré",
        ["blat suspendat 60 cm"] = "bureau mural suspendu",
        ["gresie 120×60 rectificata"] = "carrelage grès cérame 60x120 rectifié",
        ["cada acril/piatra compozita"] = "baignoire îlot",
        ["cabina sauna lemn cedru"] = "sauna cèdre",
        ["blat 160×75"] = "bureau assis-debout 160x75",
        ["masa ø90"] = "table ronde 90 cm",
        ["panouri fonoabsorbante pet"] = "panneau acoustique",
        ["rafturi stejar 220 cm"] = "bibliothèque chêne",
        ["corp pal 18 mm"] = "meuble d'entrée",
        ["oglinda 6 mm"] = "miroir mural grand format",
        ["gresie 80×80 antiderapanta r10"] = "carrelage grès cérame 80x80 antidérapant R10",
        ["ferestre velux 78×140"] = "fenêtre de toit 78x140",
        ["dulapuri pe comanda la inclinatie"] = "placard sous pente",
        ["grinzi lemn tratate ignifug"] = "poutre bois traitée",
        ["baie prefabricata compacta"] = "cabine de douche intégrale",
        ["sertare soft-close"] = "tiroir à fermeture amortie",
        ["profile led {k}k"] = "profilé LED {k}K",
        ["rafturi inclinate"] = "étagère à chaussures inclinée",
        ["tejghea corian"] = "comptoir Corian",
        ["blat lemn masiv 40 mm"] = "plan de travail bois massif 40 mm",
        ["canapele tapitate ignifug (m1)"] = "banquette CHR non feu M1",
        ["baffle fonoabsorbant"] = "baffle acoustique",
        ["riflaj pin termotratat 20×120"] = "bardage bois thermotraité",
        ["tamplarie aluminiu cu ruptura termica"] = "menuiserie aluminium rupture de pont thermique",
        ["hidroizolatie membrana pvc"] = "membrane d'étanchéité PVC",
        ["aplice ip65 up/down {k}k"] = "applique extérieure IP65 up down",
        ["aluminiu 6060 t5"] = "pergola bioclimatique aluminium",
        ["wpc 140×25 antiderapant"] = "lame de terrasse composite antidérapante",
        ["lamele aluminiu aspect lemn"] = "brise-vue aluminium effet bois",
        ["radiatoare ir 2 kw ip65"] = "chauffage infrarouge extérieur",
        ["panouri modulare irigate"] = "mur végétal modulaire",
        ["sistem glisant fara rama 8 mm"] = "rideau de verre coulissant",
        ["dale acacia 30×30 clic"] = "dalle clipsable acacia 30x30",
        ["beton armat hidroizolat"] = "piscine béton",
        ["sezlonguri aluminiu/textilena"] = "bain de soleil aluminium",
        ["proiectoare led rgb ip68"] = "projecteur LED piscine RGB",
        ["tejghea piatra"] = "cuisine d'extérieur",
        ["graminee"] = "graminées",
        ["arbori 8–10 cm girth"] = "arbre tige",
        ["balize led ip65 12 v"] = "borne LED jardin 12 V",
        ["lac cu geomembrana epdm"] = "bassin bâche EPDM",
        ["gratar inox 304"] = "barbecue inox",
        ["cuptor refractar"] = "four à pizza extérieur",
        ["lemn lamelat gl24h"] = "poutre lamellé-collé GL24h",
        ["masa tec 280 cm"] = "table de jardin teck",
        ["placi granit/calcar 60×40 pe strat drenant"] = "dalle pierre naturelle extérieure",
        ["gabioane sau beton aparent"] = "gabion",
        ["arbore multi-trunchi"] = "arbre cépée",
        ["rigole liniare inox"] = "caniveau inox",
    };

    [GeneratedRegex(@"(\d{4})\s?k\b")]
    private static partial Regex KelvinPattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
