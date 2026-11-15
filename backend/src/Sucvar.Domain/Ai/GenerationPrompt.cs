using System.Text.Json;
using System.Text.RegularExpressions;
using Sucvar.Domain.Catalog;

namespace Sucvar.Domain.Ai;

/// <summary>app/lib/ai/config.ts — AI_LIMITS / DEFAULT_AI_SETTINGS.</summary>
public static class AiLimits
{
    public const string DefaultNegativePrompt =
        "lowres, watermark, text, blurry, deformed walls, broken perspective, distorted furniture, extra windows, ugly, oversaturated";

    public const int InferenceStepsMin = 10, InferenceStepsMax = 60, InferenceStepsDefault = 30;
    public const double GuidanceMin = 1, GuidanceMax = 20, GuidanceDefault = 7.5;
    public const int ExtraPromptMaxLength = 400;
    public const int NegativePromptMaxLength = 600;
    public const long SeedMax = 2_147_483_647;
    public const int MaxImageLength = 6_000_000;
    public const int MaxPromptTokens = 72;
}

/// <summary>Validated generation request (everything from the browser re-checked).</summary>
public sealed record GenerationPlan(
    string Mode,
    string Prompt,
    string NegativePrompt,
    int InferenceSteps,
    double GuidanceScale,
    long? Seed,
    double PromptStrength,
    double TransformationStrength,
    DesignBrief? Brief = null);

/// <summary>
/// Port of the prompt pipeline in app/api/generate/route.ts (steps 2–4 and 6):
/// mode/space/layout resolution, AI-setting validation and the 72-token CLIP budget.
/// </summary>
public static partial class GenerationPrompt
{
    private static readonly string[] Budgets = ["economy", "standard", "luxury"];

    /// <summary>readNumber(value, min, max, fallback) from the route.</summary>
    public static double ReadNumber(JsonElement? value, double min, double max, double fallback)
    {
        if (value is null || value.Value.ValueKind == JsonValueKind.Null) return fallback;
        if (value.Value.ValueKind == JsonValueKind.String && value.Value.GetString() == "") return fallback;
        var parsed = Js.ToNumber(value);
        if (!double.IsFinite(parsed)) return fallback;
        return Math.Min(max, Math.Max(min, parsed));
    }

    public static int EstimateTokens(string text)
    {
        var words = WhitespaceRegex().Split(text).Count(w => w.Length > 0);
        var commas = text.Count(c => c == ',');
        return (int)Math.Ceiling(words * 1.25 + commas);
    }

    private static string FitSegment(string segment, int remainingTokens)
    {
        var terms = segment.Split(',').Select(t => t.Trim()).Where(t => t.Length > 0).ToList();
        while (terms.Count > 0 && EstimateTokens(string.Join(", ", terms)) + 1 > remainingTokens) terms.RemoveAt(terms.Count - 1);
        return string.Join(", ", terms);
    }

    public static string BuildPrompt(IReadOnlyList<string> segments, int maxTokens)
    {
        var kept = new List<string>();
        var used = 0;
        for (var i = 0; i < segments.Count; i++)
        {
            var segment = segments[i].Trim();
            if (segment.Length == 0) continue;
            var fitted = i == 0 ? segment : FitSegment(segment, maxTokens - used);
            if (fitted.Length > 0)
            {
                kept.Add(fitted);
                used += EstimateTokens(fitted) + 1;
            }
        }
        return string.Join(", ", kept);
    }

    public static string MergeTerms(params string[] lists)
    {
        var seen = new HashSet<string>();
        var result = new List<string>();
        foreach (var list in lists)
        foreach (var raw in list.Split(','))
        {
            var term = raw.Trim();
            if (term.Length > 0 && seen.Add(term.ToLowerInvariant())) result.Add(term);
        }
        return string.Join(", ", result);
    }

    public static string BudgetDetails(string budget, string mode)
    {
        if (mode != "interiors")
        {
            return budget switch
            {
                "economy" => "practical durable materials, simple clean finishes",
                "luxury" => "premium natural stone, solid hardwood, designer lighting",
                _ => "quality natural materials, refined finishes",
            };
        }
        return budget switch
        {
            "economy" => "practical modular furniture, clean laminate finishes, functional lighting",
            "luxury" => "bespoke millwork, premium natural stone, solid hardwood, designer statement lighting",
            _ => "engineered oak flooring, matte cabinetry, architectural track lighting",
        };
    }

    public static string Lighting(string mode, double windowsCount) =>
        mode != "interiors" ? "soft natural daylight" : windowsCount > 0 ? "bright natural daylight from windows" : "warm architectural lighting";

    public static string CleanStylePrompt(string stylePrompt, string mode)
    {
        var withoutTail = QualityTailRegex().Replace(stylePrompt, "");
        return mode == "interiors" ? withoutTail : InteriorWordRegex().Replace(withoutTail, "");
    }

