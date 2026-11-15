using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Sucvar.Application;

namespace Sucvar.Infrastructure.Ai;

/// <summary>AI configuration (same variables as the monolith's .env.local).</summary>
public sealed class AiOptions
{
    /// <summary>AI_PROVIDER: stable-diffusion | replicate | demo (empty = automatic).</summary>
    public string? Provider { get; set; }
    public string? ReplicateApiToken { get; set; }
    public string ReplicateModelVersion { get; set; } = "76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38";
    public string? SdApiUrl { get; set; }
    public string? SdApiKey { get; set; }
    public int SdMaxSide { get; set; } = 768;
    public string? SdSampler { get; set; }
    public int SdTimeoutMs { get; set; } = 55_000;
    public string? SdControlNetModel { get; set; }
    public string? SdControlNetModule { get; set; }
    /// <summary>
    /// Total time budget for one AI call (seconds). Must stay below the browser's abort (120 s in
    /// generate/page.tsx) minus the JPEG conversion, so the client never gives up on a render that
    /// will still be billed.
    /// </summary>
    public int GenerationBudgetSeconds { get; set; } = 80;
    /// <summary>Demo delay (route: 2 s). Tests set 0.</summary>
    public int DemoDelayMs { get; set; } = 2000;

    internal static string Clean(string? v) => (v ?? "").Trim().Trim('"', '\'');
}

public static class HttpClientNames
{
    public const string Replicate = "replicate";
    public const string StableDiffusion = "stable-diffusion";
    public const string ImageDownload = "image-download";
}

/// <summary>Demo provider: fixed Unsplash image per mode, no AI call.</summary>
public sealed class DemoImageProvider(IOptions<AiOptions> options) : IImageProvider
{
    public static readonly IReadOnlyDictionary<string, string> Images = new Dictionary<string, string>
    {
        ["interiors"] = "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=85",
        ["exteriors"] = "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=85",
        ["gardens"] = "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=1400&q=85",
    };

    public string Id => "demo";
    public bool IsConfigured => true;

    public async Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
    {
        if (options.Value.DemoDelayMs > 0) await Task.Delay(options.Value.DemoDelayMs, ct);
        return new ImageGenerationResult(Images.GetValueOrDefault(request.Mode, Images["interiors"]), true);
    }
}

/// <summary>Replicate (adirik/interior-design) through the HTTP predictions API.</summary>
public sealed class ReplicateImageProvider(IHttpClientFactory http, IOptions<AiOptions> options, ILogger<ReplicateImageProvider> logger) : IImageProvider
{
    private string Token => AiOptions.Clean(options.Value.ReplicateApiToken);

    public string Id => "replicate";
    public bool IsConfigured => Token.Length > 0 && Token != "demo";

    public async Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
    {
        var client = http.CreateClient(HttpClientNames.Replicate);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);

        var input = new JsonObject
        {
            ["image"] = request.ImageDataUrl,
            ["prompt"] = request.Prompt,
            ["negative_prompt"] = request.NegativePrompt,
            ["num_inference_steps"] = request.InferenceSteps,
            ["guidance_scale"] = request.GuidanceScale,
            ["prompt_strength"] = request.PromptStrength,
        };
        if (request.Seed is { } seed) input["seed"] = seed;

        using var create = new HttpRequestMessage(HttpMethod.Post, "v1/predictions")
        {
            Content = JsonContent.Create(new JsonObject { ["version"] = options.Value.ReplicateModelVersion, ["input"] = input }),
        };
        // One budget for the whole call (sync wait + polling), so the API always answers before the browser aborts.
        var budget = Math.Clamp(options.Value.GenerationBudgetSeconds, 20, 110);
        var deadline = DateTimeOffset.UtcNow.AddSeconds(budget);
        create.Headers.Add("Prefer", $"wait={Math.Min(55, budget - 10)}");
        using var response = await client.SendAsync(create, ct);
        var prediction = await ReadPrediction(response, ct);

