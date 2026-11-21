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
    /// <summary>
    /// Official Replicate model (<c>owner/name</c>), called through <c>POST v1/models/{owner}/{name}/predictions</c>
    /// with the FLUX Kontext input schema and a natural-language instruction. Empty ⇒ the versioned
    /// <see cref="ReplicateModelVersion"/> path (SD 1.5 CLIP prompt).
    /// </summary>
    public string? ReplicateModel { get; set; } = DefaultReplicateModel;
    /// <summary>Community model version hash (adirik/interior-design), used only when <see cref="ReplicateModel"/> is empty.</summary>
    public string ReplicateModelVersion { get; set; } = "76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38";
    public const string DefaultReplicateModel = "black-forest-labs/flux-kontext-pro";
    /// <summary>
    /// Official Replicate inpainting model for "Edit selected area" requests (<c>image</c> + <c>mask</c> + <c>prompt</c>,
    /// white = repaint). Empty ⇒ masked requests fall back to <see cref="ReplicateModel"/> (or the versioned model)
    /// with a regional instruction; the API's feathered composite still keeps every unselected pixel original.
    /// </summary>
    public string? ReplicateInpaintModel { get; set; } = DefaultReplicateInpaintModel;
    public const string DefaultReplicateInpaintModel = "black-forest-labs/flux-fill-pro";
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
    /// <summary>
    /// Stage-1 vision detector (outlets, switches, radiators, doors, windows, corners) run before a structure-preserving
    /// render, with the same <see cref="ReplicateApiToken"/>. False = generation without fixture anchors / pixel shield.
    /// </summary>
    public bool VisionEnabled { get; set; } = true;
    /// <summary>Replicate vision-language model: <c>owner/name</c> (official endpoint) or <c>owner/name:version</c>.</summary>
    public string? VisionModel { get; set; } = DefaultVisionModel;
    public const string DefaultVisionModel = "qwen/qwen2.5-vl-72b-instruct";
    /// <summary>Hard budget for the whole detection call (clamped to 0.1–6 s); past it the render proceeds without it.</summary>
    public int VisionTimeoutMs { get; set; } = 6000;
    /// <summary>Longest side (px) of the photo sent to the vision model.</summary>
    public int VisionMaxSide { get; set; } = 768;
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

/// <summary>
/// Replicate through the HTTP predictions API: an official model (default <c>black-forest-labs/flux-kontext-pro</c>,
/// natural-language instruction) or, when <c>Ai:ReplicateModel</c> is empty, the versioned community model
/// <c>adirik/interior-design</c> (SD 1.5 + ControlNet, CLIP prompt).
/// </summary>
public sealed partial class ReplicateImageProvider(IHttpClientFactory http, IOptions<AiOptions> options, ILogger<ReplicateImageProvider> logger) : IImageProvider
{
    private string Token => AiOptions.Clean(options.Value.ReplicateApiToken);
    /// <summary>The configured official model (<c>owner/name</c>), or null for the versioned path.</summary>
    private string? Model => AiOptions.Clean(options.Value.ReplicateModel) is { Length: > 0 } m ? m : null;

    public string Id => "replicate";
    public bool IsConfigured => Token.Length > 0 && Token != "demo";
    public Sucvar.Domain.Ai.PromptFormat PromptFormat => Model is null ? Sucvar.Domain.Ai.PromptFormat.Clip : Sucvar.Domain.Ai.PromptFormat.Instruction;
    public const string LegacyModelId = "adirik/interior-design";
    public string ModelId => Model ?? LegacyModelId;
    /// <summary>The configured inpainting model (<c>owner/name</c>), or null = masked requests use the main model.</summary>
    private string? InpaintModel => AiOptions.Clean(options.Value.ReplicateInpaintModel) is { Length: > 0 } m ? m : null;
    public Sucvar.Domain.Ai.PromptFormat PromptFormatFor(bool masked) =>
        masked && InpaintModel is not null ? Sucvar.Domain.Ai.PromptFormat.Instruction : PromptFormat;
    public string ModelIdFor(bool masked) => masked && InpaintModel is { } inpaint ? inpaint : ModelId;

