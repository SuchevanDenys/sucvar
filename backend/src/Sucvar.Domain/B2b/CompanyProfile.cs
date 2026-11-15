using System.Text.Json;
using System.Text.RegularExpressions;

namespace Sucvar.Domain.B2b;

/// <summary>
/// The contractor's company (the "Entreprise" on the devis / Factur-X). French market mapping:
/// <c>VatId</c> = N° TVA intracommunautaire (FRxx + SIREN), <c>RegNo</c> = SIREN (9 digits) or SIRET (14 digits). Stored in `company_profiles`
/// (migration 003) so it survives a change of device — previously it lived only in localStorage.
/// </summary>
public sealed record CompanyProfile(
    string Name,
    string VatId,
    string RegNo,
    string Address,
    string Iban,
    string Bank,
    string Email,
    string Phone)
{
    public static readonly CompanyProfile Empty = new("", "", "", "", "", "", "", "");
}

public sealed record ParsedCompany(bool Ok, CompanyProfile? Value, string? Code, string? Error);

/// <summary>Parses and validates the company body (same "untrusted input" discipline as EstimateParser).</summary>
public static partial class CompanyProfileParser
{
    private static string Text(JsonElement? v, int max) => Js.AsString(v) is { } s ? Js.Slice(s.Trim(), max) : "";

    public static ParsedCompany Parse(JsonElement? body)
    {
        if (!Js.IsRecord(body)) return new(false, null, "INVALID_BODY", "Corp invalid: se așteaptă un obiect JSON.");
        JsonElement? P(string n) => Js.Prop(body, n);

        var vatId = NormalizeVatId(Text(P("vatId"), 40));
        if (vatId.Length > 0 && !IsValidVatId(vatId))
            return new(false, null, "INVALID_VAT_ID", "N° TVA intracommunautaire / CUI invalide (clé de contrôle incorrecte).");

        var regNo = Text(P("regNo"), 40);
        if (IsFrenchRegistration(regNo) is false)
            return new(false, null, "INVALID_SIRET", "SIREN / SIRET invalide (clé de contrôle incorrecte).");

        var iban = Regex.Replace(Text(P("iban"), 50), @"\s+", "").ToUpperInvariant();
        if (iban.Length > 0 && !IsValidIban(iban)) return new(false, null, "INVALID_IBAN", "IBAN invalid.");

        var email = Text(P("email"), 200);
        if (email.Length > 0 && !EmailPattern().IsMatch(email)) return new(false, null, "INVALID_EMAIL", "Email invalid.");

        return new(true, new CompanyProfile(
            Text(P("name"), 200),
            vatId,
            regNo,
            Text(P("address"), 300),
            iban,
            Text(P("bank"), 100),
            email,
            Text(P("phone"), 40)), null, null);
    }

    /// <summary>Upper-case, no spaces; "ro 123" → "RO123".</summary>
    public static string NormalizeVatId(string raw) => Regex.Replace(raw, @"\s+", "").ToUpperInvariant();

    /// <summary>
    /// SIREN (9 digits) / SIRET (14 digits) check with the Luhn algorithm (spaces ignored).
    /// Returns null when the value is not a French number at all (empty, or a free-form registry like "J40/123/2020"),
    /// so other formats stay accepted. La Poste SIRETs (SIREN 356000000) use the digit-sum-mod-5 rule.
    /// </summary>
    public static bool? IsFrenchRegistration(string raw)
    {
        var digits = Regex.Replace(raw, @"\s+", "");
        if (digits.Length is not (9 or 14) || !digits.All(char.IsAsciiDigit)) return null;
        if (digits.Length == 14 && digits.StartsWith("356000000", StringComparison.Ordinal) && digits != "35600000000048")
            return digits.Sum(c => c - '0') % 5 == 0;
        return Luhn(digits);
    }

    public static bool Luhn(string digits)
    {
        var sum = 0;
        for (var i = 0; i < digits.Length; i++)
        {
            var d = digits[digits.Length - 1 - i] - '0';
            if (i % 2 == 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        return sum % 10 == 0;
    }

    /// <summary>French intra-community VAT: FR + 2-char key + SIREN; numeric key = (12 + 3 × (SIREN mod 97)) mod 97.</summary>
    public static bool IsValidFrVat(string vatId)
    {
        var m = FrVatPattern().Match(vatId);
        if (!m.Success) return false;
        var key = m.Groups[1].Value;
        var siren = m.Groups[2].Value;
        if (!Luhn(siren) && siren != "356000000") return false;
        if (!key.All(char.IsAsciiDigit)) return true; // alphanumeric keys (new companies) are format-checked only
        var expected = (12 + 3 * (long.Parse(siren, System.Globalization.CultureInfo.InvariantCulture) % 97)) % 97;
        return int.Parse(key, System.Globalization.CultureInfo.InvariantCulture) == expected;
    }

    /// <summary>
    /// Romanian CUI (with or without the "RO" prefix): 2–10 digits, last one is a control digit computed with
    /// the key 753217532 (ANAF algorithm). Other EU VAT ids are accepted on format only (2 letters + 2–13 chars).
    /// </summary>
    public static bool IsValidVatId(string vatId)
    {
        var ro = RoCuiPattern().Match(vatId);
        if (ro.Success) return IsValidRoCui(ro.Groups[1].Value);
        if (vatId.StartsWith("FR", StringComparison.Ordinal)) return IsValidFrVat(vatId);
        return ForeignVatPattern().IsMatch(vatId) && !vatId.StartsWith("RO", StringComparison.Ordinal);
    }

    public static bool IsValidRoCui(string digits)
    {
        if (digits.Length is < 2 or > 10 || !digits.All(char.IsAsciiDigit)) return false;
        const string key = "753217532";
        var body = digits[..^1].PadLeft(9, '0');
        var sum = 0;
        for (var i = 0; i < 9; i++) sum += (body[i] - '0') * (key[i] - '0');
        var control = sum * 10 % 11;
        if (control == 10) control = 0;
        return control == digits[^1] - '0';
    }

    /// <summary>ISO 13616 mod-97 check (RO IBAN = 24 chars).</summary>
    public static bool IsValidIban(string iban)
    {
        if (!IbanPattern().IsMatch(iban)) return false;
        if (iban.StartsWith("RO", StringComparison.Ordinal) && iban.Length != 24) return false;
        if (iban.StartsWith("FR", StringComparison.Ordinal) && iban.Length != 27) return false;
        var rearranged = iban[4..] + iban[..4];
        var remainder = 0;
        foreach (var c in rearranged)
        {
            var value = char.IsAsciiDigit(c) ? c - '0' : c - 'A' + 10;
            remainder = value >= 10 ? (remainder * 100 + value) % 97 : (remainder * 10 + value) % 97;
        }
        return remainder == 1;
    }

    [GeneratedRegex(@"^(?:RO)?(\d{2,10})$")]
    private static partial Regex RoCuiPattern();

    [GeneratedRegex(@"^FR([0-9A-HJ-NP-Z]{2})(\d{9})$")]
    private static partial Regex FrVatPattern();

    [GeneratedRegex(@"^[A-Z]{2}[A-Z0-9]{2,13}$")]
    private static partial Regex ForeignVatPattern();

    [GeneratedRegex(@"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$")]
    private static partial Regex IbanPattern();

    [GeneratedRegex(@"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
    private static partial Regex EmailPattern();
}
