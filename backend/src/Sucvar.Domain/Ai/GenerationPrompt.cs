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

/// <summary>What kind of prompt the active image model reads.</summary>
public enum PromptFormat
{
    /// <summary>SD 1.5-style comma-separated tags fitted to the 72-token CLIP budget (adirik/interior-design, AUTOMATIC1111).</summary>
    Clip,
    /// <summary>Natural-language editing instruction, no CLIP clipping (FLUX Kontext and other instruction-following models).</summary>
    Instruction,
}

/// <summary>Validated generation request (everything from the browser re-checked).</summary>
/// <param name="Instruction">The same brief as a natural-language editing instruction (used by <see cref="PromptFormat.Instruction"/> models).</param>
/// <param name="Format">Which prompt <see cref="Prompt"/> currently holds (see <see cref="For"/>).</param>
/// <param name="Region">Non-null for an "Edit selected area" request: the prompt targets only the masked region.</param>
public sealed record GenerationPlan(
    string Mode,
    string Prompt,
    string NegativePrompt,
    int InferenceSteps,
    double GuidanceScale,
    long? Seed,
    double PromptStrength,
    double TransformationStrength,
    DesignBrief? Brief = null,
    SmartPromptParts? Parts = null,
    string Engine = "deterministic",
    string Instruction = "",
    PromptFormat Format = PromptFormat.Clip,
    SelectionRegion? Region = null)
{
    /// <summary>
    /// The plan as the target model reads it. Instruction models get the natural-language instruction as
    /// <see cref="Prompt"/> and no negative prompt (they do not accept one; the instruction states what to keep).
    /// </summary>
    public GenerationPlan For(PromptFormat format) => format == PromptFormat.Instruction && Instruction.Length > 0
        ? this with { Prompt = Instruction, NegativePrompt = "", Format = PromptFormat.Instruction }
        : this;
}