    public static string StyleSpecPrompt(VisualStyle style, string mode)
    {
        if (mode == "interiors") return style.PromptSpec;
        var terms = style.PromptSpec.Split(',').Select(t => t.Trim()).ToArray();
        return string.Join(", ", terms[0], terms[^1]);
    }

    public static string MandatoryNegatives(string mode)
    {
        const string common = "lowres, blurry, watermark, text, logo, deformed walls, broken perspective, distorted proportions, cartoon";
        return mode == "interiors" ? $"{common}, empty room, unfurnished, bare walls, floating furniture, duplicated objects" : common;
    }

    /// <summary>Builds the full generation plan from the (untrusted) JSON body.</summary>
    public static GenerationPlan Create(JsonElement payload)
    {
        var modeRaw = Js.AsString(Js.Prop(payload, "mode"));
        var mode = SucvarCatalog.IsMode(modeRaw) ? modeRaw! : "interiors";
        var dimensionsEl = Js.IsRecord(Js.Prop(payload, "dimensions")) ? Js.Prop(payload, "dimensions") : null;
        var aiEl = Js.IsRecord(Js.Prop(payload, "ai")) ? Js.Prop(payload, "ai") : null;

        var space = SucvarCatalog.GetSpace(mode, Js.AsString(Js.Prop(payload, "spaceType")));
        var layout = SucvarCatalog.GetLayout(space, Js.AsString(Js.Prop(dimensionsEl, "layoutPreset")));
        var style = SucvarCatalog.GetStyle(Js.AsString(Js.Prop(payload, "styleId")));
        var scenarioPrompt = SucvarCatalog.BuildScenarioPrompt(space, SucvarCatalog.SanitizeFocusIds(space, Js.Prop(dimensionsEl, "focusIds")));
        var scopeRaw = Js.Prop(dimensionsEl, "scope");
        var scopePrompt = SucvarCatalog.GetScope(Js.AsString(scopeRaw)).Prompt;

        var budgetRaw = Js.AsString(Js.Prop(dimensionsEl, "budget"));
        var budget = budgetRaw is not null && Budgets.Contains(budgetRaw) ? budgetRaw : "standard";
        var windowsCount = ReadNumber(Js.Prop(dimensionsEl, "windowsCount"), 0, 50, 2);

        var extraPrompt = Js.AsString(Js.Prop(aiEl, "extraPrompt")) is { } extra ? Js.Slice(extra.Trim(), AiLimits.ExtraPromptMaxLength) : "";
        var userNegative = Js.AsString(Js.Prop(aiEl, "negativePrompt")) is { } neg
            ? Js.Slice(neg.Trim(), AiLimits.NegativePromptMaxLength)
            : AiLimits.DefaultNegativePrompt;
        var steps = (int)Js.Round(ReadNumber(Js.Prop(aiEl, "inferenceSteps"), AiLimits.InferenceStepsMin, AiLimits.InferenceStepsMax, AiLimits.InferenceStepsDefault));
        var guidance = ReadNumber(Js.Prop(aiEl, "guidanceScale"), AiLimits.GuidanceMin, AiLimits.GuidanceMax, AiLimits.GuidanceDefault);
        var seedEl = Js.Prop(aiEl, "seed");
        long? seed = seedEl is null || seedEl.Value.ValueKind == JsonValueKind.Null || (seedEl.Value.ValueKind == JsonValueKind.String && seedEl.Value.GetString() == "")
            ? null
            : (long)Math.Floor(ReadNumber(seedEl, 0, AiLimits.SeedMax, 0));

        var strength = ReadNumber(Js.Prop(dimensionsEl, "aiStrength"), 40, 100, 75);
        var promptStrength = Math.Min(0.9, Math.Max(0.45, Js.ToFixed(strength / 100, 2)));

        // Flexible contract (free text and/or optional pills): Smart Prompt Synthesizer.
        // Legacy requests (styleId + dimensions + ai only) keep the exact historical prompt below.
        if (DesignVision.IsSmartRequest(payload))
        {
            var brief = DesignVision.Resolve(payload, mode);
            var smartSpace = SucvarCatalog.GetSpace(mode, brief.SpaceType);
            var smartLayout = SucvarCatalog.GetLayout(smartSpace, Js.AsString(Js.Prop(dimensionsEl, "layoutPreset")));
            var smartScenario = SucvarCatalog.BuildScenarioPrompt(smartSpace, SucvarCatalog.SanitizeFocusIds(smartSpace, Js.Prop(dimensionsEl, "focusIds")));
            // Compact scene noun: the catalog's long scene prompt would use half of the 72-token budget
            var scene = mode == "interiors" ? $"furnished {smartSpace.Id} interior" : smartSpace.Id;
            var smartPrompt = SynthesizePrompt(brief, mode, scene, smartScenario, scopePrompt, smartLayout.Prompt,
                budget, windowsCount, extraPrompt);
            var smartNegative = MergeTerms(userNegative, MandatoryNegatives(mode),
                brief.PreserveStructure ? "moved walls, changed window positions, altered room geometry" : "");
            // Full redesign needs room to move away from the photo; strict preservation keeps the geometry anchored.
            var smartStrength = brief.PreserveStructure ? Math.Min(promptStrength, 0.8) : Math.Max(promptStrength, 0.8);
            return new GenerationPlan(mode, smartPrompt, smartNegative, steps, guidance, seed, smartStrength, strength, brief);
        }

        var prompt = BuildPrompt(
        [
            space.ScenePrompt,
            scenarioPrompt,
            scopePrompt,
            StyleSpecPrompt(style, mode),
            CleanStylePrompt(style.Prompt, mode),
            extraPrompt,
            layout.Prompt,
            BudgetDetails(budget, mode),
            Lighting(mode, windowsCount),
            "architectural magazine photo, straight vertical lines, photorealistic, sharp focus",
        ], AiLimits.MaxPromptTokens);
        var negative = MergeTerms(userNegative, MandatoryNegatives(mode));

        return new GenerationPlan(mode, prompt, negative, steps, guidance, seed, promptStrength, strength);
    }

