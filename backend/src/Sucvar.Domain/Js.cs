using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Sucvar.Domain;

/// <summary>
/// JavaScript-compatible primitives. The monolith validated untrusted JSON with JS semantics
/// (<c>Number(x)</c>, <c>Math.round</c>, <c>toFixed</c>, <c>encodeURIComponent</c>); these helpers
/// reproduce them exactly so the .NET port returns byte-identical results.
/// A <c>null</c> <see cref="JsonElement"/>? means "property absent" (JS <c>undefined</c>).
/// </summary>
public static class Js
{
    /// <summary>JS <c>Number(value)</c>. Absent (undefined) → NaN, JSON null → 0.</summary>
    public static double ToNumber(JsonElement? value)
    {
        if (value is not { } v) return double.NaN;
        return v.ValueKind switch
        {
            JsonValueKind.Number => v.GetDouble(),
            JsonValueKind.String => StringToNumber(v.GetString()!),
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.Null => 0,
            JsonValueKind.Array => ArrayToNumber(v),
            _ => double.NaN,
        };
    }

    private static double ArrayToNumber(JsonElement array)
    {
        var len = array.GetArrayLength();
        if (len == 0) return 0;
        if (len > 1) return double.NaN;
        var only = array[0];
        return only.ValueKind switch
        {
            JsonValueKind.Null => 0,
            JsonValueKind.Array or JsonValueKind.Object => only.ValueKind == JsonValueKind.Array ? ArrayToNumber(only) : double.NaN,
            JsonValueKind.True or JsonValueKind.False => double.NaN, // String(true) = "true" → NaN
            JsonValueKind.Number => only.GetDouble(),
            _ => StringToNumber(only.GetString() ?? ""),
        };
    }

    /// <summary>JS StringToNumber: whitespace-only → 0, hex/binary/octal literals, Infinity.</summary>
    public static double StringToNumber(string raw)
    {
        var s = raw.Trim();
        if (s.Length == 0) return 0;
        if (s is "Infinity" or "+Infinity") return double.PositiveInfinity;
        if (s == "-Infinity") return double.NegativeInfinity;
        if (s.Length > 2 && s[0] == '0' && (s[1] is 'x' or 'X' or 'b' or 'B' or 'o' or 'O'))
        {
            var radix = s[1] is 'x' or 'X' ? 16 : s[1] is 'b' or 'B' ? 2 : 8;
            double acc = 0;
            foreach (var c in s.AsSpan(2))
            {
                var d = char.IsAsciiDigit(c) ? c - '0' : char.IsAsciiLetter(c) ? char.ToLowerInvariant(c) - 'a' + 10 : 99;
                if (d >= radix) return double.NaN;
                acc = acc * radix + d;
            }
            return acc;
        }
        foreach (var c in s)
        {
            if (!(char.IsAsciiDigit(c) || c is '.' or 'e' or 'E' or '+' or '-')) return double.NaN;
        }
        return double.TryParse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent,
            CultureInfo.InvariantCulture, out var parsed) ? parsed : double.NaN;
    }

    public static bool IsFinite(double v) => double.IsFinite(v);

    /// <summary>JS <c>Math.round</c> (ties toward +∞).</summary>
    public static double Round(double x)
    {
        if (!double.IsFinite(x)) return x;
        var floor = Math.Floor(x);
        return x - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>JS <c>+x.toFixed(digits)</c>.</summary>
    public static double ToFixed(double x, int digits) =>
        double.Parse(ToFixedString(x, digits), CultureInfo.InvariantCulture);

    /// <summary>JS <c>x.toFixed(digits)</c> as string (exact decimal expansion, ties up).</summary>
    public static string ToFixedString(double x, int digits)
    {
        var dec = new decimal(0);
        try
        {
            // decimal(double) rounds to 15 significant digits; use the exact "R" text instead.
            dec = decimal.Parse(x.ToString("E28", CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture);
        }
        catch (OverflowException)
        {
            return x.ToString("F" + digits, CultureInfo.InvariantCulture);
        }
        // ECMAScript toFixed works on |x| (ties → larger magnitude) and re-applies the sign.
        var rounded = Math.Round(dec, digits, MidpointRounding.AwayFromZero);
        return rounded.ToString("F" + digits, CultureInfo.InvariantCulture);
    }

    /// <summary>JS <c>String(number)</c> for the values used in labels (integers / short decimals).</summary>
    public static string Str(double x) => x.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>JS <c>encodeURIComponent</c>.</summary>
    public static string EncodeUriComponent(string value)
    {
        var sb = new StringBuilder(value.Length * 2);
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            var c = (char)b;
            if (b < 0x80 && (char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '!' or '~' or '*' or '\'' or '(' or ')'))
                sb.Append(c);
            else
                sb.Append('%').Append(b.ToString("X2"));
        }
        return sb.ToString();
    }

    /// <summary><c>s.normalize('NFD').replace(/[̀-ͯ]/g, '')</c></summary>
    public static string StripDiacritics(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s.Normalize(NormalizationForm.FormD))
        {
            if (c < '̀' || c > 'ͯ') sb.Append(c);
        }
        return sb.ToString();
    }

    public static bool IsRecord(JsonElement? v) => v is { ValueKind: JsonValueKind.Object };

    public static JsonElement? Prop(JsonElement? obj, string name) =>
        obj is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var p) ? p : null;

    public static string? AsString(JsonElement? v) => v is { ValueKind: JsonValueKind.String } s ? s.GetString() : null;

    /// <summary>JS <c>String.prototype.slice(0, max)</c>.</summary>
    public static string Slice(string s, int max) => s.Length <= max ? s : s[..max];

    public static double Clamp(double v, double min, double max) => Math.Min(max, Math.Max(min, v));
}