/// <summary>
/// The pieces of a compiled smart prompt that an optional LLM refinement must keep: the scene, the user's locked
/// element specs (always first), the structure cue and the photography tail, plus the slots the user owns.
/// </summary>
public sealed record SmartPromptParts(
    string Scene,
    IReadOnlyList<string> LockedSpecs,
    string StructureCue,
    string Tail,
    IReadOnlySet<string> UserSlots);

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
    /// <param name="region">
    /// The selection measured from a validated mask (<c>/api/generate</c>). When null, a <c>selectionBounds</c> object in
    /// the body (prompt preview, no mask) still switches the plan to a regional edit.
    /// </param>
    public static GenerationPlan Create(JsonElement payload, SelectionRegion? region = null)
    {
        var plan = CreateFullRoom(payload);
        return (region ?? SelectionRegion.FromPayload(payload)) is { } selection ? Regional(plan, payload, selection) : plan;
    }

    /// <summary>
    /// Regional (inpainting) plan: the same brief, recompiled as an edit of the masked area only. Room-wide layers
    /// (scene, structure cue, layout, budget, room lighting, scale) are dropped — the photo outside the mask is kept.
    /// </summary>
    private static GenerationPlan Regional(GenerationPlan plan, JsonElement payload, SelectionRegion region)
    {
        var mode = plan.Mode;
        DesignBrief? brief = plan.Brief;
        var styleId = brief?.StyleId ?? (brief is null ? Js.AsString(Js.Prop(payload, "styleId")) ?? Js.AsString(Js.Prop(payload, "style")) : null);
        var style = styleId is null ? null : SucvarCatalog.GetStyle(styleId);
        var spaceId = brief?.SpaceType ?? SucvarCatalog.GetSpace(mode, Js.AsString(Js.Prop(payload, "spaceType"))).Id;

        (IReadOnlyList<string> Specs, HashSet<string> UserSlots, string UserWords, string Materials, IReadOnlyList<UserSpec> Compiled)? layers =
            brief is null ? null : UserLayers(brief);
        string Strip(string seg) => layers is null ? seg : ArchitecturalPromptCompiler.StripConflicts(seg, layers.Value.UserSlots);
        var palette = brief is null ? "" : DesignVision.GetPalette(brief.Palette)?.Prompt ?? "";
        var english = brief is { HasCustomPrompt: true } && DesignVision.LooksEnglish(brief.CustomPrompt);

        var regional = new RegionalBrief(
            Mode: mode,
            Space: spaceId,
            Region: region,
            UserSpecs: layers?.Specs ?? [],
            Materials: layers?.Materials ?? "",
            ClientWords: brief is not { HasCustomPrompt: true } ? "" : english ? brief.CustomPrompt : layers!.Value.UserWords,
            StyleName: style?.NameEn,
            StyleDetails: style is null ? "" : Strip(StyleSpecPrompt(style, mode)),
            Palette: Strip(palette));

        // The user's own negative (if any) leads; geometry cues stay (nothing outside the mask may move)
        var userNegative = Js.IsRecord(Js.Prop(payload, "ai")) && Js.AsString(Js.Prop(Js.Prop(payload, "ai"), "negativePrompt")) is { } neg
            ? Js.Slice(neg.Trim(), AiLimits.NegativePromptMaxLength) : null;
        return plan with
        {
            Prompt = ArchitecturalPromptCompiler.RegionalPrompt(regional),
            Instruction = ArchitecturalPromptCompiler.RegionalInstruction(regional),
            NegativePrompt = ArchitecturalPromptCompiler.NegativePrompt(mode, true, userNegative),
            PromptStrength = ArchitecturalPromptCompiler.InpaintStrength,
            TransformationStrength = Math.Round(ArchitecturalPromptCompiler.InpaintStrength * 100),
            Parts = null, // no LLM refinement: it writes room-wide tags
            Region = region,
        };
    }

    /// <summary>What the user owns in a smart brief: element specs, the slots they cover, their other words, extra materials.</summary>
    private static (IReadOnlyList<string> Specs, HashSet<string> UserSlots, string UserWords, string Materials, IReadOnlyList<UserSpec> Compiled) UserLayers(DesignBrief brief)
    {
        var english = brief.HasCustomPrompt && DesignVision.LooksEnglish(brief.CustomPrompt);
        var specs = brief.HasCustomPrompt && !english ? ArchitecturalPromptCompiler.CompileUserSpecs(brief.CustomPrompt) : [];
        var userSlots = new HashSet<string>(ArchitecturalPromptCompiler.ExplicitSlots(brief.CustomPrompt), StringComparer.Ordinal);
        foreach (var s in specs) userSlots.Add(s.Slot);
        if (brief.Lighting is not null) userSlots.Add("lighting"); // an explicit lighting pill is a user choice too

        var userWords = !brief.HasCustomPrompt ? ""
            : english ? brief.CustomPrompt.Replace('.', ',').Replace(';', ',')
            : DesignVision.TranslateDescriptors(ArchitecturalPromptCompiler.FreeClauses(brief.CustomPrompt));

        // Lexicon materials (LED strip, plants, matte black…) unless a spec already describes the same element
        var specSlots = specs.Select(s => s.Slot).ToHashSet();
        var materials = string.Join(", ", brief.Materials
            .Where(m => SpecSlotOf(m) is not { } slot || !specSlots.Contains(slot))
            .Select(m => m.PromptEn));
        return (specs.Select(s => s.PromptEn).ToList(), userSlots, userWords, materials, specs);
    }

    private static GenerationPlan CreateFullRoom(JsonElement payload)
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

        // Flexible contract (free text and/or optional pills): Architectural Prompt Compiler.
        // Legacy requests (styleId + dimensions + ai only) keep the exact historical prompt below.
        if (DesignVision.IsSmartRequest(payload))
        {
            var brief = DesignVision.Resolve(payload, mode);
            var smartSpace = SucvarCatalog.GetSpace(mode, brief.SpaceType);
            var smartLayout = SucvarCatalog.GetLayout(smartSpace, Js.AsString(Js.Prop(dimensionsEl, "layoutPreset")));
            var smartScenario = SucvarCatalog.BuildScenarioPrompt(smartSpace, SucvarCatalog.SanitizeFocusIds(smartSpace, Js.Prop(dimensionsEl, "focusIds")));
            // Compact scene noun: the catalog's long scene prompt would use half of the 72-token budget
            var scene = mode == "interiors" ? $"furnished {smartSpace.Id} interior" : smartSpace.Id;
            var (smartPrompt, instruction, parts) = Compile(brief, mode, scene, smartScenario, scopePrompt, smartLayout.Prompt,
                budget, windowsCount, extraPrompt);
            var smartNegative = ArchitecturalPromptCompiler.NegativePrompt(mode, brief.PreserveStructure,
                Js.AsString(Js.Prop(aiEl, "negativePrompt")) is { } rawNeg ? userNegative : null);

            // Calibrated strength: preserved structure stays in the 0.62–0.80 band (finishes change, geometry holds),
            // a full redesign needs ≥ 0.80 to move away from the photo. Default = the 0.72 sweet spot.
            var requested = ReadNumber(Js.Prop(dimensionsEl, "aiStrength"), 40, 100, ArchitecturalPromptCompiler.RecommendedStrength * 100) / 100;
            var smartStrength = ArchitecturalPromptCompiler.CalibrateStrength(requested, brief.PreserveStructure);
            var smartSteps = (int)Js.Round(ReadNumber(Js.Prop(aiEl, "inferenceSteps"), AiLimits.InferenceStepsMin, AiLimits.InferenceStepsMax,
                ArchitecturalPromptCompiler.SmartInferenceStepsDefault));
            var smartGuidance = ReadNumber(Js.Prop(aiEl, "guidanceScale"), AiLimits.GuidanceMin, AiLimits.GuidanceMax,
                ArchitecturalPromptCompiler.SmartGuidanceDefault);
            return new GenerationPlan(mode, smartPrompt, smartNegative, smartSteps, smartGuidance, seed, smartStrength,
                Math.Round(smartStrength * 100), brief, parts, Instruction: instruction);
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
        var legacyInstruction = ArchitecturalPromptCompiler.LegacyInstruction(mode, space.Id,
            MergeTerms(space.ScenePrompt, scenarioPrompt, scopePrompt, StyleSpecPrompt(style, mode), CleanStylePrompt(style.Prompt, mode),
                extraPrompt, layout.Prompt, BudgetDetails(budget, mode), Lighting(mode, windowsCount)));

        return new GenerationPlan(mode, prompt, negative, steps, guidance, seed, promptStrength, strength, Instruction: legacyInstruction);
    }

    public const string StructurePreserveCue = "keep existing walls, windows and doors";
    public const string StructureRedesignCue = "completely redesigned layout";

    public static string PhotographyDirective(string mode) => ArchitecturalPromptCompiler.PhotographyDirective(mode);

    /// <summary>Compatibility wrapper: the compiled prompt only.</summary>
    public static string SynthesizePrompt(DesignBrief brief, string mode, string scenePrompt, string scenarioPrompt, string scopePrompt,
        string layoutPrompt, string budget, double windowsCount, string extraPrompt) =>
        Compile(brief, mode, scenePrompt, scenarioPrompt, scopePrompt, layoutPrompt, budget, windowsCount, extraPrompt).Prompt;

    /// <summary>The space noun of a scene ("furnished kitchen interior" → "kitchen") for the natural-language instruction.</summary>
    private static string SpaceNoun(string scenePrompt, string mode) =>
        mode == "interiors" && scenePrompt.StartsWith("furnished ", StringComparison.Ordinal) && scenePrompt.EndsWith(" interior", StringComparison.Ordinal)
            ? scenePrompt["furnished ".Length..^" interior".Length]
            : scenePrompt;

    /// <summary>
    /// Compiles the user's vision and the optional modifiers into one CLIP-sized prompt. Priority order (later
    /// segments are trimmed first):
    /// <list type="number">
    /// <item>compact scene noun;</item>
    /// <item>the user's explicit element specs, translated to precise English (highest weight = front);</item>
    /// <item>the user's other words (English verbatim, Romanian through the descriptor glossary);</item>
    /// <item>structure cue → preset → recognised materials not already covered → palette → lighting;</item>
    /// <item>scale cues from the real room size;</item>
    /// <item>style → scenario / scope / extra → layout → budget;</item>
    /// <item>photography directive (always kept).</item>
    /// </list>
    /// Every non-user layer is passed through <see cref="ArchitecturalPromptCompiler.StripConflicts"/>: a style's
    /// default floor / walls / sofa / lighting never contradicts what the user asked for. Terms are de-duplicated.
    /// </summary>
    /// <remarks>
    /// The same layers (same conflict stripping) are also composed into a natural-language instruction, without the
    /// CLIP budget, for <see cref="PromptFormat.Instruction"/> models such as FLUX Kontext.
    /// </remarks>
    public static (string Prompt, string Instruction, SmartPromptParts Parts) Compile(DesignBrief brief, string mode, string scenePrompt, string scenarioPrompt,
        string scopePrompt, string layoutPrompt, string budget, double windowsCount, string extraPrompt)
    {
        var style = brief.StyleId is null ? null : SucvarCatalog.GetStyle(brief.StyleId);
        var english = brief.HasCustomPrompt && DesignVision.LooksEnglish(brief.CustomPrompt);

        // 1. What the user owns: element specs + the slots they cover (English text: slots only, words kept verbatim)
        var (_, userSlots, userWords, materials, specs) = UserLayers(brief);
        string Strip(string seg) => ArchitecturalPromptCompiler.StripConflicts(seg, userSlots);

        var palette = DesignVision.GetPalette(brief.Palette)?.Prompt ?? "";
        var lighting = DesignVision.GetLighting(brief.Lighting)?.Prompt
            ?? (userSlots.Contains("lighting") ? "" : Lighting(mode, windowsCount));
        var budgetDetails = brief.Materials.Count > 0 || specs.Count > 0 || palette.Length > 0 ? "" : BudgetDetails(budget, mode);
        var preset = DesignVision.GetPreset(brief.Preset)?.PromptEn ?? "";
        var structureCue = brief.PreserveStructure ? StructurePreserveCue : StructureRedesignCue;

        var lockedSpecs = specs.Select(s => s.PromptEn).ToList();
        var segments = new List<string>
        {
            scenePrompt,
            string.Join(", ", lockedSpecs),
            materials,                                   // user-named items without an element spec (LED strip, plants…)
            userWords,
            structureCue,
            palette.Length > 0 ? Strip(palette) : "",
            brief.Lighting is not null ? lighting : "",
            ArchitecturalPromptCompiler.ScaleHint(brief.Scale, mode),
            style is null ? "" : StyleSpecPrompt(style, mode).Split(',')[0].Trim(), // style anchor ("industrial loft")
            Strip(preset),
            brief.Lighting is null ? Strip(lighting) : "",
            style is null ? "" : Strip(StyleSpecPrompt(style, mode)),
            style is null ? "" : Strip(CleanStylePrompt(style.Prompt, mode)),
            Strip(scenarioPrompt),
            scopePrompt,
            extraPrompt,
            brief.PreserveStructure ? Strip(layoutPrompt) : "",
            Strip(budgetDetails),
            PhotographyDirective(mode),
        };

        var prompt = Assemble(segments);

        var scale = brief.Scale;
        var instruction = ArchitecturalPromptCompiler.Instruction(new InstructionBrief(
            Mode: mode,
            Space: SpaceNoun(scenePrompt, mode),
            PreserveStructure: brief.PreserveStructure,
            UserSpecs: lockedSpecs,
            Materials: materials,
            ClientWords: !brief.HasCustomPrompt ? "" : english ? brief.CustomPrompt : userWords,
            StyleName: style?.NameEn,
            StyleDetails: style is null ? Strip(preset) : MergeTerms(Strip(preset), Strip(StyleSpecPrompt(style, mode)), Strip(CleanStylePrompt(style.Prompt, mode))),
            Palette: Strip(palette),
            Lighting: brief.Lighting is not null ? lighting : Strip(lighting),
            AreaSqm: scale is { AreaKnown: true } ? scale.AreaSqm : null,
            CeilingHeight: scale?.Height,
            ScaleHint: ArchitecturalPromptCompiler.ScaleHint(scale, mode),
            Details: MergeTerms(Strip(scenarioPrompt), scopePrompt, extraPrompt, brief.PreserveStructure ? Strip(layoutPrompt) : "", Strip(budgetDetails))));

        return (prompt, instruction, new SmartPromptParts(scenePrompt, lockedSpecs, structureCue, PhotographyDirective(mode), userSlots));
    }

    /// <summary>
    /// Folds an optional LLM refinement into the plan without letting it override the user: the locked specs stay
    /// first, conflicting terms are stripped, prompt-weight syntax is removed and the CLIP budget is re-applied.
    /// Returns the plan unchanged when the refinement is empty or unusable.
    /// </summary>
    public static GenerationPlan ApplyEnhancement(GenerationPlan plan, string? enhanced)
    {
        if (plan.Parts is not { } parts || string.IsNullOrWhiteSpace(enhanced)) return plan;
        var clean = DesignVision.CleanCustomPrompt(enhanced.Replace('\n', ',').Replace('.', ',').Replace(';', ','))
            .Replace("\"", "").Replace("*", "");
        // Only the descriptive middle is taken from the model: anything restating a user-owned element is dropped
        var body = ArchitecturalPromptCompiler.StripConflicts(clean, parts.UserSlots.Except(["lighting"]).ToHashSet());
        if (GenerationPrompt.EstimateTokens(body) < 4) return plan;
        var prompt = Assemble([
            parts.Scene,
            string.Join(", ", parts.LockedSpecs),
            parts.StructureCue,
            body,
            parts.Tail,
        ]);
        return plan with { Prompt = prompt, Engine = "llm" };
    }

    /// <summary>
    /// De-duplicates terms across segments (first wins) and fits them to the CLIP budget. The structure cue and
    /// the photography tail (last segment) are reserved: they are never trimmed, whatever the user writes.
    /// </summary>
    private static string Assemble(IReadOnlyList<string> segments)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var deduped = segments.Select(seg => string.Join(", ", seg.Split(',')
            .Select(t => t.Trim())
            .Where(t => t.Length > 0 && seen.Add(t)))).ToList();
        bool Reserved(int i) => i == deduped.Count - 1 || deduped[i] is StructurePreserveCue or StructureRedesignCue;
        int Cost(string seg) => seg.Length == 0 ? 0 : EstimateTokens(seg) + 1;

        var reserved = deduped.Where((seg, i) => Reserved(i)).Sum(Cost);
        var kept = new List<string>();
        var used = 0;
        for (var i = 0; i < deduped.Count; i++)
        {
            var seg = deduped[i];
            if (seg.Length == 0) continue;
            if (Reserved(i)) { kept.Add(seg); used += Cost(seg); reserved -= Cost(seg); continue; }
            var fitted = i == 0 ? seg : FitSegment(seg, AiLimits.MaxPromptTokens - used - reserved);
            if (fitted.Length == 0) continue;
            kept.Add(fitted);
            used += Cost(fitted);
        }
        return string.Join(", ", kept);
    }

    /// <summary>The user-spec slot a lexicon material describes (null = no element of its own, e.g. plants, LED strip).</summary>
    private static string? SpecSlotOf(VisionMaterial m) => m.Id switch
    {
        _ when m.Slot is "floor" or "walls" => m.Slot,
        _ when m.Id.EndsWith("_sofa", StringComparison.Ordinal) => "sofa",
        "quartz_top" => "countertop",
        "linen_curtains" => "curtains",
        "wool_rug" => "rug",
        "dining_table" => "table",
        _ => null,
    };

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@",?\s*8k photorealistic\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex QualityTailRegex();

    [GeneratedRegex(@"\binterior\s+", RegexOptions.IgnoreCase)]
    private static partial Regex InteriorWordRegex();
}
