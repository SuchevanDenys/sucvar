using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Sucvar.Domain.Plans;

namespace Sucvar.Domain.Admin;

/// <summary>profiles.role (migration 005, CHECK profiles_role_check).</summary>
public static class Roles
{
    public const string User = "user";
    public const string Admin = "admin";
    public static bool IsValid(string? role) => role is User or Admin;
}

/// <summary>admin_audit_logs.action (CHECK admin_audit_logs_action_check).</summary>
public static class AuditActions
{
    public const string UpdatePlan = "user.update_plan";
    public const string AdjustQuota = "user.adjust_quota";
    public const string ToggleBan = "user.toggle_ban";
    public const string ChangeRole = "user.change_role";
    public const string UnpublishProject = "project.unpublish";
    public const string UpdateSettings = "settings.update";
}

/// <summary>admin_audit_logs.target_type.</summary>
public static class AuditTargets
{
    public const string User = "user";
    public const string Project = "project";
    public const string Settings = "settings";
}

// ── Platform settings (app_settings) ─────────────────────────────────────────────

/// <summary>`MonthlyGenerations` null = unlimited.</summary>
public sealed record PlanLimit(int? MonthlyGenerations);

public sealed record PlanLimits(PlanLimit Starter, PlanLimit Pro, PlanLimit Agency)
{
    public int? LimitFor(string tier) => tier switch
    {
        PlanTiers.Pro => Pro.MonthlyGenerations,
        PlanTiers.Agency => Agency.MonthlyGenerations,
        _ => Starter.MonthlyGenerations,
    };
}

public sealed record PlanPrice(decimal MonthlyEur);

public sealed record PricingDisplay(string Currency, decimal AnnualDiscountPct, PlanPrice Starter, PlanPrice Pro, PlanPrice Agency)
{
    public decimal MonthlyEurFor(string tier) => tier switch
    {
        PlanTiers.Pro => Pro.MonthlyEur,
        PlanTiers.Agency => Agency.MonthlyEur,
        _ => Starter.MonthlyEur,
    };
}

public sealed record SystemFlags(bool MaintenanceMode, bool AllowNewRegistrations, decimal EstimatedRenderCostEur);

/// <summary>The three rows of `app_settings`. Defaults = the values hard-coded before migration 005.</summary>
public sealed record PlatformSettings(PlanLimits PlanLimits, PricingDisplay PricingDisplay, SystemFlags SystemFlags)
{
    public const string PlanLimitsKey = "plan_limits";
    public const string PricingDisplayKey = "pricing_display";
    public const string SystemFlagsKey = "system_flags";
    public static readonly string[] Keys = [PlanLimitsKey, PricingDisplayKey, SystemFlagsKey];

    public static readonly PlatformSettings Defaults = new(
        new PlanLimits(new PlanLimit(PlanTiers.StarterMonthlyGenerations), new PlanLimit(null), new PlanLimit(null)),
        new PricingDisplay("EUR", (decimal)(PlanTiers.AnnualDiscount * 100),
            new PlanPrice(0),
            new PlanPrice(PaidPlans.Plans[PlanTiers.Pro].UnitAmount / 100m),
            new PlanPrice(PaidPlans.Plans[PlanTiers.Agency].UnitAmount / 100m)),
        new SystemFlags(false, true, 0.04m));
}

public sealed record ParsedSettings(bool Ok, PlatformSettings? Value, IReadOnlyList<string> ChangedKeys, string? Error)
{
    public static ParsedSettings Fail(string error) => new(false, null, [], error);
}

/// <summary>
/// Reads/writes `app_settings` JSON. Storage uses snake_case keys (as seeded by migration 005); the API
/// accepts camelCase (and snake_case). <c>strict</c> = PUT body (any invalid field ⇒ 400); non-strict =
/// database read (an invalid or missing field keeps the current/default value, never throws).
/// </summary>
public static class SettingsCodec
{
    public const int MaxMonthlyGenerations = 100_000;
    public const decimal MaxMonthlyEur = 100_000m;
    public const decimal MaxRenderCostEur = 100m;
    public static readonly string[] Currencies = ["EUR", "RON"];

    private sealed class Invalid(string message) : Exception(message);

    private static JsonElement? Field(JsonElement? obj, string snake, string camel) =>
        Js.Prop(obj, snake) ?? Js.Prop(obj, camel);

    private static bool Has(JsonElement? obj, string snake, string camel) => Field(obj, snake, camel) is not null;

