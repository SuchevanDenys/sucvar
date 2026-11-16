using System.Text.Json;
using Sucvar.Domain.Ai;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Studio;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>
/// Parity with the TypeScript monolith: fixtures were produced by running the original
/// sources (tools/golden/gen.cjs) — sanitizeDimensions, calculateEngineering, buildBom,
/// the /api/generate prompt pipeline and parseEstimatePayload.
/// </summary>
public class GoldenParityTests
{
    private static JsonElement Load(string name) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name))).RootElement;

    public static IEnumerable<object[]> Cases() =>
        Enumerable.Range(0, Load("golden-cases.json").GetArrayLength()).Select(i => new object[] { i });

    [Theory]
    [MemberData(nameof(Cases))]
    public void Studio_pipeline_matches_typescript(int index)
    {
        var c = Load("golden-cases.json")[index];
        var mode = c.GetProperty("mode").GetString()!;
        var spaceType = c.GetProperty("spaceType").GetString()!;
        var styleId = c.GetProperty("styleId").GetString()!;

        var dims = DimensionSanitizer.Sanitize(c.GetProperty("raw"), mode, spaceType);
        JsonAssert.Equal(c.GetProperty("dims"), JsonAssert.ToElement(dims), "dims");

        var eng = Engineering.Calculate(dims, mode, spaceType);
        JsonAssert.Equal(c.GetProperty("eng"), JsonAssert.ToElement(eng), "eng");

        var bom = BomBuilder.Build(mode, spaceType, Sucvar.Domain.Catalog.SucvarCatalog.GetStyle(styleId).Id, dims);
        JsonAssert.Equal(c.GetProperty("bom"), JsonAssert.ToElement(bom), "bom");

        var payload = JsonSerializer.SerializeToElement(new
        {
            mode, spaceType, styleId,
            dimensions = c.GetProperty("raw"),
            ai = c.GetProperty("ai"),
        });
        var plan = GenerationPrompt.Create(payload);
        Assert.Equal(c.GetProperty("prompt").GetString(), plan.Prompt);
        Assert.Equal(c.GetProperty("negative").GetString(), plan.NegativePrompt);
    }

    private static bool IsNumericVat(JsonElement input) =>
        input.ValueKind == JsonValueKind.Object && input.TryGetProperty("vatPct", out var v) && double.IsFinite(Sucvar.Domain.Js.ToNumber(v));

    private static bool HasRegion(JsonElement input) =>
        input.ValueKind == JsonValueKind.Object && input.TryGetProperty("region", out var r) && r.ValueKind == JsonValueKind.String && r.GetString()!.Trim().Length > 0;

    [Fact]
    public void Estimate_parser_matches_typescript()
    {
        foreach (var c in Load("golden-estimates.json").EnumerateArray())
        {
            var result = EstimateParser.Parse(c.GetProperty("input"));
            var expected = c.GetProperty("output");
            Assert.Equal(expected.GetProperty("ok").GetBoolean(), result.Ok);
            if (result.Ok)
            {
                // Deliberate deviation: the monolith fell back to 19% VAT; the .NET API uses the current Romanian
                // standard rate 21% (EstimateParser.DefaultVatPct, migrations 003 / 008). Region stays "bucharest".
                var value = System.Text.Json.Nodes.JsonNode.Parse(expected.GetProperty("value").GetRawText())!;
                if (value["vatPct"]!.GetValue<double>() == 19 && !IsNumericVat(c.GetProperty("input"))) value["vatPct"] = EstimateParser.DefaultVatPct;
                if (value["region"]!.GetValue<string>() == "bucharest" && !HasRegion(c.GetProperty("input"))) value["region"] = EstimateParser.DefaultRegion;
                JsonAssert.Equal(JsonSerializer.SerializeToElement(value), JsonAssert.ToElement(result.Value!), "estimate");
            }
            else Assert.Equal(expected.GetProperty("error").GetString(), result.Error);
        }
    }
}
