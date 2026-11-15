namespace Sucvar.Api.Http;

/// <summary>A named fixed-window rule (name is part of the key, e.g. "generate:user").</summary>
public sealed record RateLimitRule(string Name, int Limit, int WindowSeconds);

/// <summary>All per-route limits from the monolith, unchanged.</summary>
public static class Rules
{
    public static readonly RateLimitRule GenerateIp = new("generate:ip", 30, 60);
    public static readonly RateLimitRule GenerateUser = new("generate:user", 6, 60);
    public static readonly RateLimitRule MaterialsIp = new("materials:ip", 30, 60);
    public static readonly RateLimitRule MaterialsUser = new("materials:user", 12, 60);
    public static readonly RateLimitRule CheckoutIp = new("checkout:ip", 30, 600);
    public static readonly RateLimitRule CheckoutUser = new("checkout:user", 8, 600);
    public static readonly RateLimitRule VerifyIp = new("verify:ip", 60, 600);
    public static readonly RateLimitRule VerifyUser = new("verify:user", 30, 600);
    public static readonly RateLimitRule EstimatesWrite = new("estimates:write", 60, 600);
    public static readonly RateLimitRule SharingWrite = new("sharing:write", 30, 600);
    public static readonly RateLimitRule ProcurementWrite = new("procurement:write", 30, 600);
    public static readonly RateLimitRule BillingPortalUser = new("billing-portal:user", 10, 600);
    public static readonly RateLimitRule ProfileWrite = new("profile:write", 30, 600);
    public static readonly RateLimitRule CompanyWrite = new("company:write", 30, 600);
    public static readonly RateLimitRule PortalRead = new("portal:read", 60, 60);
    public static readonly RateLimitRule PortalReviewIp = new("portal:review:ip", 10, 600);
    public static readonly RateLimitRule PortalReviewProject = new("portal:review:project", 3, 600);
}

/// <summary>
/// Port of checkRateLimit (fixed window, in memory, per instance). Memory-safe: expired buckets are
/// swept periodically and the key count is capped (oldest evicted first). Ordered checks inside the
/// handlers (IP before auth, user after auth) keep the original semantics; the framework
/// <c>AddRateLimiter</c> global limiter in Program.cs is an additional coarse safety net.
/// </summary>
public sealed class FixedWindowRateLimitStore(TimeProvider clock)
{
    private const int MaxBuckets = 10_000;
    private sealed class Bucket { public int Count; public long ResetAt; }

    private readonly Dictionary<string, Bucket> _buckets = new();
    private readonly LinkedList<string> _order = new();
    private readonly Dictionary<string, LinkedListNode<string>> _nodes = new();
    private readonly Lock _gate = new();
    private long _lastSweep;

    private long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>Seconds until reset when the limit is exceeded, otherwise null.</summary>
    public int? Check(RateLimitRule rule, string identity)
    {
        lock (_gate)
        {
            var now = Now;
            Sweep(now);
            var key = $"{rule.Name}:{identity}";
            if (!_buckets.TryGetValue(key, out var bucket) || bucket.ResetAt <= now)
            {
                Remove(key);
                _buckets[key] = new Bucket { Count = 1, ResetAt = now + rule.WindowSeconds * 1000L };
                _nodes[key] = _order.AddLast(key);
                return null;
            }
            bucket.Count += 1;
            if (bucket.Count > rule.Limit) return Math.Max(1, (int)Math.Ceiling((bucket.ResetAt - now) / 1000.0));
            return null;
        }
    }

    private void Remove(string key)
    {
        _buckets.Remove(key);
        if (_nodes.Remove(key, out var node)) _order.Remove(node);
    }

    private void Sweep(long now)
    {
        if (now - _lastSweep < 30_000 && _buckets.Count < MaxBuckets) return;
        _lastSweep = now;
        foreach (var key in _buckets.Where(kv => kv.Value.ResetAt <= now).Select(kv => kv.Key).ToList()) Remove(key);
        while (_buckets.Count >= MaxBuckets && _order.First is { } oldest) Remove(oldest.Value);
    }
}
