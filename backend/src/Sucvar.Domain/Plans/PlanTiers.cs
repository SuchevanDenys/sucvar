namespace Sucvar.Domain.Plans;

/// <summary>Port of app/lib/plan/tiers.ts — the single source of truth for plan rules.</summary>
public static class PlanTiers
{
    public const string Starter = "starter";
    public const string Pro = "pro";
    public const string Agency = "agency";

    /// <summary>PLAN_LIMITS.starterMonthlyGenerations</summary>
    public const int StarterMonthlyGenerations = 3;

    public const double AnnualDiscount = 0.2;

    public static readonly IReadOnlyDictionary<string, int> TierRank = new Dictionary<string, int>
    {
        [Starter] = 0,
        [Pro] = 1,
        [Agency] = 2,
    };

    public static string NormalizeTier(object? value)
    {
        if (value is not string s) return Starter;
        var v = s.Trim().ToLowerInvariant();
        if (v is "agency" or "enterprise" or "business") return Agency;
        if (v is "pro" or "professional") return Pro;
        return Starter;
    }

    public static bool IsUnlimitedTier(string tier) => tier is Pro or Agency;

    /// <summary>Only 'agency' unlocks /b2b (EnterpriseGate).</summary>
    public static bool HasB2bAccess(string tier) => tier == Agency;

    public static bool CoversTier(string current, string requested) => TierRank[current] >= TierRank[requested];

    public static string? NormalizeInterval(object? value) => value is "month" or "year" ? (string)value : null;

    public static long AnnualTotalCents(long monthlyCents) => (long)Js.Round(monthlyCents * 12 * (1 - AnnualDiscount));

    public static bool IsPeriodExpired(DateTimeOffset? periodEnd, DateTimeOffset now) => periodEnd is { } end && end < now;

    /// <summary>
    /// Whole days left until the STORED period end (rounded up); 0 once it has passed; null when no end is stored.
    /// Always derived from the persisted date — never from "now + N days". Mirrors <c>daysRemaining()</c> in tiers.ts.
    /// </summary>
    public static int? DaysRemaining(DateTimeOffset? periodEnd, DateTimeOffset now) =>
        periodEnd is { } end ? Math.Max(0, (int)Math.Ceiling((end - now).TotalDays)) : null;

    /// <summary>A paid plan whose period has ended is treated as 'starter'. Missing date keeps the plan.</summary>
    public static string ResolveEffectiveTier(object? rawTier, DateTimeOffset? periodEnd, DateTimeOffset now)
    {
        var tier = NormalizeTier(rawTier);
        return tier != Starter && IsPeriodExpired(periodEnd, now) ? Starter : tier;
    }

    /// <summary>Anti double-billing guard (canPurchase).</summary>
    public static bool CanPurchase(string currentTier, string? currentInterval, string requestedTier, string requestedInterval)
    {
        if (currentTier == Starter) return true;
        if (TierRank[requestedTier] > TierRank[currentTier]) return true;
        return requestedTier == currentTier && requestedInterval == "year" && currentInterval != "year";
    }
}

/// <summary>Port of app/lib/billing/stripe.ts (price table lives on the server).</summary>
public static class PaidPlans
{
    public const string Currency = "eur";

    public static readonly IReadOnlyDictionary<string, (string Name, long UnitAmount)> Plans = new Dictionary<string, (string, long)>
    {
        [PlanTiers.Pro] = ("SUCVAR Professional", 2900),
        [PlanTiers.Agency] = ("SUCVAR Business", 7900),
    };

    public static bool IsPaidPlan(object? value) => value is PlanTiers.Pro or PlanTiers.Agency;

    public static long UnitAmountFor(string plan, string interval)
    {
        var monthly = Plans[plan].UnitAmount;
        return interval == "year" ? PlanTiers.AnnualTotalCents(monthly) : monthly;
    }

    /// <summary>Env key STRIPE_PRICE_{PLAN}_{INTERVAL}.</summary>
    public static string PriceEnvKey(string plan, string interval) => $"STRIPE_PRICE_{plan.ToUpperInvariant()}_{interval.ToUpperInvariant()}";
}
