using System.Text.Json;

namespace Sucvar.Tests.Support;

public static class JsonAssert
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static JsonElement ToElement(object value) => JsonSerializer.SerializeToElement(value, Web);

    /// <summary>Deep structural equality; numbers compared as doubles (exact).</summary>
    public static void Equal(JsonElement expected, JsonElement actual, string path = "$")
    {
        if (expected.ValueKind == JsonValueKind.Number && actual.ValueKind == JsonValueKind.Number)
        {
            Assert.True(expected.GetDouble() == actual.GetDouble(), $"{path}: expected {expected.GetRawText()} got {actual.GetRawText()}");
            return;
        }
        Assert.True(expected.ValueKind == actual.ValueKind, $"{path}: kind {expected.ValueKind} vs {actual.ValueKind} ({actual.GetRawText()})");
        switch (expected.ValueKind)
        {
            case JsonValueKind.Object:
                var e = expected.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToList();
                var a = actual.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToList();
                Assert.True(e.SequenceEqual(a), $"{path}: keys [{string.Join(",", e)}] vs [{string.Join(",", a)}]");
                foreach (var p in expected.EnumerateObject()) Equal(p.Value, actual.GetProperty(p.Name), $"{path}.{p.Name}");
                break;
            case JsonValueKind.Array:
                Assert.True(expected.GetArrayLength() == actual.GetArrayLength(), $"{path}: length {expected.GetArrayLength()} vs {actual.GetArrayLength()}");
                for (var i = 0; i < expected.GetArrayLength(); i++) Equal(expected[i], actual[i], $"{path}[{i}]");
                break;
            case JsonValueKind.String:
                Assert.True(expected.GetString() == actual.GetString(), $"{path}: \"{expected.GetString()}\" vs \"{actual.GetString()}\"");
                break;
        }
    }
}
