using System.Text.Json;
using Sucvar.Domain.Studio;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>
/// SpatialErgonomicsAnalyzer ↔ frontend/app/lib/studio/ergonomics.ts parity: every number, recommendation and prompt
/// constraint must match the TypeScript output (fixture from tools/golden/ergonomics.mts, incl. invalid / missing
/// dimensions, unknown spaces and goals, and midpoint-rounding values).
/// </summary>
public class ErgonomicsParityTests
{
    private static readonly JsonElement Cases =
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "golden-ergonomics.json"))).RootElement;

    private static double? Num(JsonElement c, string name) =>
        c.GetProperty(name) is { ValueKind: JsonValueKind.Number } v ? v.GetDouble() : null;

    [Fact]
    public void Analyzer_matches_typescript_for_every_case()
    {
        Assert.True(Cases.GetArrayLength() > 500);
        foreach (var c in Cases.EnumerateArray())
        {
            var space = c.GetProperty("space").GetString();
            var goal = c.GetProperty("goal").GetString();
            var report = SpatialErgonomicsAnalyzer.Analyze(space, Num(c, "length"), Num(c, "width"), Num(c, "height"), goal);
            JsonAssert.Equal(c.GetProperty("report"), JsonAssert.ToElement(report),
                $"[{space}|{goal}|{Num(c, "length")}×{Num(c, "width")}×{Num(c, "height")}]");
        }
    }
}