    /// <summary>Builds the create-prediction call: relative URL + JSON body (public for tests).</summary>
    public (string Url, JsonObject Body) BuildCreateRequest(ImageGenerationRequest request)
    {
        if (request.MaskDataUrl is { } mask && InpaintModel is { } inpaint)
        {
            if (!ModelNameRegex().IsMatch(inpaint)) throw new InvalidOperationException($"Ai:ReplicateInpaintModel invalid: expected owner/name, got '{inpaint}'.");
            // FLUX Fill schema: white mask pixels are repainted from the prompt, black ones are kept
            var fill = new JsonObject
            {
                ["image"] = request.ImageDataUrl,
                ["mask"] = mask,
                ["prompt"] = request.Prompt,
                ["output_format"] = "jpg",
            };
            if (request.Seed is { } fillSeed) fill["seed"] = fillSeed;
            return ($"v1/models/{inpaint}/predictions", new JsonObject { ["input"] = fill });
        }

        if (Model is { } model)
        {
            // Never interpolate an arbitrary string into the URL path
            if (!ModelNameRegex().IsMatch(model)) throw new InvalidOperationException($"Ai:ReplicateModel invalid: expected owner/name, got '{model}'.");
            // FLUX Kontext schema: the instruction says what to keep, so no negative prompt / strength / CFG / steps
            var kontext = new JsonObject
            {
                ["prompt"] = request.Prompt,
                ["input_image"] = request.ImageDataUrl,
                // Never crop or stretch the frame: a resized canvas shifts door and window edges
                ["aspect_ratio"] = "match_input_image",
                ["output_format"] = "jpg",
                // Upsampling rewrites the instruction and dilutes the structural lock (doors / windows never covered)
                ["prompt_upsampling"] = false,
            };
            if (request.Seed is { } kontextSeed) kontext["seed"] = kontextSeed;
            return ($"v1/models/{model}/predictions", new JsonObject { ["input"] = kontext });
        }

        var input = new JsonObject
        {
            ["image"] = request.ImageDataUrl,
            ["prompt"] = request.Prompt,
            ["negative_prompt"] = request.NegativePrompt,
            ["num_inference_steps"] = request.InferenceSteps,
            ["guidance_scale"] = request.GuidanceScale,
            // Structure lock: conservative band (0.55–0.68) so the model cannot redraw openings
            ["prompt_strength"] = request.MaskDataUrl is not null ? request.PromptStrength
                : request.Is3dScanSource ? Sucvar.Domain.Ai.ArchitecturalPromptCompiler.ScanSynthesisStrength(request.PromptStrength)
                : Sucvar.Domain.Ai.ArchitecturalPromptCompiler.StructureLockedStrength(request.PromptStrength, request.PreserveStructure),
        };
        if (request.Seed is { } seed) input["seed"] = seed;
        return ("v1/predictions", new JsonObject { ["version"] = AiOptions.Clean(options.Value.ReplicateModelVersion), ["input"] = input });
    }

    public async Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
    {
        var client = http.CreateClient(HttpClientNames.Replicate);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);

        var (createUrl, body) = BuildCreateRequest(request);
        using var create = new HttpRequestMessage(HttpMethod.Post, createUrl) { Content = JsonContent.Create(body) };
        // One budget for the whole call (sync wait + polling), so the API always answers before the browser aborts.
        var budget = Math.Clamp(options.Value.GenerationBudgetSeconds, 20, 110);
        var deadline = DateTimeOffset.UtcNow.AddSeconds(budget);
        create.Headers.Add("Prefer", $"wait={Math.Min(55, budget - 10)}");
        using var response = await client.SendAsync(create, ct);
        var prediction = await ReadPrediction(response, ct);

