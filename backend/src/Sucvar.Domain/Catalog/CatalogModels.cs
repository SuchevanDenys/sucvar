namespace Sucvar.Domain.Catalog;

// Shapes of app/data/{spaces,catalog,styleSpecs}.ts — only the fields the server logic reads
// (the full data stays in catalog.json, exported 1:1 from the TypeScript catalog).

public sealed record BilingualText(string Ro, string En);

public sealed record LayoutOption(string Id, string LabelRo, string LabelEn, string Prompt);

public sealed record ScenarioOption(string Id, string LabelRo, string LabelEn, string Prompt, string MaterialRo, string MaterialEn);

public sealed record SpaceOption(
    string Id,
    string LabelRo,
    string LabelEn,
    string ScenePrompt,
    IReadOnlyList<LayoutOption> Layouts,
    IReadOnlyList<ScenarioOption> Scenarios,
    double TargetLux,
    string CostBasis,
    double HardscapeShare);

public sealed record ModeConfig(string LabelRo, string LabelEn, IReadOnlyList<SpaceOption> Spaces);

public sealed record StyleMaterials(BilingualText Flooring, BilingualText Walls, BilingualText Accents);

public sealed record LightingSpec(string Ro, string En, double Kelvin);

public sealed record VisualStyle(
    string Id,
    string NameRo,
    string NameEn,
    string Prompt,
    string PromptSpec,
    double CostFactor,
    StyleMaterials Materials,
    LightingSpec LightingSpec);

public sealed record ScopeFactors(double Floor, double Walls, double Ceiling, double Baseboard, double Light, double Envelope, double Fitout);

public sealed record ScopeOption(string Id, string LabelRo, string LabelEn, string Prompt, ScopeFactors Factors);

public sealed record CatalogData(
    IReadOnlyDictionary<string, ModeConfig> SpaceModes,
    IReadOnlyList<VisualStyle> Styles,
    IReadOnlyList<ScopeOption> Scopes);
