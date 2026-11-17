using System.Globalization;
using System.Text.Json;

namespace Sucvar.Domain.Ai;

/// <summary>
/// The area the user painted for an "Edit selected area" (inpainting) request, in normalised image coordinates
/// (<c>0..1</c>, origin top-left) plus the share of the frame it covers. On <c>/api/generate</c> the server measures
/// it from the validated mask itself; the browser's <c>selectionBounds</c> is only used by the prompt preview.
/// </summary>
public sealed record SelectionRegion(double X, double Y, double Width, double Height, double Coverage)
{
    /// <summary>Human-readable position the prompt compiler uses ("center foreground", "lower floor area"…).</summary>
    public string Position => Describe(X, Y, Width, Height);

    /// <summary>Coverage in whole percent, at least 1.</summary>
    public int CoveragePercent => Math.Max(1, (int)Math.Round(Coverage * 100));

    /// <summary>
    /// Spatial phrase for a bounding box. Wide boxes touching the bottom / top read as floor / ceiling areas; the
    /// rest is a 3 × 3 grid where the lower third is the foreground of a room photo.
    /// </summary>
    public static string Describe(double x, double y, double width, double height)
    {
        double cx = x + width / 2, cy = y + height / 2;
        if (width >= 0.85 && height >= 0.85) return "most of the frame";
        if (width >= 0.55 && y + height >= 0.92 && cy >= 0.6) return "lower floor area";
        if (width >= 0.55 && y <= 0.08 && cy <= 0.35) return "upper ceiling area";
        var horizontal = cx < 0.36 ? "left" : cx > 0.64 ? "right" : "center";
        if (cy > 0.64) return $"{horizontal} foreground";
        if (cy < 0.36) return horizontal == "center" ? "upper center" : $"upper {horizontal}";
        return horizontal == "center" ? "center of the frame" : $"{horizontal} side";
    }

    /// <summary>
    /// <c>selectionBounds</c> from an (untrusted) JSON body: four finite numbers, clamped into the frame; null when
    /// missing, malformed or empty. Coverage defaults to the box area (the mask's real coverage is not known here).
    /// </summary>
    public static SelectionRegion? FromPayload(JsonElement payload)
    {
        var el = Js.Prop(payload, "selectionBounds");
        if (!Js.IsRecord(el)) return null;
        double? Read(string name) => Js.Prop(el, name) is { ValueKind: JsonValueKind.Number } n && n.TryGetDouble(out var v) && double.IsFinite(v)
            ? Math.Clamp(v, 0, 1) : null;
        if (Read("x") is not { } x || Read("y") is not { } y || Read("width") is not { } w || Read("height") is not { } h) return null;
        w = Math.Min(w, 1 - x);
        h = Math.Min(h, 1 - y);
        if (w <= 0 || h <= 0) return null;
        return new SelectionRegion(Round(x), Round(y), Round(w), Round(h), Round(w * h));
    }

    public static double Round(double v) => Math.Round(v, 4);

    public string CoverageText => CoveragePercent.ToString(CultureInfo.InvariantCulture);
}

/// <summary>The layers of a regional (masked) edit, already compiled to English and conflict-stripped.</summary>
public sealed record RegionalBrief(
    string Mode,
    string Space,
    SelectionRegion Region,
    IReadOnlyList<string> UserSpecs,
    string Materials,
    string ClientWords,
    string? StyleName,
    string StyleDetails,
    string Palette);

public static partial class ArchitecturalPromptCompiler
{
    /// <summary>
    /// Denoising for inpainting providers that expose it (SD img2img with a mask): the masked object must be fully
    /// replaced, so the strength sits near 1 — the rest of the photo is protected by the mask, not by the strength.
    /// </summary>
    public const double InpaintStrength = 0.95;

    /// <summary>
    /// Regional edit instruction (FLUX Fill / Kontext): edit only the masked area, with the client's request first,
    /// then style / palette cues, then the blending rules (same light, shadows and perspective) and the explicit
    /// "leave everything else untouched" clause. No room-wide redesign language at all.
    /// </summary>
    public static string RegionalInstruction(RegionalBrief b)
    {
        var interior = b.Mode == "interiors";
        var sentences = new List<string>
        {
            $"Edit only the selected masked area of this {b.Space} photo, in the {b.Region.Position} (about {b.Region.CoverageText}% of the frame)",
        };

        var request = string.Join("; ", new[] { string.Join("; ", b.UserSpecs.Where(s => s.Length > 0)), Clean(b.Materials), Clean(b.ClientWords) }
            .Where(s => s.Length > 0));
        if (request.Length > 0)
            sentences.Add($"Inside the selection, replace or restyle the existing element exactly as the client asks, highest priority: {request}");
        else if (!string.IsNullOrWhiteSpace(b.StyleName))
            sentences.Add($"Inside the selection, restyle the existing element in {Article(b.StyleName)} {b.StyleName} style");
        else
            sentences.Add("Inside the selection, refresh the existing element with a higher-quality, contemporary design");

        if (request.Length > 0 && !string.IsNullOrWhiteSpace(b.StyleName))
            sentences.Add($"Keep it consistent with {Article(b.StyleName)} {b.StyleName} style");
        if (FitTerms(b.StyleDetails, 18) is { Length: > 0 } details) sentences.Add($"Style cues: {details}");
        if (Clean(b.Palette) is { Length: > 0 } palette) sentences.Add($"Color palette for the new element: {palette}");

        sentences.Add("Match the original photo exactly: the same light direction, shadows, color temperature, exposure, perspective, " +
                      "vanishing lines, camera angle and lens; give the new element realistic scale, contact shadows and reflections " +
                      "so it blends seamlessly with its surroundings");
        sentences.Add(interior
            ? "Leave everything outside the selection untouched: walls, floor, ceiling, windows, doors, other furniture and decor " +
              "stay exactly as in the original photo"
            : "Leave everything outside the selection untouched: the building, terrain, planting and sky stay exactly as in the original photo");
        sentences.Add("Photorealistic, true-to-life materials and textures, sharp focus, no text, logos or watermarks");
        return string.Join(" ", sentences.Select(s => s.TrimEnd(' ', ',', ';', '.') + "."));
    }

    /// <summary>The same regional request as a CLIP prompt for SD inpainting (the client's words lead).</summary>
    public static string RegionalPrompt(RegionalBrief b)
    {
        var anchor = string.IsNullOrWhiteSpace(b.StyleName) ? "" : b.StyleName.ToLowerInvariant() + " style";
        return GenerationPrompt.BuildPrompt(
        [
            string.Join(", ", b.UserSpecs.Where(s => s.Length > 0)),
            Clean(b.Materials),
            Clean(b.ClientWords),
            anchor,
            Clean(b.Palette),
            "matching existing lighting and perspective, seamless blend, realistic contact shadows",
            "photorealistic, sharp focus",
        ], AiLimits.MaxPromptTokens);
    }
}