        try
        {
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
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The browser went away: stop the still-running prediction instead of letting it run (and bill) unseen.
            await CancelAsync(client, prediction);
            throw;
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

    [System.Text.RegularExpressions.GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")]
    private static partial System.Text.RegularExpressions.Regex ModelNameRegex();
}

/// <summary>Thrown when the model answers without an image (→ 502 AI_NO_IMAGE).</summary>
public sealed class NoImageException() : Exception("Modelul AI nu a returnat nicio imagine.");

/// <summary>Stable Diffusion (AUTOMATIC1111 img2img + optional ControlNet).</summary>
public sealed class StableDiffusionImageProvider(IHttpClientFactory http, IOptions<AiOptions> options) : IImageProvider
{
    private string BaseUrl => AiOptions.Clean(options.Value.SdApiUrl).TrimEnd('/');

    public string Id => "stable-diffusion";
    public bool IsConfigured => BaseUrl.Length > 0;
    /// <summary>Feather (px) AUTOMATIC1111 applies to the inpainting mask edge.</summary>
    public const int InpaintMaskBlur = 8;

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
            ["denoising_strength"] = request.MaskDataUrl is not null ? request.TransformationStrength / 100
                : request.Is3dScanSource ? Sucvar.Domain.Ai.ArchitecturalPromptCompiler.ScanSynthesisStrength(request.TransformationStrength / 100)
                : Sucvar.Domain.Ai.ArchitecturalPromptCompiler.StructureLockedStrength(request.TransformationStrength / 100, request.PreserveStructure),
            ["seed"] = request.Seed ?? -1,
            ["sampler_name"] = string.IsNullOrWhiteSpace(o.SdSampler) ? "DPM++ 2M Karras" : o.SdSampler.Trim(),
            ["width"] = width,
            ["height"] = height,
            ["batch_size"] = 1,
        };
        if (request.MaskDataUrl is { } mask)
        {
            // img2img inpainting: only the white area is denoised; "original" fill keeps the source colours as a start
            payload["mask"] = StripDataUrlPrefix(mask);
            payload["mask_blur"] = InpaintMaskBlur;
            payload["inpainting_fill"] = 1;
            payload["inpainting_mask_invert"] = 0;
            payload["inpaint_full_res"] = false;
        }
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
                        // Structure lock: full-strength line conditioning for the whole schedule keeps walls, windows
                        // and camera fixed; a redesign loosens it so the layout can move.
                        ["weight"] = request.PreserveStructure ? 1.0 : 0.55,
                        ["guidance_start"] = 0.0,
                        ["guidance_end"] = request.PreserveStructure ? 1.0 : 0.7,
                        ["pixel_perfect"] = true,
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

    public async Task<string> ToPermanentJpegDataUrlAsync(string source, CancellationToken ct = default) =>
        EncodeJpegDataUrl(await ReadSourceAsync(source, ct));

    // ── "Edit selected area" ────────────────────────────────────────────────────

    public const int MinMaskSide = 16, MaxMaskSide = 8192;
    public const long MaxMaskPixels = 40_000_000;
    /// <summary>A selection must cover at least 0.1 % of the photo (a stray click is not a selection).</summary>
    public const double MinMaskCoverage = 0.001;
    /// <summary>Tolerated aspect-ratio difference between mask and photo (rounding of canvas sizes).</summary>
    public const double MaskAspectTolerance = 0.03;

    public PreparedMask PrepareMask(string maskDataUrl, string sourceDataUrl)
    {
        var source = DecodeDataUrl(sourceDataUrl);
        int sourceW, sourceH;
        using (var codec = SKCodec.Create(new MemoryStream(source)) ?? throw new InvalidDataException("unreadable source"))
            (sourceW, sourceH) = MaskCompositor.OrientedSize(codec.EncodedOrigin, codec.Info.Width, codec.Info.Height);

        // Header first: format + size before any pixel is allocated (decompression bombs)
        var maskBytes = DecodeDataUrl(maskDataUrl);
        var meta = Inspect(maskBytes);
        if (meta.Format is not ("png" or "webp")) throw new InvalidDataException("mask format");
        if (Math.Min(meta.Width, meta.Height) < MinMaskSide || Math.Max(meta.Width, meta.Height) > MaxMaskSide ||
            (long)meta.Width * meta.Height > MaxMaskPixels)
            throw new MaskRejectedException("MASK_DIMENSIONS", "Masca selecției are dimensiuni invalide.");
        var sourceAspect = (double)sourceW / sourceH;
        if (Math.Abs((double)meta.Width / meta.Height - sourceAspect) / sourceAspect > MaskAspectTolerance)
            throw new MaskRejectedException("MASK_DIMENSIONS", "Masca selecției nu are proporțiile fotografiei. Reîncarcă fotografia și selectează din nou zona.");

        // Resize / align to the exact source pixels and binarize (over black: transparent = keep)
        using var rendered = MaskCompositor.RenderUpright(maskBytes, sourceW, sourceH, cover: false, SKColors.Black,
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        var binary = MaskCompositor.Binarize(rendered);
        var region = MaskCompositor.Measure(binary, sourceW, sourceH);
        if (region is null || region.Coverage < MinMaskCoverage)
            throw new MaskRejectedException("MASK_EMPTY", "Selecția este goală — pictează peste zona pe care vrei să o modifici.");

        using var clean = MaskCompositor.ToBitmap(binary, sourceW, sourceH);
        using var cleanImage = SKImage.FromBitmap(clean);
        using var png = cleanImage.Encode(SKEncodedImageFormat.Png, 100);
        return new PreparedMask($"data:image/png;base64,{Convert.ToBase64String(png.AsSpan())}", sourceW, sourceH, region);
    }

    public async Task<string> CompositeRegionAsync(string sourceDataUrl, string generatedSource, string maskDataUrl, CancellationToken ct = default)
    {
        var generated = await ReadSourceAsync(generatedSource, ct);
        return CompositeJpegDataUrl(DecodeDataUrl(sourceDataUrl), generated, DecodeDataUrl(maskDataUrl));
    }

    /// <summary>
    /// Feathered composite at the permanent-result size (≤ 1280 px wide): source and mask upright, the generated image
    /// covered onto the same frame, then <see cref="MaskCompositor"/> — unselected pixels are the original's.
    /// </summary>
    public static string CompositeJpegDataUrl(byte[] source, byte[] generated, byte[] mask)
    {
        int srcW, srcH;
        using (var codec = SKCodec.Create(new MemoryStream(source)) ?? throw new InvalidDataException("unreadable source"))
            (srcW, srcH) = MaskCompositor.OrientedSize(codec.EncodedOrigin, codec.Info.Width, codec.Info.Height);
        var scale = srcW > ResultMaxWidth ? (double)ResultMaxWidth / srcW : 1d;
        var outW = Math.Max(1, (int)Math.Round(srcW * scale));
        var outH = Math.Max(1, (int)Math.Round(srcH * scale));

        var photo = new SKSamplingOptions(SKCubicResampler.Mitchell);
        using var original = MaskCompositor.RenderUpright(source, outW, outH, cover: false, SKColors.White, photo);
        using var result = MaskCompositor.RenderUpright(generated, outW, outH, cover: true, SKColors.White, photo);
        using var maskBitmap = MaskCompositor.RenderUpright(mask, outW, outH, cover: false, SKColors.Black,
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        var binary = MaskCompositor.Binarize(maskBitmap);
        var alpha = MaskCompositor.FeatherAlpha(binary, outW, outH, MaskCompositor.FeatherRadius(outW, outH));
        using var composite = MaskCompositor.Composite(original, result, alpha);
        using var compositeImage = SKImage.FromBitmap(composite);
        using var jpeg = compositeImage.Encode(SKEncodedImageFormat.Jpeg, ResultJpegQuality);
        return $"data:image/jpeg;base64,{Convert.ToBase64String(jpeg.AsSpan())}";
    }

    // ── Pixel-level MEP fixture shield ──────────────────────────────────────────

    /// <summary>Feather (px) of a shielded fixture patch: small boxes need a short, subtle ramp.</summary>
    public const int ShieldFeather = 3;

    public async Task<string> ShieldFixturesAsync(string sourceDataUrl, string generatedSource,
        IReadOnlyList<Sucvar.Domain.Ai.DetectedFixture> shields, CancellationToken ct = default)
    {
        var generated = await ReadSourceAsync(generatedSource, ct);
        return ShieldJpegDataUrl(DecodeDataUrl(sourceDataUrl), generated, shields);
    }

    /// <summary>
    /// <c>generated + (source − generated) · α</c> on the source frame (≤ 1280 px wide, generated image covered onto it),
    /// where α is 1 inside each padded fixture rectangle, feathered over <see cref="ShieldFeather"/> px inside its edge,
    /// and exactly 0 everywhere else — outside the boxes the render is byte-for-byte the model's.
    /// </summary>
    public static string ShieldJpegDataUrl(byte[] source, byte[] generated, IReadOnlyList<Sucvar.Domain.Ai.DetectedFixture> shields)
    {
        int srcW, srcH;
        using (var codec = SKCodec.Create(new MemoryStream(source)) ?? throw new InvalidDataException("unreadable source"))
            (srcW, srcH) = MaskCompositor.OrientedSize(codec.EncodedOrigin, codec.Info.Width, codec.Info.Height);
        var scale = srcW > ResultMaxWidth ? (double)ResultMaxWidth / srcW : 1d;
        var outW = Math.Max(1, (int)Math.Round(srcW * scale));
        var outH = Math.Max(1, (int)Math.Round(srcH * scale));

        var photo = new SKSamplingOptions(SKCubicResampler.Mitchell);
        using var original = MaskCompositor.RenderUpright(source, outW, outH, cover: false, SKColors.White, photo);
        using var result = MaskCompositor.RenderUpright(generated, outW, outH, cover: true, SKColors.White, photo);

        var mask = new byte[outW * outH];
        foreach (var f in shields)
        {
            var (x, y, w, h) = Sucvar.Domain.Ai.RoomFixtures.ShieldRect(f);
            int x0 = Math.Clamp((int)Math.Floor(x * outW), 0, outW), x1 = Math.Clamp((int)Math.Ceiling((x + w) * outW), 0, outW);
            int y0 = Math.Clamp((int)Math.Floor(y * outH), 0, outH), y1 = Math.Clamp((int)Math.Ceiling((y + h) * outH), 0, outH);
            for (var py = y0; py < y1; py++) Array.Fill(mask, (byte)255, py * outW + x0, x1 - x0);
        }
        var alpha = MaskCompositor.FeatherAlpha(mask, outW, outH, ShieldFeather);
        // Composite keeps its first bitmap wherever α = 0: here that is the generated render
        using var shielded = MaskCompositor.Composite(result, original, alpha);
        using var image = SKImage.FromBitmap(shielded);
        using var jpeg = image.Encode(SKEncodedImageFormat.Jpeg, ResultJpegQuality);
        return $"data:image/jpeg;base64,{Convert.ToBase64String(jpeg.AsSpan())}";
    }

    private static byte[] DecodeDataUrl(string dataUrl) =>
        dataUrl.StartsWith("data:image/", StringComparison.Ordinal)
            ? Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..])
            : throw new InvalidDataException("expected an image data URL");

    /// <summary>A data URL's bytes, or a size-capped download of a provider URL.</summary>
    private async Task<byte[]> ReadSourceAsync(string source, CancellationToken ct)
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
        return input;
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
        return $"data:image/jpeg;base64,{Convert.ToBase64String(jpeg.AsSpan())}";
    }

    internal static void ApplyOrigin(SKCanvas c, SKEncodedOrigin origin, int w, int h)
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