        while (prediction["status"]?.GetValue<string>() is "starting" or "processing")
        {
            if (DateTimeOffset.UtcNow >= deadline)
            {
                await CancelAsync(client, prediction);
                throw new TimeoutException($"Replicate nu a terminat în {budget}s.");
            }
            await Task.Delay(1000, ct);
            var getUrl = prediction["urls"]?["get"]?.GetValue<string>() ?? $"v1/predictions/{prediction["id"]?.GetValue<string>()}";
            using var poll = await client.GetAsync(getUrl, ct);
            prediction = await ReadPrediction(poll, ct);
        }

        var status = prediction["status"]?.GetValue<string>();
        if (status != "succeeded")
        {
            logger.LogError("[SUCVAR] Replicate prediction {Status}: {Error}", status, prediction["error"]?.ToJsonString());
            throw new InvalidOperationException($"Replicate prediction {status}");
        }
        var url = GetImageUrl(prediction["output"]) ?? throw new NoImageException();
        return new ImageGenerationResult(url, false);
    }

    /// <summary>Best effort: a prediction nobody will wait for anymore should not keep running (and billing).</summary>
    private async Task CancelAsync(HttpClient client, JsonNode prediction)
    {
        var cancelUrl = prediction["urls"]?["cancel"]?.GetValue<string>() ?? $"v1/predictions/{prediction["id"]?.GetValue<string>()}/cancel";
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var _ = await client.PostAsync(cancelUrl, null, cts.Token);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[SUCVAR] Anularea predicției Replicate a eșuat");
        }
    }

    private static async Task<JsonNode> ReadPrediction(HttpResponseMessage response, CancellationToken ct)
    {
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Replicate {(int)response.StatusCode}: {text[..Math.Min(200, text.Length)]}");
        return JsonNode.Parse(text) ?? throw new InvalidOperationException("Replicate: empty response");
    }

    /// <summary>Replicate output may be a string, an array or an object with `url`.</summary>
    public static string? GetImageUrl(JsonNode? output) => output switch
    {
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonArray a => a.Count > 0 ? GetImageUrl(a[0]) : null,
        JsonObject o when o["url"] is JsonValue u && u.TryGetValue<string>(out var s) => s,
        _ => null,
    };
}

/// <summary>Thrown when the model answers without an image (→ 502 AI_NO_IMAGE).</summary>
public sealed class NoImageException() : Exception("Modelul AI nu a returnat nicio imagine.");

/// <summary>Stable Diffusion (AUTOMATIC1111 img2img + optional ControlNet).</summary>
public sealed class StableDiffusionImageProvider(IHttpClientFactory http, IOptions<AiOptions> options) : IImageProvider
{
    private string BaseUrl => AiOptions.Clean(options.Value.SdApiUrl).TrimEnd('/');

    public string Id => "stable-diffusion";
    public bool IsConfigured => BaseUrl.Length > 0;

    private static string StripDataUrlPrefix(string dataUrl)
    {
        var comma = dataUrl.IndexOf(',');
        return dataUrl.StartsWith("data:") && comma != -1 ? dataUrl[(comma + 1)..] : dataUrl;
    }