    // ── field readers ──
    private static int? ReadLimit(JsonElement? obj, int? current, bool strict, string label)
    {
        var v = Field(obj, "monthly_generations", "monthlyGenerations");
        if (v is null) return current;
        if (v.Value.ValueKind == JsonValueKind.Null) return null;
        if (v.Value.ValueKind == JsonValueKind.Number && v.Value.TryGetInt32(out var n) && n >= 0 && n <= MaxMonthlyGenerations) return n;
        if (strict) throw new Invalid($"{label}: limita lunară trebuie să fie un număr întreg între 0 și {MaxMonthlyGenerations} sau null (nelimitat).");
        return current;
    }

    private static decimal ReadDecimal(JsonElement? v, decimal current, decimal min, decimal max, int decimals, bool strict, string label)
    {
        if (v is null) return current;
        if (v.Value.ValueKind == JsonValueKind.Number && v.Value.TryGetDecimal(out var d) && d >= min && d <= max)
            return Math.Round(d, decimals, MidpointRounding.AwayFromZero);
        if (strict) throw new Invalid($"{label} trebuie să fie între {min.ToString(CultureInfo.InvariantCulture)} și {max.ToString(CultureInfo.InvariantCulture)}.");
        return current;
    }

    private static bool ReadBool(JsonElement? v, bool current, bool strict, string label)
    {
        if (v is null) return current;
        if (v.Value.ValueKind is JsonValueKind.True or JsonValueKind.False) return v.Value.GetBoolean();
        if (strict) throw new Invalid($"{label} trebuie să fie boolean.");
        return current;
    }

    private static JsonElement? Section(JsonElement? obj, string name, bool strict, string label)
    {
        if (obj is null) return null;
        if (obj.Value.ValueKind == JsonValueKind.Object) return obj;
        if (strict) throw new Invalid($"{label} trebuie să fie un obiect.");
        return null;
    }

    // ── sections ──
    public static PlanLimits ReadPlanLimits(JsonElement? obj, PlanLimits current, bool strict)
    {
        var root = Section(obj, "plan_limits", strict, "planLimits");
        if (root is null) return current;
        PlanLimit Tier(string tier, PlanLimit cur)
        {
            var section = Section(Js.Prop(root, tier), tier, strict, $"planLimits.{tier}");
            return section is null ? cur : new PlanLimit(ReadLimit(section, cur.MonthlyGenerations, strict, $"planLimits.{tier}"));
        }
        return new PlanLimits(Tier(PlanTiers.Starter, current.Starter), Tier(PlanTiers.Pro, current.Pro), Tier(PlanTiers.Agency, current.Agency));
    }

    public static PricingDisplay ReadPricing(JsonElement? obj, PricingDisplay current, bool strict)
    {
        var root = Section(obj, "pricing_display", strict, "pricingDisplay");
        if (root is null) return current;

        var currency = current.Currency;
        if (Js.Prop(root, "currency") is { } c)
        {
            var raw = Js.AsString(c)?.Trim().ToUpperInvariant();
            if (raw is not null && Currencies.Contains(raw)) currency = raw;
            else if (strict) throw new Invalid("pricingDisplay.currency trebuie să fie EUR sau RON.");
        }
        var discount = ReadDecimal(Field(root, "annual_discount_pct", "annualDiscountPct"), current.AnnualDiscountPct, 0, 90, 2, strict, "pricingDisplay.annualDiscountPct");
        PlanPrice Price(string tier, PlanPrice cur)
        {
            var section = Section(Js.Prop(root, tier), tier, strict, $"pricingDisplay.{tier}");
            return section is null ? cur : new PlanPrice(ReadDecimal(Field(section, "monthly_eur", "monthlyEur"), cur.MonthlyEur, 0, MaxMonthlyEur, 2, strict, $"pricingDisplay.{tier}.monthlyEur"));
        }
        return new PricingDisplay(currency, discount, Price(PlanTiers.Starter, current.Starter), Price(PlanTiers.Pro, current.Pro), Price(PlanTiers.Agency, current.Agency));
    }

    public static SystemFlags ReadFlags(JsonElement? obj, SystemFlags current, bool strict)
    {
        var root = Section(obj, "system_flags", strict, "systemFlags");
        if (root is null) return current;
        return new SystemFlags(
            ReadBool(Field(root, "maintenance_mode", "maintenanceMode"), current.MaintenanceMode, strict, "systemFlags.maintenanceMode"),
            ReadBool(Field(root, "allow_new_registrations", "allowNewRegistrations"), current.AllowNewRegistrations, strict, "systemFlags.allowNewRegistrations"),
            ReadDecimal(Field(root, "estimated_render_cost_eur", "estimatedRenderCostEur"), current.EstimatedRenderCostEur, 0, MaxRenderCostEur, 4, strict,
                "systemFlags.estimatedRenderCostEur"));
    }