    public const string StructurePreserveCue = "keep existing walls, windows and doors";
    public const string StructureRedesignCue = "completely redesigned layout";

    public static string PhotographyDirective(string mode) => mode == "interiors"
        ? "photorealistic 8k architectural interior photography, accurate perspective, straight vertical lines, sharp focus"
        : "photorealistic 8k architectural photography, accurate perspective, straight vertical lines, sharp focus";

    /// <summary>
    /// Merges the user's vision with the optional modifiers into one CLIP-sized prompt. Priority order (later
    /// segments are trimmed first): compact scene → recognised materials (English) → structure cue → the user's own
    /// words when English (or the translated Romanian descriptors) → palette → lighting → style → scenario/scope/extra → layout → budget →
    /// photography directive. Terms are de-duplicated across segments; an explicit lighting pill replaces the
    /// automatic daylight cue and palette/materials replace the budget's generic finishes, so nothing conflicts.
    /// </summary>
    public static string SynthesizePrompt(DesignBrief brief, string mode, string scenePrompt, string scenarioPrompt, string scopePrompt,
        string layoutPrompt, string budget, double windowsCount, string extraPrompt)
    {
        var style = brief.StyleId is null ? null : SucvarCatalog.GetStyle(brief.StyleId);
        var materials = string.Join(", ", brief.Materials.Select(m => m.PromptEn));
        // English text goes to the model as written; Romanian text through the descriptor glossary
        // (the recognised materials above already carry its finishes and furniture).
        var userWords = !brief.HasCustomPrompt ? ""
            : DesignVision.LooksEnglish(brief.CustomPrompt) ? brief.CustomPrompt.Replace('.', ',').Replace(';', ',')
            : DesignVision.TranslateDescriptors(brief.CustomPrompt);
        var palette = DesignVision.GetPalette(brief.Palette)?.Prompt ?? "";
        var lighting = DesignVision.GetLighting(brief.Lighting)?.Prompt ?? Lighting(mode, windowsCount);
        var budgetDetails = brief.Materials.Count > 0 || palette.Length > 0 ? "" : BudgetDetails(budget, mode);

        var preset = DesignVision.GetPreset(brief.Preset)?.PromptEn ?? "";

        var segments = new List<string>
        {
            scenePrompt,
            preset,
            materials,
            brief.PreserveStructure ? StructurePreserveCue : StructureRedesignCue,
            userWords,
            palette,
            lighting,
            style is null ? "" : StyleSpecPrompt(style, mode),
            style is null ? "" : CleanStylePrompt(style.Prompt, mode),
            scenarioPrompt,
            scopePrompt,
            extraPrompt,
            brief.PreserveStructure ? layoutPrompt : "",
            budgetDetails,
            PhotographyDirective(mode),
        };

        // Drop terms already said by an earlier segment (case-insensitive), keeping each segment's order.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var deduped = segments.Select(seg => string.Join(", ", seg.Split(',')
            .Select(t => t.Trim())
            .Where(t => t.Length > 0 && seen.Add(t)))).ToList();

        // The photography directive must survive trimming: reserve its budget before fitting the rest.
        var tail = deduped[^1];
        var head = BuildPrompt(deduped.Take(deduped.Count - 1).ToList(), AiLimits.MaxPromptTokens - EstimateTokens(tail) - 1);
        return head.Length == 0 ? tail : $"{head}, {tail}";
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@",?\s*8k photorealistic\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex QualityTailRegex();

    [GeneratedRegex(@"\binterior\s+", RegexOptions.IgnoreCase)]
    private static partial Regex InteriorWordRegex();
}