    public async Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
    {
        var o = options.Value;
        var base64 = StripDataUrlPrefix(request.ImageDataUrl);
        var (width, height) = ComputeOutputSize(base64, o.SdMaxSide > 0 ? o.SdMaxSide : 768);

        var payload = new JsonObject
        {
            ["init_images"] = new JsonArray(base64),
            ["prompt"] = request.Prompt,
            ["negative_prompt"] = request.NegativePrompt,
            ["steps"] = request.InferenceSteps,
            ["cfg_scale"] = request.GuidanceScale,
            ["denoising_strength"] = request.TransformationStrength / 100,
            ["seed"] = request.Seed ?? -1,
            ["sampler_name"] = string.IsNullOrWhiteSpace(o.SdSampler) ? "DPM++ 2M Karras" : o.SdSampler.Trim(),
            ["width"] = width,
            ["height"] = height,
            ["batch_size"] = 1,
        };
        if (!string.IsNullOrWhiteSpace(o.SdControlNetModel))
        {
            payload["alwayson_scripts"] = new JsonObject
            {
                ["controlnet"] = new JsonObject
                {
                    ["args"] = new JsonArray(new JsonObject
                    {
                        ["image"] = base64,
                        ["module"] = string.IsNullOrWhiteSpace(o.SdControlNetModule) ? "mlsd" : o.SdControlNetModule.Trim(),
                        ["model"] = o.SdControlNetModel.Trim(),
                        ["weight"] = 1,
                    }),
                },
            };
        }

        var client = http.CreateClient(HttpClientNames.StableDiffusion);
        using var message = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/sdapi/v1/img2img") { Content = JsonContent.Create(payload) };
        if (!string.IsNullOrWhiteSpace(o.SdApiKey))
            message.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(o.SdApiKey.Trim())));

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Math.Min(o.SdTimeoutMs > 0 ? o.SdTimeoutMs : 55_000, Math.Clamp(o.GenerationBudgetSeconds, 20, 110) * 1000));
        try
        {
            using var response = await client.SendAsync(message, cts.Token);
            var text = await response.Content.ReadAsStringAsync(cts.Token);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"Serverul Stable Diffusion a răspuns {(int)response.StatusCode}. {text[..Math.Min(200, text.Length)]}");
            var first = JsonNode.Parse(text)?["images"]?[0]?.GetValue<string>();
            if (string.IsNullOrEmpty(first)) throw new NoImageException();
            return new ImageGenerationResult($"data:image/png;base64,{first}", false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException("Stable Diffusion nu a răspuns la timp. Încearcă mai puțini pași.");
        }
    }

    /// <summary>SD works in multiples of 8; keep the photo's aspect ratio (JPEG header read, like the TS version).</summary>
    private static (int Width, int Height) ComputeOutputSize(string base64, int maxSide)
    {
        int w = 4, h = 3;
        try
        {
            using var codec = SKCodec.Create(new MemoryStream(Convert.FromBase64String(base64)));
            if (codec is not null)
            {
                w = codec.Info.Width;
                h = codec.Info.Height;
            }
        }
        catch (Exception) { /* keep 4:3 */ }
        var scale = (double)maxSide / Math.Max(w, h);
        int ToMultipleOf8(int v) => Math.Max(64, (int)Math.Round(v * scale / 8, MidpointRounding.AwayFromZero) * 8);
        return (ToMultipleOf8(w), ToMultipleOf8(h));
    }
}

/// <summary>Port of selectProvider (app/lib/ai/providers/index.ts).</summary>
public sealed class ImageProviderSelector(
    IOptions<AiOptions> options,
    StableDiffusionImageProvider sd,
    ReplicateImageProvider replicate,
    DemoImageProvider demo) : IImageProviderSelector
{
    public (IImageProvider Provider, string? Warning) Select()
    {
        var requested = (options.Value.Provider ?? "").Trim().ToLowerInvariant();
        if (requested == "demo") return (demo, null);
        if (requested is "stable-diffusion" or "replicate")
        {
            IImageProvider chosen = requested == "stable-diffusion" ? sd : replicate;
            return chosen.IsConfigured
                ? (chosen, null)
                : (demo, $"AI_PROVIDER={requested}, dar variabilele de mediu lipsesc. Se folosește modul demo.");
        }
        if (sd.IsConfigured) return (sd, null);
        if (replicate.IsConfigured) return (replicate, null);
        return (demo, null);
    }
}

/// <summary>
/// SkiaSharp replacement of the `sharp` pipeline in /api/generate (MIT-licensed, native decoders).
/// </summary>
public sealed class SkiaImageProcessor(IHttpClientFactory http) : IImageProcessor
{
    public const int ResultMaxWidth = 1280;
    public const int ResultJpegQuality = 82;
    public const long MaxDownloadBytes = 20 * 1024 * 1024;