    /// <summary>Database rows (key → jsonb text) → settings; never throws, falls back to defaults.</summary>
    public static PlatformSettings FromStorage(IReadOnlyDictionary<string, string> rows)
    {
        JsonElement? Parse(string key)
        {
            if (!rows.TryGetValue(key, out var text)) return null;
            try { return JsonDocument.Parse(text).RootElement.Clone(); }
            catch (JsonException) { return null; }
        }
        var d = PlatformSettings.Defaults;
        return new PlatformSettings(
            ReadPlanLimits(Parse(PlatformSettings.PlanLimitsKey), d.PlanLimits, false),
            ReadPricing(Parse(PlatformSettings.PricingDisplayKey), d.PricingDisplay, false),
            ReadFlags(Parse(PlatformSettings.SystemFlagsKey), d.SystemFlags, false));
    }

    /// <summary>
    /// PUT /api/admin/settings body: <c>{ planLimits?, pricingDisplay?, systemFlags? }</c>, each section partial
    /// (absent fields keep the current value). Returns the merged settings and the keys that really changed.
    /// </summary>
    public static ParsedSettings ParseUpdate(JsonElement? body, PlatformSettings current)
    {
        if (!Js.IsRecord(body)) return ParsedSettings.Fail("Corp invalid: se așteaptă un obiect JSON.");
        var known = new[] { "planLimits", "plan_limits", "pricingDisplay", "pricing_display", "systemFlags", "system_flags" };
        if (!body!.Value.EnumerateObject().Any(p => known.Contains(p.Name)))
            return ParsedSettings.Fail("Nicio secțiune de setări (planLimits, pricingDisplay, systemFlags).");
        try
        {
            var next = new PlatformSettings(
                ReadPlanLimits(Field(body, "plan_limits", "planLimits"), current.PlanLimits, true),
                ReadPricing(Field(body, "pricing_display", "pricingDisplay"), current.PricingDisplay, true),
                ReadFlags(Field(body, "system_flags", "systemFlags"), current.SystemFlags, true));
            var changed = new List<string>();
            if (next.PlanLimits != current.PlanLimits) changed.Add(PlatformSettings.PlanLimitsKey);
            if (next.PricingDisplay != current.PricingDisplay) changed.Add(PlatformSettings.PricingDisplayKey);
            if (next.SystemFlags != current.SystemFlags) changed.Add(PlatformSettings.SystemFlagsKey);
            return new ParsedSettings(true, next, changed, null);
        }
        catch (Invalid ex)
        {
            return ParsedSettings.Fail(ex.Message);
        }
    }

    /// <summary>Storage JSON (snake_case) for one key.</summary>
    public static string ToStorage(PlatformSettings s, string key) => key switch
    {
        PlatformSettings.PlanLimitsKey => new JsonObject
        {
            ["starter"] = new JsonObject { ["monthly_generations"] = s.PlanLimits.Starter.MonthlyGenerations },
            ["pro"] = new JsonObject { ["monthly_generations"] = s.PlanLimits.Pro.MonthlyGenerations },
            ["agency"] = new JsonObject { ["monthly_generations"] = s.PlanLimits.Agency.MonthlyGenerations },
        }.ToJsonString(),
        PlatformSettings.PricingDisplayKey => new JsonObject
        {
            ["currency"] = s.PricingDisplay.Currency,
            ["annual_discount_pct"] = s.PricingDisplay.AnnualDiscountPct,
            ["starter"] = new JsonObject { ["monthly_eur"] = s.PricingDisplay.Starter.MonthlyEur },
            ["pro"] = new JsonObject { ["monthly_eur"] = s.PricingDisplay.Pro.MonthlyEur },
            ["agency"] = new JsonObject { ["monthly_eur"] = s.PricingDisplay.Agency.MonthlyEur },
        }.ToJsonString(),
        PlatformSettings.SystemFlagsKey => new JsonObject
        {
            ["maintenance_mode"] = s.SystemFlags.MaintenanceMode,
            ["allow_new_registrations"] = s.SystemFlags.AllowNewRegistrations,
            ["estimated_render_cost_eur"] = s.SystemFlags.EstimatedRenderCostEur,
        }.ToJsonString(),
        _ => throw new ArgumentOutOfRangeException(nameof(key)),
    };
}

