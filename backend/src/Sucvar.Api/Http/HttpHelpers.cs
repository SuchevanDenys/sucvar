using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Sucvar.Application;

namespace Sucvar.Api.Http;

/// <summary>Port of app/lib/server/http.ts: client IP, uniform JSON errors, 429 and body-size guard.</summary>
public static class HttpHelpers
{
    /// <summary>Uniform error shape: { error, code, ...extra }.</summary>
    public static IResult JsonError(int status, string code, string error, IDictionary<string, object?>? extra = null)
    {
        var body = new Dictionary<string, object?> { ["error"] = error, ["code"] = code };
        if (extra is not null) foreach (var (k, v) in extra) body[k] = v;
        return Results.Json(body, statusCode: status);
    }

    /// <summary>400 <c>INVALID_JSON</c>: the body could not be parsed as JSON (shared by every write endpoint).</summary>
    public static IResult InvalidJson() => JsonError(400, "INVALID_JSON", "Cerere invalidă (JSON incorect).");

    /// <summary>
    /// Last-chance mapping for an endpoint's <c>catch</c> block: an <see cref="AppException"/> is an expected business
    /// outcome and keeps its status/code; anything else is logged with the route and hidden behind a generic 500, so
    /// stack traces and SQL details never reach the client.
    /// </summary>
    public static IResult HandleError(Exception ex, ILogger logger, string route)
    {
        if (ex is AppException app) return JsonError(app.Status, app.Code, app.Message);
        logger.LogError(ex, "[SUCVAR] {Route}", route);
        return JsonError(500, "INTERNAL_ERROR", "Operația a eșuat. Încearcă din nou.");
    }

    /// <summary>Bilingual 429 with the standard Retry-After header.</summary>
    public static IResult TooManyRequests(HttpContext ctx, int retryAfterSeconds)
    {
        ctx.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
        return Results.Json(new Dictionary<string, object?>
        {
            ["code"] = "RATE_LIMITED",
            ["error"] = $"Prea multe cereri. Încearcă din nou în {retryAfterSeconds}s. / Too many requests. Please try again in {retryAfterSeconds}s.",
            ["retryAfter"] = retryAfterSeconds,
        }, statusCode: 429);
    }

    public static IResult PayloadTooLarge() => Results.Json(new Dictionary<string, object?>
    {
        ["code"] = "PAYLOAD_TOO_LARGE",
        ["error"] = "Cererea este prea mare. / Request payload too large.",
    }, statusCode: 413);

    /// <summary>
    /// Client IP used as the rate-limit key. Forwarding headers are honoured ONLY when the TCP peer is a
    /// trusted proxy (<see cref="ProxyOptions"/>): otherwise any caller could send a fake
    /// <c>X-Forwarded-For</c> on every request and get a fresh rate-limit bucket each time.
    /// With trusted proxies the chain is walked right-to-left and the first untrusted hop is the client.
    /// </summary>
    public static string ClientIp(HttpContext ctx)
    {
        var options = ctx.RequestServices.GetService<Microsoft.Extensions.Options.IOptions<ProxyOptions>>()?.Value ?? new ProxyOptions();
        var remote = ctx.Connection.RemoteIpAddress;
        var remoteText = remote is null ? "unknown" : (remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote).ToString();

        var hops = ctx.Request.Headers["x-forwarded-for"].ToString()
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (options.TrustAllForwarders)
        {
            // Development / tests behind a single local proxy: legacy behaviour of the monolith.
            if (hops.Length > 0) return hops[0];
            var real = ctx.Request.Headers["x-real-ip"].ToString();
            return real.Length > 0 ? real : remoteText;
        }

        if (!options.IsTrusted(remoteText)) return remoteText;
        for (var i = hops.Length - 1; i >= 0; i--)
        {
            if (!options.IsTrusted(hops[i])) return hops[i];
        }
        return hops.Length > 0 ? hops[0] : remoteText;
    }

    public static string BearerToken(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        return header.StartsWith("bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : "";
    }

    /// <summary>
    /// Reads the body as UTF-8 text with a hard cap: declared Content-Length first (cheap reject),
    /// then the real length (Content-Length may be missing or lie). Returns null text + 413 result when too large.
    /// </summary>
    public static async Task<(string? Text, IResult? Error)> ReadBodyTextAsync(HttpContext ctx, int maxBytes)
    {
        var declared = ctx.Request.ContentLength;
        if (declared is { } d && d > maxBytes) return (null, PayloadTooLarge());

        var sizeFeature = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (sizeFeature is { IsReadOnly: false }) sizeFeature.MaxRequestBodySize = maxBytes + 1L;

        try
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[16 * 1024];
            int read;
            while ((read = await ctx.Request.Body.ReadAsync(chunk, ctx.RequestAborted)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > maxBytes) return (null, PayloadTooLarge());
            }
            return (Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length), null);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return (null, PayloadTooLarge());
        }
    }

    /// <summary>JSON.parse equivalent: null element when the text is not valid JSON.</summary>
    public static bool TryParseJson(string text, out JsonElement element)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            element = doc.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            element = default;
            return false;
        }
    }
}
