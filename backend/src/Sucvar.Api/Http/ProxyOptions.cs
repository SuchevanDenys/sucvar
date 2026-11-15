using System.Net;

namespace Sucvar.Api.Http;

/// <summary>
/// Reverse proxies whose X-Forwarded-For / X-Real-IP headers may be trusted
/// (config section "Proxy"). Empty list = the API is exposed directly, headers are ignored.
/// </summary>
public sealed class ProxyOptions
{
    /// <summary>Comma-separated IPs or CIDR ranges, e.g. "10.0.0.0/8,172.16.0.0/12,127.0.0.1".</summary>
    public string KnownProxies { get; set; } = "";

    /// <summary>Trust the first X-Forwarded-For entry from anyone. Only for local development and tests.</summary>
    public bool TrustAllForwarders { get; set; }

    private IPNetwork[]? _parsed;

    /// <summary>Valid entries only; a bare IP is a /32 (or /128) network. Invalid entries are ignored.</summary>
    private IPNetwork[] Parsed => _parsed ??= KnownProxies
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(entry => entry.Contains('/')
            ? (IPNetwork.TryParse(entry, out var net) ? net : (IPNetwork?)null)
            : IPAddress.TryParse(entry, out var ip) ? new IPNetwork(ip, ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128) : null)
        .OfType<IPNetwork>()
        .ToArray();

    public bool IsTrusted(string address)
    {
        if (!IPAddress.TryParse(address, out var ip)) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        return Parsed.Any(n => n.Contains(ip));
    }
}
