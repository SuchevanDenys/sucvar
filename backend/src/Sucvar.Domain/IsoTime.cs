using System.Globalization;

namespace Sucvar.Domain;

/// <summary>
/// Canonical wire format for timestamps in every API response.
/// </summary>
/// <remarks>
/// The frontend was written against PostgREST, which serialises <c>timestamptz</c> as
/// <c>2026-11-15T10:00:00.123456+00:00</c> (microseconds, explicit <c>+00:00</c> offset, never <c>Z</c>).
/// Keeping that exact shape lets the .NET API stay byte-compatible with the original contract and with the
/// golden-test fixtures, so all layers must format dates through this helper rather than <c>ToString("O")</c>.
/// </remarks>
public static class IsoTime
{
    private const string Pattern = "yyyy-MM-dd'T'HH:mm:ss.ffffffzzz";

    /// <summary>Formats <paramref name="value"/> in UTC using the PostgREST <c>timestamptz</c> shape.</summary>
    public static string Format(DateTimeOffset value) =>
        value.ToUniversalTime().ToString(Pattern, CultureInfo.InvariantCulture);

    /// <summary>Null-propagating overload: absent timestamps stay <c>null</c> in JSON.</summary>
    public static string? Format(DateTimeOffset? value) => value is { } v ? Format(v) : null;
}
