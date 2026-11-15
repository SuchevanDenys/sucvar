using System.Text.Json;

namespace Sucvar.Domain.Profile;

/// <summary>Default B2B settings of a user (profiles.default_*, migration 004).</summary>
public sealed record ProfileDefaults(string Currency, double VatRate, double MarginPercent)
{
    public static readonly ProfileDefaults Initial = new("EUR", 20, 15);
}

/// <summary>Editable identity fields stored in `profiles`.</summary>
public sealed record ProfileDetails(string? FullName, string? AvatarUrl, ProfileDefaults Defaults);

/// <summary>
/// PUT /api/profile after validation. A field is changed only when it was present in the body
/// (<c>SetFullName</c> / <c>SetAvatar</c>); "" or null clears it. Null section = "do not change".
/// </summary>
public sealed record ProfileUpdate(string? FullName, bool SetFullName, string? AvatarUrl, bool SetAvatar, ProfileDefaults? Defaults, JsonElement? Company)
{
    public bool HasIdentity => SetFullName || SetAvatar;
}

public sealed record ParsedProfileUpdate(bool Ok, ProfileUpdate? Value, string? Code, string? Error)
{
    public static ParsedProfileUpdate Fail(string code, string error) => new(false, null, code, error);
}

/// <summary>Validates the untrusted PUT /api/profile body (same discipline as the other parsers).</summary>
public static class ProfileUpdateParser
{
    public static readonly string[] Currencies = ["EUR", "RON"];
    public const int FullNameMax = 120;
    public const int AvatarUrlMax = 500;

    public static ParsedProfileUpdate Parse(JsonElement? body)
    {
        if (!Js.IsRecord(body)) return ParsedProfileUpdate.Fail("INVALID_BODY", "Corp invalid: se așteaptă un obiect JSON.");
        JsonElement? P(string n) => Js.Prop(body, n);


        string? fullName = null;
        if (P("fullName") is { } fn && fn.ValueKind != JsonValueKind.Null)
        {
            if (fn.ValueKind != JsonValueKind.String) return ParsedProfileUpdate.Fail("INVALID_NAME", "Numele trebuie să fie text.");
            fullName = PublicText(fn.GetString()!);
            if (fullName.Length > FullNameMax) return ParsedProfileUpdate.Fail("INVALID_NAME", $"Numele poate avea maximum {FullNameMax} de caractere.");
            if (fullName.Length == 0) fullName = null;
        }

        string? avatarUrl = null;
        if (P("avatarUrl") is { } av && av.ValueKind != JsonValueKind.Null)
        {
            var raw = Js.AsString(av)?.Trim() ?? "";
            if (raw.Length > 0)
            {
                // Only https images: the URL is rendered in <img> for the user and must not be a data:/javascript: URL
                if (raw.Length > AvatarUrlMax || !Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
                    return ParsedProfileUpdate.Fail("INVALID_AVATAR", "Avatarul trebuie să fie o adresă https validă.");
                avatarUrl = uri.ToString();
            }
        }

        ProfileDefaults? defaults = null;
        if (Js.IsRecord(P("defaults")))
        {
            var d = P("defaults");
            var currency = (Js.AsString(Js.Prop(d, "currency")) ?? "EUR").Trim().ToUpperInvariant();
            if (!Currencies.Contains(currency)) return ParsedProfileUpdate.Fail("INVALID_CURRENCY", "Moneda trebuie să fie EUR sau RON.");
            var vat = Js.ToNumber(Js.Prop(d, "vatRate"));
            var margin = Js.ToNumber(Js.Prop(d, "marginPercent"));
            if (!double.IsFinite(vat) || vat is < 0 or > 100) return ParsedProfileUpdate.Fail("INVALID_VAT", "TVA trebuie să fie între 0 și 100%.");
            if (!double.IsFinite(margin) || margin is < 0 or > 100) return ParsedProfileUpdate.Fail("INVALID_MARGIN", "Marja trebuie să fie între 0 și 100%.");
            defaults = new ProfileDefaults(currency, Js.Round(vat * 100) / 100, Js.Round(margin * 100) / 100);
        }
        else if (P("defaults") is { ValueKind: not JsonValueKind.Null })
        {
            return ParsedProfileUpdate.Fail("INVALID_BODY", "defaults trebuie să fie un obiect.");
        }

        var company = Js.IsRecord(P("company")) ? P("company") : null;
        return new ParsedProfileUpdate(true,
            new ProfileUpdate(fullName, P("fullName") is not null, avatarUrl, P("avatarUrl") is not null, defaults, company), null, null);
    }

    /// <summary>Trim + drop control characters (the name is shown on quotes and in the navbar).</summary>
    private static string PublicText(string s) =>
        new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();
}

/// <summary>"Ana Maria Pop" → "AP"; email fallback → first letter.</summary>
public static class Initials
{
    public static string From(string? fullName, string? email)
    {
        var parts = (fullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2) return $"{char.ToUpperInvariant(parts[0][0])}{char.ToUpperInvariant(parts[^1][0])}";
        if (parts.Length == 1) return char.ToUpperInvariant(parts[0][0]).ToString();
        return string.IsNullOrEmpty(email) ? "?" : char.ToUpperInvariant(email[0]).ToString();
    }
}
