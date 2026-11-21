using System.Text.Json;
using Sucvar.Api.Auth;
using Sucvar.Api.Http;
using Sucvar.Application;
using Sucvar.Application.Quota;
using Sucvar.Domain;
using Sucvar.Domain.Ai;
using Sucvar.Domain.Catalog;
using Sucvar.Domain.Procurement;
using Sucvar.Domain.Studio;
using Sucvar.Infrastructure.Ai;
using static Sucvar.Api.Http.HttpHelpers;

namespace Sucvar.Api.Endpoints;

/// <summary>
/// AI Studio: <c>POST /api/generate</c> (image redesign) and <c>POST /api/analyze-materials</c> (bill of materials).
/// </summary>
/// <remarks>
/// The check order mirrors the original contract and is cost-driven: IP rate limit → quota (auth, plan, monthly
/// limit) → per-user rate limit → body cap → JSON → image validation. Every request rejected before the provider call
/// is free; a generation is journaled in <c>ai_generations</c> only after the provider actually returned an image.
/// </remarks>
public static class StudioEndpoints
{
    /// <summary>Largest accepted selection mask data URL (a binary PNG of a ≤1280 px photo is typically 20–200 KB).</summary>
    public const int MaxMaskLength = 2_000_000;
    public const int GenerateMaxBodyBytes = AiLimits.MaxImageLength + MaxMaskLength + 100_000;
    public const int MaterialsMaxBodyBytes = 16_000; // dimensions + up to 1000 chars of customPrompt (UTF-8)
    private const int MinImageSide = 64, MaxImageSide = 8192;
    private const long MaxImagePixels = 40_000_000;
    private static readonly string[] ImagePrefixes = ["data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,"];
    /// <summary>Stand-in for a non-object body (cloned once, so no pooled JsonDocument is left undisposed per request).</summary>
    private static readonly JsonElement EmptyObject = JsonDocument.Parse("{}").RootElement.Clone();