    public ImageInspection Inspect(byte[] data)
    {
        // SKCodec reads only the header: dimensions are known before any pixel is allocated,
        // which is what blocks "decompression bombs" (tiny file, gigantic resolution).
        using var codec = SKCodec.Create(new MemoryStream(data)) ?? throw new InvalidDataException("unreadable image");
        var format = codec.EncodedFormat switch
        {
            SKEncodedImageFormat.Jpeg => "jpeg",
            SKEncodedImageFormat.Png => "png",
            SKEncodedImageFormat.Webp => "webp",
            var other => other.ToString().ToLowerInvariant(),
        };
        return new ImageInspection(format, codec.Info.Width, codec.Info.Height);
    }

    public async Task<string> ToPermanentJpegDataUrlAsync(string source, CancellationToken ct = default)
    {
        byte[] input;
        if (source.StartsWith("data:image/"))
        {
            input = Convert.FromBase64String(source[(source.IndexOf(',') + 1)..]);
        }
        else
        {
            var client = http.CreateClient(HttpClientNames.ImageDownload);
            using var response = await client.GetAsync(source, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Download failed ({(int)response.StatusCode})");
            if (response.Content.Headers.ContentLength > MaxDownloadBytes) throw new InvalidOperationException("Generated image is too large");
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, ct)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > MaxDownloadBytes) throw new InvalidOperationException("Generated image is too large");
            }
            input = buffer.ToArray();
        }
        return EncodeJpegDataUrl(input);
    }

    public static string EncodeJpegDataUrl(byte[] input)
    {
        using var codec = SKCodec.Create(new MemoryStream(input)) ?? throw new InvalidDataException("unreadable image");
        using var decoded = SKBitmap.Decode(codec) ?? throw new InvalidDataException("decode failed");

        // 1. EXIF orientation (sharp .rotate())
        var origin = codec.EncodedOrigin;
        var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var srcW = swap ? decoded.Height : decoded.Width;
        var srcH = swap ? decoded.Width : decoded.Height;

        // 2. Max width 1280, never enlarge
        var scale = srcW > ResultMaxWidth ? (float)ResultMaxWidth / srcW : 1f;
        var outW = Math.Max(1, (int)Math.Round(srcW * scale));
        var outH = Math.Max(1, (int)Math.Round(srcH * scale));

        using var surface = SKSurface.Create(new SKImageInfo(outW, outH, SKColorType.Rgba8888, SKAlphaType.Premul));
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.White); // 3. flatten alpha on white (no black background in JPEG)
        canvas.Scale(scale);
        ApplyOrigin(canvas, origin, decoded.Width, decoded.Height);
        using var image = SKImage.FromBitmap(decoded);
        canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKCubicResampler.Mitchell));
        canvas.Flush();

        using var snapshot = surface.Snapshot();
        using var jpeg = snapshot.Encode(SKEncodedImageFormat.Jpeg, ResultJpegQuality);
        return $"data:image/jpeg;base64,{Convert.ToBase64String(jpeg.ToArray())}";
    }

    private static void ApplyOrigin(SKCanvas c, SKEncodedOrigin origin, int w, int h)
    {
        switch (origin)
        {
            case SKEncodedOrigin.TopRight: c.Translate(w, 0); c.Scale(-1, 1); break;
            case SKEncodedOrigin.BottomRight: c.Translate(w, h); c.RotateDegrees(180); break;
            case SKEncodedOrigin.BottomLeft: c.Translate(0, h); c.Scale(1, -1); break;
            case SKEncodedOrigin.LeftTop: c.RotateDegrees(90); c.Scale(1, -1); break;
            case SKEncodedOrigin.RightTop: c.Translate(h, 0); c.RotateDegrees(90); break;
            case SKEncodedOrigin.RightBottom: c.Translate(h, w); c.RotateDegrees(-90); c.Scale(1, -1); break;
            case SKEncodedOrigin.LeftBottom: c.Translate(0, w); c.RotateDegrees(-90); break;
        }
    }
}
