using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application.Lidar;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>
/// iPhone LiDAR / Apple RoomPlan live bridge:
///   • <c>POST /api/studio/lidar/pair</c> (Studio web user) → 6-digit code valid 15 min;
///   • <c>POST /api/studio/lidar/upload</c> (iOS companion app, the code is the credential) → JSON
///     <c>{ code, roomName?, scanJson }</c> or multipart <c>code</c> + <c>file</c> (.json / .obj / .zip / .usdz, ≤ 25 MB);
///   • <c>GET /api/studio/lidar/latest?code=</c> (Studio web user, polled) → the new scan once, then <c>hasNewScan: false</c>.
/// The payload is passed through untouched; the Studio parses it with <c>lidarParser.ts</c> (<c>parseScanFile</c>).
/// </summary>
public static class LidarBridgeEndpoints
{
    public const int MaxScanBytes = 25 * 1024 * 1024;
    /// <summary>JSON envelope: the scan plus <c>code</c> / <c>roomName</c> and escaping headroom.</summary>
    public const int MaxJsonBodyBytes = MaxScanBytes + 64 * 1024;
    private static readonly string[] TextExtensions = [".json", ".obj"];
    private static readonly string[] BinaryExtensions = [".zip", ".usdz"];

    public static IEndpointRouteBuilder MapLidarBridgeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/studio/lidar").WithTags("Studio LiDAR bridge");
        group.MapPost("/pair", Pair).WithName("LidarPair").RequireActiveAccount();
        group.MapPost("/upload", Upload).WithName("LidarUpload").AllowAnonymous().DisableAntiforgery();
        group.MapGet("/latest", Latest).WithName("LidarLatest");
        return app;
    }

    private static IResult Pair(HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config, ILidarBridgeService bridge, IConfiguration configuration)
    {
        var (user, authError) = RequestAuth.Require(ctx, config, "Autentifică-te pentru a asocia iPhone-ul.");
        if (authError is not null) return authError;
        if (limiter.Check(Rules.LidarPairUser, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);

        var pairing = bridge.Pair(user.UserId);
        var serverUrl = PublicServerUrl(ctx, configuration["Lidar:PublicBaseUrl"]);
        ctx.Response.Headers.CacheControl = "no-store";
        return Results.Json(new
        {
            code = pairing.Code,
            expiresAtUtc = pairing.ExpiresAtUtc,
            uploadUrl = $"{serverUrl}/api/studio/lidar/upload",
            serverUrl,
        });
    }

    private static IResult Latest(HttpContext ctx, string? code, FixedWindowRateLimitStore limiter, ServerConfig config, ILidarBridgeService bridge)
    {
        var (user, authError) = RequestAuth.Require(ctx, config);
        if (authError is not null) return authError;
        if (limiter.Check(Rules.LidarPollUser, user!.UserId) is { } wait) return TooManyRequests(ctx, wait);
        ctx.Response.Headers.CacheControl = "no-store";

        var result = bridge.Poll(user.UserId, code?.Trim() ?? "");
        return result.Status switch
        {
            LidarPollStatus.NotFound => CodeNotFound(),
            LidarPollStatus.Waiting => Results.Json(new { hasNewScan = false, expiresAtUtc = result.ExpiresAtUtc, codeExpired = result.CodeExpired }),
            _ => Results.Json(new
            {
                hasNewScan = true,
                scanId = result.Scan!.ScanId,
                fileName = result.Scan.FileName,
                contentType = result.Scan.ContentType,
                encoding = result.Scan.Encoding,
                rawPayload = result.Scan.RawPayload,
                sizeBytes = result.Scan.SizeBytes,
                uploadedAtUtc = result.Scan.UploadedAtUtc,
                expiresAtUtc = result.ExpiresAtUtc,
                codeExpired = result.CodeExpired,
            }),
        };
    }

    private sealed record Incoming(string Code, string FileName, string ContentType, string Encoding, string Payload, long Size);

    private static async Task<IResult> Upload(HttpContext ctx, FixedWindowRateLimitStore limiter, ILidarBridgeService bridge, ILogger<ILidarBridgeService> logger)
    {
        if (limiter.Check(Rules.LidarUploadIp, ClientIp(ctx)) is { } wait) return TooManyRequests(ctx, wait);

        var (incoming, error) = ctx.Request.HasFormContentType ? await ReadMultipartAsync(ctx) : await ReadJsonAsync(ctx);
        if (error is not null) return error;

        var status = bridge.Upload(incoming!.Code, incoming.FileName, incoming.ContentType, incoming.Encoding, incoming.Payload, incoming.Size, out var scan);
        return status switch
        {
            LidarUploadStatus.NotFound => CodeNotFound(),
            LidarUploadStatus.Expired => JsonError(401, "LIDAR_CODE_EXPIRED",
                "Codul de asociere a expirat. Generează un cod nou din SUCVAR Studio și reîncearcă."),
            _ => Accepted(scan!, logger),
        };
    }

    private static IResult Accepted(LidarScan scan, ILogger logger)
    {
        logger.LogInformation("[SUCVAR] LiDAR bridge scan {ScanId}: {FileName} ({Size} B)", scan.ScanId, scan.FileName, scan.SizeBytes);
        return Results.Json(new { scanId = scan.ScanId, message = "Scanare recepționată în SUCVAR Studio." });
    }

    private static IResult CodeNotFound() => JsonError(404, "LIDAR_CODE_NOT_FOUND",
        "Codul de asociere nu există. Verifică cele 6 cifre afișate în SUCVAR Studio.");

    private static IResult InvalidCodeFormat() => JsonError(400, "LIDAR_CODE_INVALID", "Codul de asociere trebuie să aibă exact 6 cifre.");

    private static async Task<(Incoming?, IResult?)> ReadJsonAsync(HttpContext ctx)
    {
        var (text, tooLarge) = await ReadBodyTextAsync(ctx, MaxJsonBodyBytes);
        if (tooLarge is not null) return (null, ScanTooLarge());
        if (!TryParseJson(text!, out var body) || body.ValueKind != JsonValueKind.Object) return (null, InvalidJson());

        var code = CodeFrom(body.TryGetProperty("code", out var c) ? c : default);
        if (!LidarBridgeService.IsValidCodeFormat(code)) return (null, InvalidCodeFormat());

        if (!body.TryGetProperty("scanJson", out var scanJson)) return (null, MissingScan());
        string raw;
        if (scanJson.ValueKind == JsonValueKind.Object) raw = scanJson.GetRawText();
        else if (scanJson.ValueKind == JsonValueKind.String)
        {
            raw = scanJson.GetString()!;
            if (!TryParseJson(raw, out var inner) || inner.ValueKind != JsonValueKind.Object) return (null, InvalidScanJson());
        }
        else return (null, MissingScan());

        var size = Encoding.UTF8.GetByteCount(raw);
        if (size > MaxScanBytes) return (null, ScanTooLarge());
        var roomName = body.TryGetProperty("roomName", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() : null;
        var fileName = SafeFileName(roomName, ".json");
        return (new Incoming(code!, fileName, "application/json", "utf8", raw, size), null);
    }

    private static async Task<(Incoming?, IResult?)> ReadMultipartAsync(HttpContext ctx)
    {
        if (ctx.Request.ContentLength is { } declared && declared > MaxJsonBodyBytes) return (null, ScanTooLarge());
        if (ctx.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } sizeFeature) sizeFeature.MaxRequestBodySize = MaxJsonBodyBytes;

        IFormCollection form;
        try
        {
            form = await ctx.Request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = MaxJsonBodyBytes }, ctx.RequestAborted);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return (null, ScanTooLarge());
        }
        catch (InvalidDataException)
        {
            return (null, JsonError(400, "INVALID_FORM", "Formular multipart invalid."));
        }

        var code = form["code"].ToString().Trim();
        if (!LidarBridgeService.IsValidCodeFormat(code)) return (null, InvalidCodeFormat());

        var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
        if (file is null || file.Length == 0) return (null, MissingScan());
        if (file.Length > MaxScanBytes) return (null, ScanTooLarge());

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        var isText = TextExtensions.Contains(ext);
        if (!isText && !BinaryExtensions.Contains(ext))
            return (null, JsonError(415, "LIDAR_FORMAT", "Format neacceptat. Trimite un fișier RoomPlan .json, .obj, .zip sau .usdz."));

        var bytes = new byte[file.Length];
        await using (var stream = file.OpenReadStream()) await stream.ReadExactlyAsync(bytes, ctx.RequestAborted);

        var roomName = form["roomName"].ToString();
        var fileName = SafeFileName(roomName.Length > 0 ? roomName : Path.GetFileNameWithoutExtension(file.FileName), ext);
        if (isText)
        {
            var text = Encoding.UTF8.GetString(bytes);
            if (ext == ".json" && (!TryParseJson(text, out var json) || json.ValueKind != JsonValueKind.Object)) return (null, InvalidScanJson());
            var type = ext == ".json" ? "application/json" : "model/obj";
            return (new Incoming(code, fileName, type, "utf8", text, bytes.Length), null);
        }
        if (bytes.Length < 4 || bytes[0] != (byte)'P' || bytes[1] != (byte)'K')
            return (null, JsonError(415, "LIDAR_FORMAT", "Arhiva trimisă nu este un fișier ZIP / USDZ valid."));
        var zipType = ext == ".usdz" ? "model/vnd.usdz+zip" : "application/zip";
        return (new Incoming(code, fileName, zipType, "base64", Convert.ToBase64String(bytes), bytes.Length), null);
    }

    private static string? CodeFrom(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString()?.Trim(),
        // An app may send the code as a number: 4829 → "004829"
        JsonValueKind.Number when e.TryGetInt32(out var n) && n is >= 0 and < 1_000_000 => n.ToString("D6"),
        _ => null,
    };

    /// <summary>A display-safe base name (letters, digits, space, - _ .), at most 80 characters, plus the extension.</summary>
    public static string SafeFileName(string? name, string extension)
    {
        var cleaned = new string((name ?? "").Where(ch => char.IsLetterOrDigit(ch) || ch is ' ' or '-' or '_' or '.').ToArray()).Trim(' ', '.');
        if (cleaned.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) cleaned = cleaned[..^extension.Length].TrimEnd(' ', '.');
        if (cleaned.Length == 0) cleaned = "roomplan-iphone";
        if (cleaned.Length > 80) cleaned = cleaned[..80];
        return cleaned + extension;
    }

    private static IResult MissingScan() => JsonError(400, "LIDAR_SCAN_REQUIRED",
        "Lipsește scanarea: trimite `scanJson` (JSON) sau un fișier `file` (.json / .obj / .zip / .usdz).");

    private static IResult InvalidScanJson() => JsonError(400, "LIDAR_SCAN_INVALID", "Scanarea RoomPlan trebuie să fie un obiect JSON valid (CapturedRoom).");

    private static IResult ScanTooLarge() => JsonError(413, "LIDAR_SCAN_TOO_LARGE", "Scanarea depășește limita de 25 MB.");

    /// <summary>
    /// Base URL the phone can reach: <c>Lidar:PublicBaseUrl</c> when configured; otherwise the request's own origin, with a
    /// loopback host (<c>localhost</c>, which the iPhone cannot reach) replaced by this machine's private LAN IPv4.
    /// </summary>
    public static string PublicServerUrl(HttpContext ctx, string? configured)
    {
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');
        var host = ctx.Request.Host;
        var name = host.Host;
        var loopback = name.Equals("localhost", StringComparison.OrdinalIgnoreCase) || (IPAddress.TryParse(name, out var ip) && IPAddress.IsLoopback(ip));
        if (loopback && LanIPv4() is { } lan) name = lan;
        return $"{ctx.Request.Scheme}://{name}{(host.Port is { } port ? $":{port}" : "")}";
    }

    private static string? LanIPv4()
    {
        try
        {
            var candidates = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                .Select(a => a.Address)
                .Where(a => a.AddressFamily == AddressFamily.InterNetwork && IsPrivate(a))
                .ToList();
            // Home Wi-Fi first (192.168/16), then 10/8 and 172.16/12
            return (candidates.FirstOrDefault(a => a.GetAddressBytes()[0] == 192) ?? candidates.FirstOrDefault())?.ToString();
        }
        catch (NetworkInformationException)
        {
            return null;
        }
    }

    private static bool IsPrivate(IPAddress a)
    {
        var b = a.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168);
    }
}
