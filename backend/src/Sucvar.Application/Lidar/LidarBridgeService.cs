using System.Security.Cryptography;

namespace Sucvar.Application.Lidar;

/// <summary>A 6-digit pairing code issued to a signed-in Studio user.</summary>
public sealed record LidarPairing(string Code, DateTimeOffset ExpiresAtUtc);

/// <summary>
/// One scan pushed by the iPhone companion app. <see cref="Encoding"/> is <c>utf8</c> (RoomPlan <c>.json</c>, <c>.obj</c>:
/// <see cref="RawPayload"/> is the file text) or <c>base64</c> (<c>.zip</c> / <c>.usdz</c>: the file bytes).
/// </summary>
public sealed record LidarScan(
    string ScanId, string FileName, string ContentType, string Encoding, string RawPayload, long SizeBytes, DateTimeOffset UploadedAtUtc);

public enum LidarUploadStatus { Accepted, NotFound, Expired }

public enum LidarPollStatus { NotFound, Waiting, NewScan }

public sealed record LidarPollResult(LidarPollStatus Status, LidarScan? Scan = null, DateTimeOffset? ExpiresAtUtc = null, bool CodeExpired = false);

/// <summary>
/// Live bridge between the iOS RoomPlan companion app and an open Studio session: the web user asks for a code, the
/// phone uploads with it, the Studio polls and receives the scan exactly once.
/// </summary>
public interface ILidarBridgeService
{
    /// <summary>New code for <paramref name="userId"/>; the user's previous codes are revoked (one live pairing per user).</summary>
    LidarPairing Pair(string userId);

    /// <summary>Stores the scan for the code (the newest upload replaces an undelivered older one).</summary>
    LidarUploadStatus Upload(string code, string fileName, string contentType, string encoding, string rawPayload, long sizeBytes, out LidarScan? scan);

    /// <summary>The pending scan of a code owned by <paramref name="userId"/>, marked delivered (returned once).</summary>
    LidarPollResult Poll(string userId, string code);

    /// <summary>Removes sessions past their retention; returns how many were removed.</summary>
    int Sweep();
}

/// <summary>
/// In-memory, thread-safe implementation (singleton). Codes accept uploads for <see cref="CodeLifetime"/>; the session
/// (and an undelivered scan) is kept for <see cref="SessionRetention"/> from pairing, then swept by a background timer.
/// State is per instance: behind several API replicas the pair / upload / poll calls need sticky routing.
/// </summary>
public sealed class LidarBridgeService : ILidarBridgeService, IDisposable
{
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan SessionRetention = TimeSpan.FromMinutes(30);
    public const int MaxSessions = 1_000;

    private sealed class Session(string code, string userId, DateTimeOffset createdAt)
    {
        public string Code { get; } = code;
        public string UserId { get; } = userId;
        public DateTimeOffset CreatedAt { get; } = createdAt;
        public DateTimeOffset ExpiresAt => CreatedAt + CodeLifetime;
        public DateTimeOffset RetainUntil => CreatedAt + SessionRetention;
        public LidarScan? Pending { get; set; }
    }

    private readonly TimeProvider _clock;
    private readonly Dictionary<string, Session> _sessions = new(StringComparer.Ordinal);
    private readonly Lock _gate = new();
    private readonly ITimer _timer;

    public LidarBridgeService(TimeProvider clock)
    {
        _clock = clock;
        _timer = clock.CreateTimer(_ => Sweep(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
    }

    /// <summary>Exactly six ASCII digits.</summary>
    public static bool IsValidCodeFormat(string? code) => code is { Length: 6 } && code.All(char.IsAsciiDigit);

    public LidarPairing Pair(string userId)
    {
        ArgumentException.ThrowIfNullOrEmpty(userId);
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            SweepLocked(now);
            foreach (var old in _sessions.Values.Where(s => s.UserId == userId).Select(s => s.Code).ToList()) _sessions.Remove(old);
            while (_sessions.Count >= MaxSessions)
                _sessions.Remove(_sessions.Values.MinBy(s => s.CreatedAt)!.Code);

            string code;
            do code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            while (_sessions.ContainsKey(code));

            var session = new Session(code, userId, now);
            _sessions[code] = session;
            return new LidarPairing(code, session.ExpiresAt);
        }
    }

    public LidarUploadStatus Upload(string code, string fileName, string contentType, string encoding, string rawPayload, long sizeBytes, out LidarScan? scan)
    {
        scan = null;
        if (!IsValidCodeFormat(code)) return LidarUploadStatus.NotFound;
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            SweepLocked(now);
            if (!_sessions.TryGetValue(code, out var session)) return LidarUploadStatus.NotFound;
            if (now >= session.ExpiresAt) return LidarUploadStatus.Expired;
            scan = new LidarScan(Guid.NewGuid().ToString("N"), fileName, contentType, encoding, rawPayload, sizeBytes, now);
            session.Pending = scan;
            return LidarUploadStatus.Accepted;
        }
    }

    public LidarPollResult Poll(string userId, string code)
    {
        if (!IsValidCodeFormat(code)) return new LidarPollResult(LidarPollStatus.NotFound);
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            SweepLocked(now);
            // Another user's code is indistinguishable from an unknown one (no enumeration).
            if (!_sessions.TryGetValue(code, out var session) || session.UserId != userId) return new LidarPollResult(LidarPollStatus.NotFound);
            var expired = now >= session.ExpiresAt;
            if (session.Pending is { } scan)
            {
                session.Pending = null;
                return new LidarPollResult(LidarPollStatus.NewScan, scan, session.ExpiresAt, expired);
            }
            return new LidarPollResult(LidarPollStatus.Waiting, null, session.ExpiresAt, expired);
        }
    }

    public int Sweep()
    {
        lock (_gate) return SweepLocked(_clock.GetUtcNow());
    }

    private int SweepLocked(DateTimeOffset now)
    {
        var stale = _sessions.Values.Where(s => now >= s.RetainUntil).Select(s => s.Code).ToList();
        foreach (var code in stale) _sessions.Remove(code);
        return stale.Count;
    }

    public void Dispose() => _timer.Dispose();
}