// ── PATCH /api/admin/users/{id} ─────────────────────────────────────────────────

/// <summary>Validated admin change set; every member null/false = "do not change".</summary>
public sealed record AdminUserPatch(string? Plan, int? QuotaDelta, bool ResetQuota, string? Role, bool? IsBanned, string? BannedReason)
{
    public bool IsEmpty => Plan is null && QuotaDelta is null && !ResetQuota && Role is null && IsBanned is null;
}

public sealed record ParsedAdminUserPatch(bool Ok, AdminUserPatch? Value, string? Code, string? Error)
{
    public static ParsedAdminUserPatch Fail(string code, string error) => new(false, null, code, error);
}

public static class AdminUserPatchParser
{
    public const int MaxQuotaDelta = 1000;
    public const int BannedReasonMax = 500;
    public static readonly string[] Plans = [PlanTiers.Starter, PlanTiers.Pro, PlanTiers.Agency];

    public static ParsedAdminUserPatch Parse(JsonElement? body)
    {
        if (!Js.IsRecord(body)) return ParsedAdminUserPatch.Fail("INVALID_BODY", "Corp invalid: se așteaptă un obiect JSON.");
        JsonElement? P(string n) => Js.Prop(body, n);

        string? plan = null;
        if (P("plan") is { ValueKind: not JsonValueKind.Null } pl)
        {
            plan = Js.AsString(pl)?.Trim().ToLowerInvariant();
            if (plan is null || !Plans.Contains(plan)) return ParsedAdminUserPatch.Fail("INVALID_PLAN", "Plan invalid (starter | pro | agency).");
        }

        int? delta = null;
        if (P("quotaDelta") is { ValueKind: not JsonValueKind.Null } qd)
        {
            if (qd.ValueKind != JsonValueKind.Number || !qd.TryGetInt32(out var n) || n == 0 || Math.Abs(n) > MaxQuotaDelta)
                return ParsedAdminUserPatch.Fail("INVALID_QUOTA", $"quotaDelta trebuie să fie un întreg nenul între -{MaxQuotaDelta} și {MaxQuotaDelta}.");
            delta = n;
        }

        var reset = false;
        if (P("resetQuota") is { ValueKind: not JsonValueKind.Null } rq)
        {
            if (rq.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return ParsedAdminUserPatch.Fail("INVALID_BODY", "resetQuota trebuie să fie boolean.");
            reset = rq.GetBoolean();
        }

        string? role = null;
        if (P("role") is { ValueKind: not JsonValueKind.Null } r)
        {
            role = Js.AsString(r)?.Trim().ToLowerInvariant();
            if (!Roles.IsValid(role)) return ParsedAdminUserPatch.Fail("INVALID_ROLE", "Rol invalid (user | admin).");
        }

        bool? banned = null;
        if (P("isBanned") is { ValueKind: not JsonValueKind.Null } b)
        {
            if (b.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return ParsedAdminUserPatch.Fail("INVALID_BODY", "isBanned trebuie să fie boolean.");
            banned = b.GetBoolean();
        }

        string? reason = null;
        if (P("bannedReason") is { ValueKind: not JsonValueKind.Null } br)
        {
            if (br.ValueKind != JsonValueKind.String) return ParsedAdminUserPatch.Fail("INVALID_REASON", "Motivul trebuie să fie text.");
            reason = new string(br.GetString()!.Where(c => !char.IsControl(c) || c is '\n').ToArray()).Trim();
            if (reason.Length > BannedReasonMax) return ParsedAdminUserPatch.Fail("INVALID_REASON", $"Motivul poate avea maximum {BannedReasonMax} de caractere.");
            if (reason.Length == 0) reason = null;
        }
        if (reason is not null && banned is not true)
            return ParsedAdminUserPatch.Fail("INVALID_REASON", "bannedReason se trimite doar împreună cu isBanned: true.");

        var patch = new AdminUserPatch(plan, delta, reset, role, banned, banned == true ? reason : null);
        return patch.IsEmpty
            ? ParsedAdminUserPatch.Fail("EMPTY_PATCH", "Nicio modificare (plan, quotaDelta, resetQuota, role, isBanned).")
            : new ParsedAdminUserPatch(true, patch, null, null);
    }
}

public static class Paging
{
    public static (int Page, int PageSize) Normalize(int? page, int? pageSize, int defaultSize, int maxSize) =>
        (Math.Max(1, page ?? 1), Math.Clamp(pageSize ?? defaultSize, 1, maxSize));
}