    public static IEndpointRouteBuilder MapStudioEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/generate", Generate).WithTags("Studio").WithName("Generate").RequireActiveAccount();
        app.MapPost("/api/analyze-materials", AnalyzeMaterials).WithTags("Studio").WithName("AnalyzeMaterials").RequireActiveAccount();
        app.MapPost("/api/prompt-preview", PromptPreview).WithTags("Studio").WithName("PromptPreview").RequireActiveAccount();
        app.MapPost("/api/detected-items", DetectedItems).WithTags("Studio").WithName("DetectedItems").RequireActiveAccount();
        app.MapGet("/api/ai/model", ActiveModel).WithTags("Studio").WithName("ActiveAiModel").AllowAnonymous();
        return app;
    }

    /// <summary>
    /// <c>GET /api/ai/model</c>: the active image model and the prompt it reads, so the Studio shows only the controls
    /// that model uses (CLIP sliders vs. natural-language instruction). No secrets: provider id, model id, format.
    /// </summary>
    private static IResult ActiveModel(HttpContext ctx, IImageProviderSelector providers)
    {
        var provider = providers.Select().Provider;
        ctx.Response.Headers.CacheControl = "public, max-age=60";
        return Results.Json(new
        {
            provider = provider.Id, model = provider.ModelId, promptFormat = FormatId(provider.PromptFormat),
            // "Edit selected area": the model and prompt a masked request uses
            inpaintModel = provider.ModelIdFor(masked: true), inpaintPromptFormat = FormatId(provider.PromptFormatFor(masked: true)),
        });
    }

    /// <summary>^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$ without a regex over 6 MB.</summary>
    public static bool IsAcceptedDataUrl(string image)
    {
        var prefix = ImagePrefixes.FirstOrDefault(p => image.StartsWith(p, StringComparison.Ordinal));
        if (prefix is null || image.Length == prefix.Length) return false;
        for (var i = prefix.Length; i < image.Length; i++)
        {
            var c = image[i];
            if (!(char.IsAsciiLetterOrDigit(c) || c is '+' or '/' or '=')) return false;
        }
        return true;
    }

    private static async Task<IResult> Generate(
        HttpContext ctx,
        FixedWindowRateLimitStore limiter,
        ServerConfig config,
        QuotaService quota,
        IImageProviderSelector providers,
        IImageProcessor images,
        IPromptEnhancer enhancer,
        IRoomFixtureDetector fixtureDetector,
        GenerationGate gate,
        ILogger<QuotaService> logger)
    {
        IDisposable? lease = null;
        try
        {
            // 0a. IP limit before any database work
            var ip = ClientIp(ctx);
            if (limiter.Check(Rules.GenerateIp, ip) is { } ipWait) return TooManyRequests(ctx, ipWait);

            // 0b. Session + plan + monthly limit BEFORE reading a multi-MB body
            var (state, user) = RequestAuth.Resolve(ctx);
            var configured = config.DatabaseConfigured && config.JwtConfigured;
            var missing = string.Join(", ", config.MissingSupabase());
            var q = await quota.CheckAsync(state, user, config.AllowAnonGeneration, configured, missing, config.IsProduction, ctx.RequestAborted);
            if (!q.Ok) return QuotaError(q);

            // 0c. Per-user limit (anonymous dev callers stay on IP)
            if (limiter.Check(Rules.GenerateUser, q.UserId ?? ip) is { } userWait) return TooManyRequests(ctx, userWait);

            // 0d. Metered plan: one generation at a time per user, and usage re-counted once earlier ones are journaled
            if (q.Metered && q.UserId is { } meteredUser)
            {
                lease = await gate.EnterAsync(meteredUser, ctx.RequestAborted);
                q = await quota.CheckAsync(state, user, config.AllowAnonGeneration, configured, missing, config.IsProduction, ctx.RequestAborted);
                if (!q.Ok) return QuotaError(q);
            }

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, GenerateMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var parsed)) return InvalidJson();
            var payload = parsed.ValueKind == JsonValueKind.Object ? parsed : EmptyObject;

            // 1. Photo
            var image = Js.AsString(Js.Prop(payload, "image"));
            if (image is null || !image.StartsWith("data:image/", StringComparison.Ordinal))
                return JsonError(400, "IMAGE_REQUIRED", "Lipsește fotografia spațiului.");
            if (image.Length > AiLimits.MaxImageLength) return JsonError(413, "IMAGE_TOO_LARGE", "Fotografia este prea mare.");
            if (!IsAcceptedDataUrl(image))
                return JsonError(415, "IMAGE_FORMAT", "Format de fotografie neacceptat (folosește JPEG, PNG sau WebP).");

            // 1b. Real format from the header + dimensions within limits (blocks decompression bombs)
            try
            {
                var meta = images.Inspect(Convert.FromBase64String(image[(image.IndexOf(',') + 1)..]));
                if (meta.Format is not ("jpeg" or "png" or "webp")) throw new InvalidDataException("format");
                if (Math.Min(meta.Width, meta.Height) < MinImageSide || Math.Max(meta.Width, meta.Height) > MaxImageSide ||
                    (long)meta.Width * meta.Height > MaxImagePixels)
                {
                    return JsonError(422, "IMAGE_DIMENSIONS",
                        $"Dimensiuni invalide: fotografia trebuie să aibă între {MinImageSide} și {MaxImageSide} px pe latură.");
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return JsonError(415, "IMAGE_CORRUPT", "Fotografia este coruptă sau nu poate fi citită.");
            }

            // 1c. Flexible brief: free-text customPrompt (≤ 1000 chars) and/or a style — at least one of them
            if (DesignVision.Validate(payload) is { } visionError) return JsonError(400, visionError.Code, visionError.Message);

            // 1d. Optional "Edit selected area" mask: validated, aligned to the photo's pixels and measured
            PreparedMask? mask = null;
            var maskEl = Js.Prop(payload, "mask");
            if (maskEl is { } m && m.ValueKind != JsonValueKind.Null)
            {
                if (m.ValueKind != JsonValueKind.String) return JsonError(400, "MASK_INVALID", "Masca selecției este invalidă.");
                var maskUrl = m.GetString()!;
                if (maskUrl.Length > MaxMaskLength) return JsonError(413, "MASK_TOO_LARGE", "Masca selecției este prea mare.");
                if (!(maskUrl.StartsWith("data:image/png;base64,", StringComparison.Ordinal) || maskUrl.StartsWith("data:image/webp;base64,", StringComparison.Ordinal))
                    || !IsAcceptedDataUrl(maskUrl))
                    return JsonError(415, "MASK_FORMAT", "Masca selecției trebuie să fie o imagine PNG.");
                try
                {
                    mask = images.PrepareMask(maskUrl, image);
                }
                catch (MaskRejectedException ex)
                {
                    return JsonError(422, ex.Code, ex.Message);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    return JsonError(415, "MASK_CORRUPT", "Masca selecției este coruptă sau nu poate fi citită.");
                }
            }
            var masked = mask is not null;

            // 2–4. Space / layout / style / AI settings / 72-token prompt (all re-validated); a mask → regional edit plan
            var plan = GenerationPrompt.Create(payload, mask?.Region);
            var (provider, providerWarning) = providers.Select();
            // 4b. Optional LLM "Prompt Architect" (free-text briefs only; skipped in demo mode — nothing would use it —
            // for instruction models: it writes CLIP tags, while they get the natural-language instruction — and for
            // regional edits, whose prompt must not grow room-wide tags)
            var format = provider.PromptFormatFor(masked);
            if (provider.Id != "demo" && format == PromptFormat.Clip && !masked) plan = await EnhanceAsync(plan, enhancer, ctx.RequestAborted);
            plan = plan.For(format);
            // 4b'. Two-stage precision: a vision model locates outlets, switches, radiators, doors, windows and corners on
            // the photo, and the instruction is grounded on their coordinates. Structure-locked full-room photo renders only
            // (a mask already keeps every unselected pixel; a 3D-scan render has no fixtures). Best effort: ≤ 6 s, [] on failure.
            var preserve = plan.Brief?.PreserveStructure ?? true;
            if (provider.Id != "demo" && preserve && !masked && !plan.Is3dScanSource && fixtureDetector.IsConfigured)
                plan = plan.WithFixtures(await fixtureDetector.DetectAsync(image, ctx.RequestAborted));
            var request = new ImageGenerationRequest(image, plan.Prompt, plan.NegativePrompt, plan.InferenceSteps, plan.GuidanceScale,
                plan.Seed, plan.PromptStrength, plan.TransformationStrength, plan.Mode, plan.Brief?.PreserveStructure ?? true,
                mask?.DataUrl, plan.Is3dScanSource && mask is null);
            // 4c. "Shop the look" hotspots (deterministic, no extra paid call; a mask pins the edited object on the region)
            var detectedItems = RoomObjectExtractor.Extract(RoomObjectExtractor.ContextFrom(payload, plan, mask?.Region));

            // 5. Demo mode (no provider credentials)
            if (provider.Id == "demo")
            {
                var demo = await provider.GenerateAsync(request, ctx.RequestAborted);
                var demoResult = demo.ImageUrl;
                try
                {
                    demoResult = mask is not null
                        ? await images.CompositeRegionAsync(image, demo.ImageUrl, mask.DataUrl, ctx.RequestAborted)
                        : await images.ToPermanentJpegDataUrlAsync(demo.ImageUrl, ctx.RequestAborted);
                }
                catch (Exception ex) when (ex is not OperationCanceledException) { /* keep the Unsplash URL (it does not expire) */ }
                return Results.Json(Response(demoResult, true, plan, providerWarning, detectedItems));
            }

            // 6. Real call
            ImageGenerationResult generated;
            try
            {
                generated = await provider.GenerateAsync(request, ctx.RequestAborted);
            }
            catch (NoImageException)
            {
                return JsonError(502, "AI_NO_IMAGE", "Modelul AI nu a returnat nicio imagine.");
            }
            catch (TimeoutException ex)
            {
                // Not billed to the user's quota: nothing is journaled when no image came back.
                logger.LogWarning(ex, "[SUCVAR] Generare expirată");
                return JsonError(504, "AI_TIMEOUT", "Modelul AI nu a răspuns la timp. Generarea nu a fost contorizată — încearcă din nou.");
            }
            if (string.IsNullOrEmpty(generated.ImageUrl)) return JsonError(502, "AI_NO_IMAGE", "Modelul AI nu a returnat nicio imagine.");

            // The provider returned an image → the generation is paid for: journal it BEFORE converting
            await quota.RecordGenerationAsync(q.UserId, provider.Id, plan.Mode, ctx.RequestAborted);

            // 7. Permanent JPEG data URL; on failure keep the temporary URL + warning.
            // 7b. Regional edit: feathered composite through the mask — every unselected pixel comes from the photo.
            // 7c. Pixel-level MEP shield: small, confident outlets / switches get their original pixels back (feathered),
            // so a socket is never painted over; on any failure the plain conversion runs instead.
            var permanent = generated.ImageUrl;
            string? warning = providerWarning;
            var shields = mask is null ? (plan.Fixtures ?? []).Where(RoomFixtures.IsShieldTarget).ToList() : [];
            var shielded = false;
            try
            {
                if (mask is not null) permanent = await images.CompositeRegionAsync(image, generated.ImageUrl, mask.DataUrl, ctx.RequestAborted);
                else
                {
                    if (shields.Count > 0)
                    {
                        try
                        {
                            permanent = await images.ShieldFixturesAsync(image, generated.ImageUrl, shields, ctx.RequestAborted);
                            shielded = true;
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            logger.LogWarning(ex, "[SUCVAR] Fixture shield failed; keeping the unshielded render");
                        }
                    }
                    if (!shielded) permanent = await images.ToPermanentJpegDataUrlAsync(generated.ImageUrl, ctx.RequestAborted);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Permanent image conversion failed");
                warning = mask is not null
                    ? "Zona selectată nu a putut fi îmbinată cu fotografia originală; imaginea afișată este rezultatul brut al modelului, cu link temporar. Generează din nou."
                    : "Imaginea nu a putut fi comprimată permanent; linkul este temporar și expiră în câteva ore. Salvează proiectul imediat.";
            }
            if (shielded) plan = plan with { Fixtures = plan.Fixtures!.Select(f => RoomFixtures.IsShieldTarget(f) ? f with { Shielded = true } : f).ToList() };
            return Results.Json(Response(permanent, false, plan, warning, detectedItems));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Details stay in the server log; the client gets a generic message
            logger.LogError(ex, "[SUCVAR] Eroare /api/generate");
            return JsonError(500, "GENERATION_FAILED", "Generarea a eșuat. Încearcă din nou în câteva momente.");
        }
        finally
        {
            lease?.Dispose();
        }
    }

    /// <summary>The quota refusal in its original shape: <c>{ error, code, used?, limit? }</c>.</summary>
    private static IResult QuotaError(QuotaResult q)
    {
        var body = new Dictionary<string, object?> { ["error"] = q.Error, ["code"] = q.Code };
        if (q.Used is not null) body["used"] = q.Used;
        if (q.Limit is not null) body["limit"] = q.Limit;
        return Results.Json(body, statusCode: q.Status);
    }

    private static Dictionary<string, object?> Response(string result, bool isDemo, GenerationPlan plan, string? warning,
        IReadOnlyList<DetectedItem>? detectedItems = null)
    {
        var prompt = plan.Prompt;
        var body = new Dictionary<string, object?>
        {
            ["result"] = result,
            ["imageUrl"] = result,
            ["generatedImage"] = result,
            ["isDemo"] = isDemo,
            ["promptUsed"] = prompt,
            ["negativePromptUsed"] = plan.NegativePrompt,
            ["promptEngine"] = plan.Engine,
            ["promptFormat"] = FormatId(plan.Format),
            ["parameters"] = new { promptStrength = plan.PromptStrength, guidanceScale = plan.GuidanceScale, inferenceSteps = plan.InferenceSteps },
        };
        if (warning is not null) body["warning"] = warning;
        if (plan.Brief is not null) body["vision"] = DesignVision.ToResponse(plan.Brief); // resolved brief for the Studio summary
        if (plan.Region is { } r) body["regionalEdit"] = RegionResponse(r);
        if (detectedItems is { Count: > 0 }) body["detectedItems"] = detectedItems;
        // Stage-1 detections for the Studio's "repere MEP & colțuri" overlay (normalised 0..1 boxes, source frame)
        if (plan.Fixtures is { Count: > 0 } fixtures)
            body["detectedFixtures"] = fixtures.Select(f => new { kind = f.Kind, x = f.X, y = f.Y, width = f.Width, height = f.Height, confidence = f.Confidence, shielded = f.Shielded }).ToList();
        return body;
    }

    /// <summary>Runs the optional enhancer on smart free-text plans; the deterministic plan is kept on any failure.</summary>
    private static async Task<GenerationPlan> EnhanceAsync(GenerationPlan plan, IPromptEnhancer enhancer, CancellationToken ct)
    {
        // A 3D-scan source keeps the deterministic synthesis directive (the enhancer would drop the scan cues)
        if (!enhancer.IsConfigured || plan.Is3dScanSource || plan.Brief is not { HasCustomPrompt: true } brief || plan.Parts is null) return plan;
        var scale = brief.Scale;
        var enhanced = await enhancer.EnhanceAsync(new PromptEnhancementRequest(
            plan.Mode, brief.SpaceType, brief.StyleId, brief.Palette, brief.Lighting,
            scale is { AreaKnown: true } ? scale.AreaSqm : null, scale?.Height, brief.PreserveStructure,
            brief.CustomPrompt, plan.Prompt, plan.Parts.LockedSpecs), ct);
        return GenerationPrompt.ApplyEnhancement(plan, enhanced);
    }

    /// <summary>
    /// <c>POST /api/prompt-preview</c>: the compiled prompt, negative prompt and calibrated parameters for a Studio
    /// brief, without an image and without any paid call (the LLM step is not run here; <c>enhancerAvailable</c> says
    /// whether it would refine the prompt at render time).
    /// </summary>
    private static object RegionResponse(SelectionRegion r) => new
    {
        bounds = new { x = r.X, y = r.Y, width = r.Width, height = r.Height },
        coverage = r.Coverage,
        position = r.Position,
    };

    private static string FormatId(PromptFormat format) => format == PromptFormat.Instruction ? "instruction" : "clip";

    private static async Task<IResult> PromptPreview(HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config,
        IPromptEnhancer enhancer, IImageProviderSelector providers, ILogger<QuotaService> logger)
    {
        try
        {
            if (limiter.Check(Rules.MaterialsIp, ClientIp(ctx)) is { } ipWait) return TooManyRequests(ctx, ipWait);
            var (user, authError) = RequestAuth.Require(ctx, config);
            if (authError is not null) return authError;
            if (limiter.Check(Rules.MaterialsUser, user!.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, MaterialsMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return InvalidJson();
            if (body.ValueKind != JsonValueKind.Object) return JsonError(400, "INVALID_BODY", "Corp invalid: se așteaptă un obiect JSON.");
            if (DesignVision.Validate(body) is { } visionError) return JsonError(400, visionError.Code, visionError.Message);

            // Preview exactly what the active model would read (CLIP tags or the natural-language instruction)
            var active = providers.Select().Provider;
            var regional = SelectionRegion.FromPayload(body) is not null;
            var format = active.PromptFormatFor(regional);
            var plan = GenerationPrompt.Create(body).For(format);
            var clip = plan.Format == PromptFormat.Clip;
            return Results.Json(new
            {
                prompt = plan.Prompt,
                negativePrompt = plan.NegativePrompt,
                promptEngine = plan.Engine,
                promptFormat = FormatId(plan.Format),
                enhancerAvailable = enhancer.IsConfigured && clip && !regional,
                estimatedTokens = GenerationPrompt.EstimateTokens(plan.Prompt),
                // Only CLIP models have a token budget; null hides the "~n/72 tok" counter in the Studio
                maxTokens = clip ? AiLimits.MaxPromptTokens : (int?)null,
                parameters = new { promptStrength = plan.PromptStrength, guidanceScale = plan.GuidanceScale, inferenceSteps = plan.InferenceSteps },
                vision = plan.Brief is null ? null : DesignVision.ToResponse(plan.Brief),
                regionalEdit = plan.Region is null ? null : RegionResponse(plan.Region),
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] /api/prompt-preview");
            return JsonError(500, "INTERNAL_ERROR", "Previzualizarea promptului a eșuat.");
        }
    }

    /// <summary>
    /// <c>POST /api/detected-items</c>: the "Shop the look" hotspots for a Studio brief, without an image and without
    /// quota — used to rebuild the object inspector of projects saved before <c>detectedItems</c> existed.
    /// </summary>
    private static async Task<IResult> DetectedItems(HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config, ILogger<QuotaService> logger)
    {
        try
        {
            if (limiter.Check(Rules.MaterialsIp, ClientIp(ctx)) is { } ipWait) return TooManyRequests(ctx, ipWait);
            var (user, authError) = RequestAuth.Require(ctx, config);
            if (authError is not null) return authError;
            if (limiter.Check(Rules.MaterialsUser, user!.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, MaterialsMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return InvalidJson();
            if (body.ValueKind != JsonValueKind.Object) return JsonError(400, "INVALID_BODY", "Corp invalid: se așteaptă un obiect JSON.");
            if (DesignVision.Validate(body) is { } visionError) return JsonError(400, visionError.Code, visionError.Message);

            var plan = GenerationPrompt.Create(body);
            return Results.Json(new { detectedItems = RoomObjectExtractor.Extract(RoomObjectExtractor.ContextFrom(body, plan)) });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] /api/detected-items");
            return JsonError(500, "INTERNAL_ERROR", "Obiectele randării nu au putut fi calculate.");
        }
    }

    private static async Task<IResult> AnalyzeMaterials(HttpContext ctx, FixedWindowRateLimitStore limiter, ServerConfig config, ILogger<QuotaService> logger)
    {
        try
        {
            if (limiter.Check(Rules.MaterialsIp, ClientIp(ctx)) is { } ipWait) return TooManyRequests(ctx, ipWait);

            var (user, authError) = RequestAuth.Require(ctx, config);
            if (authError is not null) return authError;

            if (limiter.Check(Rules.MaterialsUser, user!.UserId) is { } userWait) return TooManyRequests(ctx, userWait);

            var (text, tooLarge) = await ReadBodyTextAsync(ctx, MaterialsMaxBodyBytes);
            if (tooLarge is not null) return tooLarge;
            if (!TryParseJson(text!, out var body)) return InvalidJson();
            if (body.ValueKind != JsonValueKind.Object) return JsonError(400, "INVALID_BODY", "Corp invalid: se așteaptă un obiect JSON.");

            var mode = Js.AsString(Js.Prop(body, "mode"));
            var spaceType = Js.AsString(Js.Prop(body, "spaceType")) ?? Js.AsString(Js.Prop(body, "roomType"));
            if (!SucvarCatalog.IsKnownSpace(mode, spaceType)) return JsonError(400, "INVALID_SPACE", "Mod sau tip de spațiu necunoscut.");

            // Free-text vision: its materials drive the list; it can also stand in for the style ("auto")
            var customPromptEl = Js.Prop(body, "customPrompt");
            if (customPromptEl is { } cp && cp.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                return JsonError(400, "INVALID_PROMPT", "Descrierea trebuie să fie text.");
            var customPrompt = DesignVision.CleanCustomPrompt(Js.AsString(customPromptEl));
            if (customPrompt.Length > DesignVision.CustomPromptMaxLength)
                return JsonError(400, "PROMPT_TOO_LONG", $"Descrierea poate avea cel mult {DesignVision.CustomPromptMaxLength} de caractere.");

            var requestedStyle = DesignVision.RequestedStyle(body);
            string styleId;
            var styleInferred = false;
            if (requestedStyle is not null)
            {
                if (!SucvarCatalog.IsKnownStyle(requestedStyle)) return JsonError(400, "INVALID_STYLE", "Stil necunoscut.");
                styleId = requestedStyle;
            }
            else if (customPrompt.Length > 0)
            {
                styleId = DesignVision.InferStyle(customPrompt) ?? SucvarCatalog.GetStyle(null).Id;
                styleInferred = true;
            }
            else return JsonError(400, "INVALID_STYLE", "Stil necunoscut.");

            var dimensions = DimensionSanitizer.Sanitize(Js.Prop(body, "dimensions"), mode!, spaceType);
            // Area-only callers (no explicit dimensions): a 4:5 room of that floor area
            if (Js.Prop(body, "dimensions") is null && Js.Prop(body, "areaSqm") is { } areaEl)
            {
                var area = GenerationPrompt.ReadNumber(areaEl, DesignVision.MinAreaSqm, DesignVision.MaxAreaSqm, DesignVision.DefaultAreaSqm);
                var width = Js.Clamp(Js.ToFixed(Math.Sqrt(area * 0.8), 2), 1, 100);
                dimensions = dimensions with { Width = width, Length = Js.Clamp(Js.ToFixed(area / width, 2), 1, 100) };
            }

            var materials = DesignVision.DetectMaterials(customPrompt);
            var bom = BomBuilder.Build(mode!, spaceType!, SucvarCatalog.GetStyle(styleId).Id, dimensions, materials);
            if (customPrompt.Length == 0 && requestedStyle is not null) return Results.Json(new { bom }); // legacy shape
            return Results.Json(new
            {
                bom,
                vision = new
                {
                    styleId,
                    styleInferred,
                    materials = materials.Select(m => new { id = m.Id, slot = m.Slot, titleRo = m.TitleRo, titleEn = m.TitleEn }).ToList(),
                },
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "[SUCVAR] /api/analyze-materials");
            return JsonError(500, "INTERNAL_ERROR", "Analiza materialelor a eșuat. Încearcă din nou.");
        }
    }
}
