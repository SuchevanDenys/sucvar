using System.Globalization;
using System.Text.Json;

namespace Sucvar.Domain.Ai;

/// <summary>
/// One structural / MEP element a vision model found on the source photo. Box in normalised image coordinates
/// (<c>0..1</c>, origin top-left, EXIF-upright frame); <see cref="Confidence"/> in <c>0..1</c>.
/// </summary>
/// <param name="Kind">One of <see cref="RoomFixtures.Kinds"/>: outlet, switch, radiator, door, window, corner.</param>
/// <param name="Shielded">True when the API restored the original pixels over it after generation (pixel shield).</param>
public sealed record DetectedFixture(string Kind, double X, double Y, double Width, double Height, double Confidence, bool Shielded = false)
{
    public double CenterX => X + Width / 2;
    public double CenterY => Y + Height / 2;
    public double Area => Width * Height;
}

/// <summary>
/// Stage 1 of the precision pipeline: the vision-model contract (prompt + tolerant JSON parsing), the coordinate-grounded
/// anchor sentence for the instruction model and the selection of the small wall fixtures the pixel shield protects.
/// Pure and deterministic; every failure degrades to "no fixtures" (the render never depends on it).
/// </summary>
public static class RoomFixtures
{
    public const string Outlet = "outlet", Switch = "switch", Radiator = "radiator", Door = "door", Window = "window", Corner = "corner";
    public static readonly IReadOnlyList<string> Kinds = [Outlet, Switch, Radiator, Door, Window, Corner];

    /// <summary>Below this a detection is noise and is dropped entirely.</summary>
    public const double MinConfidence = 0.3;
    /// <summary>Only detections at least this sure are written into the prompt as hard anchors.</summary>
    public const double AnchorConfidence = 0.5;
    /// <summary>Only outlets / switches at least this sure get their original pixels restored.</summary>
    public const double ShieldConfidence = 0.6;
    /// <summary>A shielded box is a small wall fixture: ≤ 15 % of either side and ≤ 1.5 % of the frame.</summary>
    public const double ShieldMaxSide = 0.15, ShieldMaxArea = 0.015;
    /// <summary>Padding around a shielded box (fraction of its own size) so the faceplate edge and its shadow are kept.</summary>
    public const double ShieldPadding = 0.2;
    public const int MaxFixtures = 32, MaxAnchorsPerKind = 6;

    /// <summary>The strict JSON-only detection prompt sent to the vision model.</summary>
    public const string DetectionPrompt =
        "You are an architectural survey tool. Look at this room photograph and locate every clearly visible: " +
        "outlet (electrical wall socket), switch (light switch), radiator (heating radiator or exposed heating pipes), " +
        "door (door or doorway), window (window or glazed balcony door), corner (structural wall-ceiling or wall-floor corner line junction). " +
        "Answer with JSON only, no prose, no markdown, exactly this shape: " +
        "{\"fixtures\":[{\"kind\":\"outlet\",\"x\":0.12,\"y\":0.78,\"width\":0.03,\"height\":0.04,\"confidence\":0.9}]} " +
        "where x and y are the top-left corner and width and height the size of the bounding box, all normalised to 0.0-1.0 of the image " +
        "width and height, and confidence is 0.0-1.0. Use only these kinds: outlet, switch, radiator, door, window, corner. " +
        "If nothing is visible answer {\"fixtures\":[]}.";

