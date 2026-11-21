using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Sucvar.Application;
using Sucvar.Domain.Ai;

namespace Sucvar.Infrastructure.Ai;

/// <summary>
/// Stage 1 of the precision pipeline: a vision-language model on Replicate (default <see cref="AiOptions.DefaultVisionModel"/>)
/// asked for JSON bounding boxes of outlets, switches, radiators, doors, windows and structural corners.
/// </summary>
/// <remarks>
/// Strictly best effort. The whole call (upload, sync wait, polling) runs under <see cref="AiOptions.VisionTimeoutMs"/>
/// (≤ 6 s); a timeout, an HTTP / model error or an unparsable answer is logged and returns an empty list, so the render
/// always proceeds. The photo is sent EXIF-upright and downscaled (≤ <see cref="AiOptions.VisionMaxSide"/> px), which is
/// the same frame the result and the pixel shield use; normalised coordinates are independent of that size.
/// </remarks>
public sealed partial class ReplicateRoomFixtureDetector(IHttpClientFactory http, IOptions<AiOptions> options, ILogger<ReplicateRoomFixtureDetector> logger)
    : IRoomFixtureDetector
{
    public const int MaxTimeoutMs = 6000, MinTimeoutMs = 100;

    private string Token => AiOptions.Clean(options.Value.ReplicateApiToken);
    private string Model => AiOptions.Clean(options.Value.VisionModel);
    private TimeSpan Timeout => TimeSpan.FromMilliseconds(Math.Clamp(options.Value.VisionTimeoutMs, MinTimeoutMs, MaxTimeoutMs));

    public bool IsConfigured => options.Value.VisionEnabled && Token.Length > 0 && Token != "demo" && ModelRefRegex().IsMatch(Model);

    /// <summary>
    /// The create-prediction call for <paramref name="imageDataUrl"/>: <c>owner/name</c> → the official-model endpoint,
    /// <c>owner/name:version</c> → the versioned endpoint (public for tests).
    /// </summary>
    public (string Url, JsonObject Body) BuildCreateRequest(string imageDataUrl)
    {
        var input = new JsonObject
        {
            ["image"] = imageDataUrl,
            ["prompt"] = RoomFixtures.DetectionPrompt,
            ["max_new_tokens"] = 1024,
            ["temperature"] = 0.1,
        };
        var model = Model;
        var colon = model.IndexOf(':');
        return colon < 0
            ? ($"v1/models/{model}/predictions", new JsonObject { ["input"] = input })
            : ("v1/predictions", new JsonObject { ["version"] = model[(colon + 1)..], ["input"] = input });
    }

    public async Task<IReadOnlyList<DetectedFixture>> DetectAsync(string imageDataUrl, CancellationToken ct = default)
    {
        if (!IsConfigured) return [];
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Timeout);
        HttpClient? client = null;
        JsonNode? prediction = null;
        try
        {
            var (upright, width, height) = PrepareImage(imageDataUrl, Math.Clamp(options.Value.VisionMaxSide, 256, 1536));
            client = http.CreateClient(HttpClientNames.Replicate);
            var (url, body) = BuildCreateRequest(upright);
            using var create = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
            create.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            create.Headers.Add("Prefer", $"wait={Math.Max(1, (int)Timeout.TotalSeconds)}");
            using (var response = await client.SendAsync(create, cts.Token))
                prediction = await ReadPrediction(response, cts.Token);

            while (prediction["status"]?.GetValue<string>() is "starting" or "processing")
            {
                await Task.Delay(400, cts.Token);
                var getUrl = prediction["urls"]?["get"]?.GetValue<string>() ?? $"v1/predictions/{prediction["id"]?.GetValue<string>()}";
                using var poll = new HttpRequestMessage(HttpMethod.Get, getUrl);
                poll.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
                using var pollResponse = await client.SendAsync(poll, cts.Token);
                prediction = await ReadPrediction(pollResponse, cts.Token);
            }

            if (prediction["status"]?.GetValue<string>() != "succeeded")
            {
                logger.LogWarning("[SUCVAR] Vision detector prediction {Status}: {Error}", prediction["status"], prediction["error"]?.ToJsonString());
                return [];
            }
            var fixtures = RoomFixtures.Parse(OutputText(prediction["output"]), width, height);
            logger.LogInformation("[SUCVAR] Vision detector: {Count} fixtures", fixtures.Count);
            return fixtures;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            CancelInBackground(client, prediction);
            throw; // the browser went away: the whole request stops
        }
        catch (OperationCanceledException)
        {
            logger.LogWarning("[SUCVAR] Vision detector exceeded {Timeout} ms; generating without fixture anchors", Timeout.TotalMilliseconds);
            CancelInBackground(client, prediction);
            return [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[SUCVAR] Vision detector failed; generating without fixture anchors");
            CancelInBackground(client, prediction);
            return [];
        }
    }

    /// <summary>LLM outputs on Replicate are a string, a token array (joined) or an object with <c>text</c> / <c>output</c>.</summary>
    public static string? OutputText(JsonNode? output) => output switch
    {
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonArray a => string.Concat(a.Select(OutputText)),
        JsonObject o => OutputText(o["text"] ?? o["output"] ?? o["content"]),
        _ => null,
    };

    /// <summary>EXIF-upright JPEG data URL, longest side ≤ <paramref name="maxSide"/>, plus its pixel size.</summary>
    public static (string DataUrl, int Width, int Height) PrepareImage(string dataUrl, int maxSide)
    {
        var bytes = Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]);
        int w, h;
        using (var codec = SKCodec.Create(new MemoryStream(bytes)) ?? throw new InvalidDataException("unreadable image"))
            (w, h) = MaskCompositor.OrientedSize(codec.EncodedOrigin, codec.Info.Width, codec.Info.Height);
        var scale = Math.Min(1d, (double)maxSide / Math.Max(w, h));
        var outW = Math.Max(1, (int)Math.Round(w * scale));
        var outH = Math.Max(1, (int)Math.Round(h * scale));
        using var bitmap = MaskCompositor.RenderUpright(bytes, outW, outH, cover: false, SKColors.White, new SKSamplingOptions(SKCubicResampler.Mitchell));
        using var image = SKImage.FromBitmap(bitmap);
        using var jpeg = image.Encode(SKEncodedImageFormat.Jpeg, 85);
        return ($"data:image/jpeg;base64,{Convert.ToBase64String(jpeg.AsSpan())}", outW, outH);
    }

    private static async Task<JsonNode> ReadPrediction(HttpResponseMessage response, CancellationToken ct)
    {
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Replicate {(int)response.StatusCode}: {text[..Math.Min(200, text.Length)]}");
        return JsonNode.Parse(text) ?? throw new InvalidOperationException("Replicate: empty response");
    }

    /// <summary>Fire-and-forget cancel of a prediction nobody waits for anymore (never delays the render).</summary>
    private void CancelInBackground(HttpClient? client, JsonNode? prediction)
    {
        if (client is null || prediction?["id"]?.GetValue<string>() is not { } id) return;
        if (prediction["status"]?.GetValue<string>() is not ("starting" or "processing")) return;
        var cancelUrl = prediction["urls"]?["cancel"]?.GetValue<string>() ?? $"v1/predictions/{id}/cancel";
        _ = Task.Run(async () =>
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                using var cancel = new HttpRequestMessage(HttpMethod.Post, cancelUrl) { Content = new StringContent("", Encoding.UTF8) };
                cancel.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
                using var _ = await client.SendAsync(cancel, cts.Token);
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "[SUCVAR] Vision prediction cancel failed");
            }
        });
    }

    /// <summary><c>owner/name</c> or <c>owner/name:version</c> — never an arbitrary string in the URL path.</summary>
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*(:[a-f0-9]{16,128})?$")]
    private static partial Regex ModelRefRegex();
}