    private static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["outlet"] = Outlet, ["socket"] = Outlet, ["power outlet"] = Outlet, ["electrical outlet"] = Outlet, ["wall socket"] = Outlet,
        ["power socket"] = Outlet, ["priză"] = Outlet, ["priza"] = Outlet,
        ["switch"] = Switch, ["light switch"] = Switch, ["wall switch"] = Switch, ["întrerupător"] = Switch, ["intrerupator"] = Switch,
        ["radiator"] = Radiator, ["heater"] = Radiator, ["heating pipe"] = Radiator, ["heating pipes"] = Radiator, ["pipe"] = Radiator,
        ["pipes"] = Radiator, ["calorifer"] = Radiator,
        ["door"] = Door, ["doorway"] = Door, ["ușă"] = Door, ["usa"] = Door,
        ["window"] = Window, ["balcony door"] = Window, ["fereastră"] = Window, ["fereastra"] = Window,
        ["corner"] = Corner, ["wall corner"] = Corner, ["ceiling corner"] = Corner, ["floor corner"] = Corner, ["colț"] = Corner,
    };

    /// <summary>Canonical kind of a model label, or null for anything outside the six kinds.</summary>
    public static string? NormalizeKind(string? label) =>
        label is null ? null : Aliases.GetValueOrDefault(label.Trim().Replace('_', ' ').Replace('-', ' '));

    /// <summary>
    /// Parses the vision model's answer. Tolerates markdown fences, prose around the JSON, a bare array, alternative
    /// keys (<c>type</c>/<c>label</c>, <c>bbox</c> = [x, y, w, h], <c>bbox_2d</c> = [x1, y1, x2, y2]) and pixel
    /// coordinates (converted with <paramref name="imageWidth"/> × <paramref name="imageHeight"/>). Invalid entries are
    /// skipped; the result is de-duplicated, sorted by confidence and capped at <see cref="MaxFixtures"/>. Never throws.
    /// </summary>
    public static IReadOnlyList<DetectedFixture> Parse(string? text, int? imageWidth = null, int? imageHeight = null)
    {
        if (string.IsNullOrWhiteSpace(text)) return [];
        var items = ExtractItems(text);
        if (items is null) return [];

        var result = new List<DetectedFixture>();
        foreach (var item in items)
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var kind = NormalizeKind(Str(item, "kind") ?? Str(item, "type") ?? Str(item, "label") ?? Str(item, "class") ?? Str(item, "name"));
            if (kind is null) continue;
            if (ReadBox(item) is not { } box) continue;
            if (Normalize(box, imageWidth, imageHeight) is not { } n) continue;
            var confidence = Num(item, "confidence") ?? Num(item, "score") ?? 0.5;
            if (confidence > 1 && confidence <= 100) confidence /= 100;
            if (!double.IsFinite(confidence) || confidence < MinConfidence) continue;
            result.Add(new DetectedFixture(kind, R(n.X), R(n.Y), R(n.W), R(n.H), R(Math.Clamp(confidence, 0, 1))));
        }

        // Duplicates (same kind, heavily overlapping) keep the most confident box
        var kept = new List<DetectedFixture>();
        foreach (var f in result.OrderByDescending(f => f.Confidence))
        {
            if (kept.Any(k => k.Kind == f.Kind && IoU(k, f) > 0.6)) continue;
            kept.Add(f);
            if (kept.Count == MaxFixtures) break;
        }
        return kept;
    }

    private static List<JsonElement>? ExtractItems(string text)
    {
        var t = text.Trim();
        if (t.StartsWith("```", StringComparison.Ordinal))
        {
            var firstLine = t.IndexOf('\n');
            t = firstLine < 0 ? "" : t[(firstLine + 1)..];
            var fence = t.LastIndexOf("```", StringComparison.Ordinal);
            if (fence >= 0) t = t[..fence];
        }
        foreach (var (open, close) in new[] { ('{', '}'), ('[', ']') })
        {
            var start = t.IndexOf(open);
            var end = t.LastIndexOf(close);
            if (start < 0 || end <= start) continue;
            try
            {
                using var doc = JsonDocument.Parse(t[start..(end + 1)]);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Array) return root.EnumerateArray().Select(e => e.Clone()).ToList();
                if (root.ValueKind == JsonValueKind.Object)
                {
                    foreach (var key in new[] { "fixtures", "detections", "objects", "items", "results" })
                        if (root.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
                            return arr.EnumerateArray().Select(e => e.Clone()).ToList();
                    if (NormalizeKind(Str(root, "kind") ?? Str(root, "type") ?? Str(root, "label")) is not null) return [root.Clone()];
                    return [];
                }
            }
            catch (JsonException) { /* try the next shape */ }
        }
        return null;
    }

    private readonly record struct Box(double X, double Y, double W, double H);

    private static Box? ReadBox(JsonElement item)
    {
        if (Num(item, "x") is { } x && Num(item, "y") is { } y && (Num(item, "width") ?? Num(item, "w")) is { } w && (Num(item, "height") ?? Num(item, "h")) is { } h)
            return new Box(x, y, w, h);
        if ((Arr(item, "bbox_2d") ?? Arr(item, "box_2d") ?? Arr(item, "xyxy")) is { } xyxy)
            return new Box(xyxy[0], xyxy[1], xyxy[2] - xyxy[0], xyxy[3] - xyxy[1]);
        if ((Arr(item, "bbox") ?? Arr(item, "box")) is { } xywh) return new Box(xywh[0], xywh[1], xywh[2], xywh[3]);
        return null;
    }

    /// <summary>Normalised (0..1) box clipped to the frame; pixel boxes need the image size. Null = unusable.</summary>
    private static Box? Normalize(Box b, int? imageWidth, int? imageHeight)
    {
        if (!double.IsFinite(b.X) || !double.IsFinite(b.Y) || !double.IsFinite(b.W) || !double.IsFinite(b.H) || b.W <= 0 || b.H <= 0) return null;
        // Normalised boxes may spill a little past the frame (clipped below); anything well beyond 1 is pixels
        if (Math.Max(Math.Max(b.X, b.Y), Math.Max(b.X + b.W, b.Y + b.H)) > 1.5)
        {
            if (imageWidth is not > 0 || imageHeight is not > 0) return null;
            b = new Box(b.X / imageWidth.Value, b.Y / imageHeight.Value, b.W / imageWidth.Value, b.H / imageHeight.Value);
        }
        var x0 = Math.Clamp(b.X, 0, 1);
        var y0 = Math.Clamp(b.Y, 0, 1);
        var x1 = Math.Clamp(b.X + b.W, 0, 1);
        var y1 = Math.Clamp(b.Y + b.H, 0, 1);
        // Too small to be real (< 0.3 % of a side) or the whole frame (a hallucinated "everything" box)
        if (x1 - x0 < 0.003 || y1 - y0 < 0.003 || (x1 - x0) * (y1 - y0) > 0.95) return null;
        return new Box(x0, y0, x1 - x0, y1 - y0);
    }

    private static double IoU(DetectedFixture a, DetectedFixture b)
    {
        var ix = Math.Max(0, Math.Min(a.X + a.Width, b.X + b.Width) - Math.Max(a.X, b.X));
        var iy = Math.Max(0, Math.Min(a.Y + a.Height, b.Y + b.Height) - Math.Max(a.Y, b.Y));
        var inter = ix * iy;
        var union = a.Area + b.Area - inter;
        return union <= 0 ? 0 : inter / union;
    }

    private static string? Str(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? Num(JsonElement o, string key)
    {
        if (!o.TryGetProperty(key, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
        return v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    private static double[]? Arr(JsonElement o, string key)
    {
        if (!o.TryGetProperty(key, out var v) || v.ValueKind != JsonValueKind.Array || v.GetArrayLength() != 4) return null;
        var values = v.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.Number ? e.GetDouble() : double.NaN).ToArray();
        return values.All(double.IsFinite) ? values : null;
    }

    private static double R(double v) => Math.Round(v, 4);

    // ── Coordinate-grounded prompt ───────────────────────────────────────────────

    private static string Pct(double v) => $"{Math.Round(v * 100, MidpointRounding.AwayFromZero).ToString(CultureInfo.InvariantCulture)}%";
    private static string At(DetectedFixture f) => $"(x={Pct(f.CenterX)}, y={Pct(f.CenterY)})";

    private static string Noun(string kind) => kind switch
    {
        Outlet => "electrical outlet",
        Switch => "light switch",
        Radiator => "radiator",
        Door => "door",
        Window => "window",
        _ => "structural corner",
    };

    private static string Join(IReadOnlyList<string> parts) => parts.Count switch
    {
        0 => "",
        1 => parts[0],
        _ => $"{string.Join(", ", parts.Take(parts.Count - 1))} and {parts[^1]}",
    };

    private static IEnumerable<DetectedFixture> Anchors(IReadOnlyList<DetectedFixture> fixtures, params string[] kinds) =>
        fixtures.Where(f => kinds.Contains(f.Kind) && f.Confidence >= AnchorConfidence)
            .GroupBy(f => f.Kind)
            .SelectMany(g => g.OrderByDescending(f => f.Confidence).Take(MaxAnchorsPerKind))
            .OrderBy(f => Array.IndexOf(kinds, f.Kind)).ThenBy(f => f.CenterX);

    /// <summary>
    /// The coordinate-grounded anchor sentences (positions are box centres, % of the frame width / height from the top-left):
    /// MEP fixtures kept visible and never covered, openings kept in place, structural corners kept aligned. Empty when no
    /// detection is confident enough.
    /// </summary>
    public static IReadOnlyList<string> AnchorSentences(IReadOnlyList<DetectedFixture> fixtures)
    {
        var sentences = new List<string>();
        var mep = Anchors(fixtures, Outlet, Switch, Radiator).Select(f => $"the {Noun(f.Kind)} at {At(f)}").ToList();
        if (mep.Count > 0)
            sentences.Add($"Detected MEP fixtures, positions as % of image width and height from the top-left: keep {Join(mep)} 100% visible, " +
                          "unchanged and unobstructed; never place wardrobes, sofas, beds, cabinets, wall panels, curtains or any furniture over these coordinates");
        var openings = Anchors(fixtures, Door, Window)
            .Select(f => $"the {Noun(f.Kind)} at {At(f)} spanning x={Pct(f.X)}–{Pct(f.X + f.Width)}").ToList();
        if (openings.Count > 0)
            sentences.Add($"Detected openings: keep {Join(openings)} in exactly these positions and sizes, fully uncovered");
        var corners = Anchors(fixtures, Corner).Select(At).ToList();
        if (corners.Count > 0)
            sentences.Add($"Keep the structural wall-ceiling and wall-floor corners at {Join(corners)} exactly aligned; do not move, round or hide them");
        return sentences;
    }

    /// <summary>The anchors as one paragraph (each sentence closed with a period), or "" when there are none.</summary>
    public static string AnchorClause(IReadOnlyList<DetectedFixture> fixtures) =>
        string.Join(" ", AnchorSentences(fixtures).Select(s => s + "."));

    /// <summary>
    /// Inserts the anchor clause into an instruction just before its closing hard lock (<c>CRITICAL ARCHITECTURAL
    /// CONSTRAINTS</c>) — instruction models weigh the closing most, so the lock stays last — or appends it.
    /// </summary>
    public static string InjectAnchors(string instruction, IReadOnlyList<DetectedFixture> fixtures)
    {
        var clause = AnchorClause(fixtures);
        if (clause.Length == 0 || instruction.Length == 0) return instruction;
        var lockAt = instruction.LastIndexOf("CRITICAL ARCHITECTURAL CONSTRAINTS", StringComparison.Ordinal);
        return lockAt < 0 ? $"{instruction.TrimEnd()} {clause}" : $"{instruction[..lockAt]}{clause} {instruction[lockAt..]}";
    }

    // ── Pixel shield ─────────────────────────────────────────────────────────────

    /// <summary>A small, confident outlet / switch: its original pixels are restored over the generated image.</summary>
    public static bool IsShieldTarget(DetectedFixture f) =>
        f.Kind is Outlet or Switch && f.Confidence >= ShieldConfidence &&
        f.Width <= ShieldMaxSide && f.Height <= ShieldMaxSide && f.Area <= ShieldMaxArea;

    /// <summary>The padded, frame-clipped rectangle (normalised) the shield restores for <paramref name="f"/>.</summary>
    public static (double X, double Y, double Width, double Height) ShieldRect(DetectedFixture f)
    {
        var px = f.Width * ShieldPadding;
        var py = f.Height * ShieldPadding;
        var x0 = Math.Max(0, f.X - px);
        var y0 = Math.Max(0, f.Y - py);
        var x1 = Math.Min(1, f.X + f.Width + px);
        var y1 = Math.Min(1, f.Y + f.Height + py);
        return (x0, y0, x1 - x0, y1 - y0);
    }
}
