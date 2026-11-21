using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SkiaSharp;
using Sucvar.Application;
using Sucvar.Domain.Ai;
using Sucvar.Infrastructure.Ai;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>Two-stage precision pipeline: VLM fixture parsing, coordinate-grounded prompt, timeout fallback, pixel shield.</summary>
public class FixtureDetectionTests
{
    // ── Parsing ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Parses_the_strict_json_contract()
    {
        var fixtures = RoomFixtures.Parse("""
            {"fixtures":[
              {"kind":"outlet","x":0.125,"y":0.79,"width":0.03,"height":0.04,"confidence":0.92},
              {"kind":"radiator","x":0.4,"y":0.68,"width":0.2,"height":0.12,"confidence":0.81},
              {"kind":"window","x":0.6,"y":0.1,"width":0.25,"height":0.45,"confidence":0.97}
            ]}
            """);
        Assert.Equal(3, fixtures.Count);
        Assert.Equal("window", fixtures[0].Kind); // most confident first
        var outlet = Assert.Single(fixtures, f => f.Kind == RoomFixtures.Outlet);
        Assert.Equal((0.125, 0.79, 0.03, 0.04, 0.92), (outlet.X, outlet.Y, outlet.Width, outlet.Height, outlet.Confidence));
    }

    [Fact]
    public void Tolerates_fences_prose_aliases_and_pixel_boxes()
    {
        const string answer = """
            Sure! Here is what I found:
            ```json
            [{"label":"priză","bbox_2d":[80,500,100,525],"score":88},
             {"type":"light switch","bbox":[0.30,0.40,0.02,0.04]},
             {"kind":"întrerupător","x":"0.5","y":"0.5","width":"0.02","height":"0.03","confidence":"0.7"}]
            ```
            """;
        var fixtures = RoomFixtures.Parse(answer, imageWidth: 640, imageHeight: 640);
        Assert.Equal(3, fixtures.Count);
        var outlet = Assert.Single(fixtures, f => f.Kind == RoomFixtures.Outlet);
        Assert.Equal(0.125, outlet.X, 4);          // 80 / 640
        Assert.Equal(0.031, outlet.Width, 3);      // 20 / 640
        Assert.Equal(0.88, outlet.Confidence, 4);  // percentage score normalised
        Assert.Equal(2, fixtures.Count(f => f.Kind == RoomFixtures.Switch));
        Assert.Contains(fixtures, f => f.Confidence == 0.5); // missing confidence → neutral 0.5
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("I cannot see any fixtures.")]
    [InlineData("{\"fixtures\": \"none\"}")]
    [InlineData("{\"fixtures\": [{\"kind\":\"sofa\",\"x\":0.1,\"y\":0.1,\"width\":0.2,\"height\":0.2}]}")]
    [InlineData("{\"fixtures\": [{\"kind\":\"outlet\",\"x\":0.1,\"y\":0.1,\"width\":0.02,\"height\":0.02,\"confidence\":0.1}]}")]
    [InlineData("{\"fixtures\": [{\"kind\":\"outlet\",\"x\":0.1,\"y\":0.1,\"width\":-1,\"height\":0.02}]}")]
    [InlineData("{\"fixtures\": [{\"kind\":\"door\",\"x\":0,\"y\":0,\"width\":1,\"height\":1}]}")]
    [InlineData("{\"fixtures\": [{\"kind\":\"outlet\",\"x\":50,\"y\":50,\"width\":10,\"height\":10}]}")] // pixels, size unknown
    public void Unusable_answers_give_no_fixtures(string? answer) => Assert.Empty(RoomFixtures.Parse(answer));

    [Fact]
    public void Duplicate_boxes_keep_the_most_confident_and_coordinates_are_clipped()
    {
        var fixtures = RoomFixtures.Parse("""
            [{"kind":"outlet","x":0.10,"y":0.80,"width":0.03,"height":0.04,"confidence":0.6},
             {"kind":"outlet","x":0.101,"y":0.801,"width":0.03,"height":0.04,"confidence":0.9},
             {"kind":"door","x":-0.1,"y":0.2,"width":0.3,"height":0.9,"confidence":0.9}]
            """);
        Assert.Equal(0.9, Assert.Single(fixtures, f => f.Kind == "outlet").Confidence);
        var door = Assert.Single(fixtures, f => f.Kind == "door");
        Assert.Equal((0.0, 0.2, 0.2, 0.8), (door.X, door.Y, door.Width, door.Height));
    }

    // ── Coordinate-grounded prompt ───────────────────────────────────────────────

    private static readonly DetectedFixture Outlet = new("outlet", 0.125, 0.79, 0.03, 0.04, 0.92);
    private static readonly DetectedFixture Radiator = new("radiator", 0.40, 0.68, 0.20, 0.12, 0.81);
    private static readonly DetectedFixture Door = new("door", 0.05, 0.20, 0.16, 0.70, 0.95);
    private static readonly DetectedFixture Corner = new("corner", 0.49, 0.08, 0.02, 0.02, 0.7);
    private static readonly DetectedFixture WeakSwitch = new("switch", 0.70, 0.50, 0.02, 0.03, 0.4);

    [Fact]
    public void Anchor_clause_carries_exact_centre_coordinates()
    {
        var clause = RoomFixtures.AnchorClause([Outlet, Radiator, Door, Corner, WeakSwitch]);
        Assert.Contains("keep the electrical outlet at (x=14%, y=81%) and the radiator at (x=50%, y=74%) 100% visible", clause);
        Assert.Contains("never place wardrobes, sofas", clause);
        Assert.Contains("the door at (x=13%, y=55%) spanning x=5%–21%", clause);
        Assert.Contains("corners at (x=50%, y=9%)", clause);
        Assert.DoesNotContain("light switch", clause); // below the anchor confidence
        Assert.Equal("", RoomFixtures.AnchorClause([WeakSwitch]));
    }

    private static JsonElement Payload(object o) => JsonSerializer.SerializeToElement(o);

    [Fact]
    public void Instruction_plan_is_grounded_before_the_closing_structural_lock()
    {
        var plan = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "dormitor japandi, lemn deschis", preserveStructure = true }))
            .For(PromptFormat.Instruction)
            .WithFixtures([Outlet, Radiator]);

        Assert.Contains("electrical outlet at (x=14%, y=81%)", plan.Prompt);
        var anchorAt = plan.Prompt.IndexOf("Detected MEP fixtures", StringComparison.Ordinal);
        var lockAt = plan.Prompt.IndexOf("CRITICAL ARCHITECTURAL CONSTRAINTS", StringComparison.Ordinal);
        Assert.True(anchorAt > 0 && anchorAt < lockAt, "anchors go right before the closing lock");
        Assert.EndsWith(".", plan.Prompt);
        Assert.Equal(plan.Prompt, plan.Instruction);
        Assert.Equal(2, plan.Fixtures!.Count);
    }

    [Fact]
    public void Clip_prompts_keep_their_token_budget_and_no_fixtures_change_nothing()
    {
        var clip = GenerationPrompt.Create(Payload(new { mode = "interiors", customPrompt = "living modern", preserveStructure = true }));
        var grounded = clip.WithFixtures([Outlet]);
        Assert.Equal(clip.Prompt, grounded.Prompt);                      // 72-token CLIP list cannot carry coordinates
        Assert.Contains("(x=14%, y=81%)", grounded.Instruction);         // the instruction twin still is grounded

        var none = clip.For(PromptFormat.Instruction).WithFixtures([]);
        Assert.Equal(clip.For(PromptFormat.Instruction).Prompt, none.Prompt);
        Assert.Empty(none.Fixtures!);
    }

    [Fact]
    public void Only_small_confident_outlets_and_switches_are_shielded()
    {
        Assert.True(RoomFixtures.IsShieldTarget(Outlet));
        Assert.False(RoomFixtures.IsShieldTarget(Radiator));
        Assert.False(RoomFixtures.IsShieldTarget(WeakSwitch));
        Assert.False(RoomFixtures.IsShieldTarget(new("outlet", 0.1, 0.1, 0.3, 0.3, 0.99))); // not a small wall fixture
        var (x, y, w, h) = RoomFixtures.ShieldRect(new("switch", 0, 0.5, 0.02, 0.04, 0.9));
        Assert.Equal((0, 0.492, 0.024, 0.056), (Math.Round(x, 4), Math.Round(y, 4), Math.Round(w, 4), Math.Round(h, 4)));
    }

    // ── Detector: HTTP contract & graceful fallback ──────────────────────────────

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        public System.Collections.Concurrent.ConcurrentQueue<HttpRequestMessage> Requests { get; } = new();
        public System.Collections.Concurrent.ConcurrentQueue<string> Bodies { get; } = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Enqueue(request);
            Bodies.Enqueue(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));
            return await send(request, ct);
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false) { BaseAddress = new Uri("https://api.replicate.com/") };
    }

    private static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static ReplicateRoomFixtureDetector Detector(Handler handler, Action<AiOptions>? configure = null)
    {
        var options = new AiOptions { ReplicateApiToken = "r8_test" };
        configure?.Invoke(options);
        return new ReplicateRoomFixtureDetector(new Factory(handler), Options.Create(options), NullLogger<ReplicateRoomFixtureDetector>.Instance);
    }

    internal static string ImageDataUrl(SKColor color, int w = 64, int h = 48, SKEncodedImageFormat format = SKEncodedImageFormat.Png)
    {
        using var bmp = new SKBitmap(w, h);
        bmp.Erase(color);
        using var data = SKImage.FromBitmap(bmp).Encode(format, 95);
        return $"data:image/{(format == SKEncodedImageFormat.Png ? "png" : "jpeg")};base64,{Convert.ToBase64String(data.ToArray())}";
    }

    [Fact]
    public async Task Detector_calls_the_official_vision_model_and_parses_streamed_tokens()
    {
        var handler = new Handler((_, _) => Task.FromResult(Json(new
        {
            id = "p1", status = "succeeded",
            output = new[] { "{\"fixtures\":[{\"kind\":\"out", "let\",\"x\":0.1,\"y\":0.8,\"width\":0.03,\"height\":0.04,\"confidence\":0.9}]}" },
        })));
        var fixtures = await Detector(handler).DetectAsync(ImageDataUrl(SKColors.Gray, 2000, 1500));

        var outlet = Assert.Single(fixtures);
        Assert.Equal("outlet", outlet.Kind);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("v1/models/qwen/qwen2.5-vl-72b-instruct/predictions", request.RequestUri!.PathAndQuery.TrimStart('/'));
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        var body = JsonDocument.Parse(Assert.Single(handler.Bodies)).RootElement;
        var image = body.GetProperty("input").GetProperty("image").GetString()!;
        Assert.StartsWith("data:image/jpeg;base64,", image);
        var (_, w, h) = ReplicateRoomFixtureDetector.PrepareImage(ImageDataUrl(SKColors.Gray, 2000, 1500), 768);
        Assert.Equal((768, 576), (w, h)); // downscaled before upload
        Assert.Contains("JSON only", body.GetProperty("input").GetProperty("prompt").GetString());
    }

    [Fact]
    public void Versioned_vision_models_use_the_versioned_endpoint()
    {
        var detector = Detector(new Handler((_, _) => throw new InvalidOperationException()),
            o => o.VisionModel = "lucataco/qwen2.5-vl-7b-instruct:" + new string('a', 64));
        var (url, body) = detector.BuildCreateRequest("data:image/jpeg;base64,AAAA");
        Assert.Equal("v1/predictions", url);
        Assert.Equal(new string('a', 64), body["version"]!.GetValue<string>());
    }

    [Fact]
    public async Task Detector_times_out_quickly_and_returns_no_fixtures()
    {
        var handler = new Handler(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
            return Json(new { });
        });
        var sw = Stopwatch.StartNew();
        var fixtures = await Detector(handler, o => o.VisionTimeoutMs = 250).DetectAsync(ImageDataUrl(SKColors.Gray));
        Assert.Empty(fixtures);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"took {sw.Elapsed}");
    }

    [Fact]
    public async Task Slow_predictions_are_polled_then_abandoned_at_the_deadline()
    {
        var handler = new Handler((req, _) => Task.FromResult(req.Method == HttpMethod.Post && req.RequestUri!.ToString().EndsWith("/cancel")
            ? Json(new { })
            : Json(new { id = "p2", status = "processing", urls = new { get = "v1/predictions/p2", cancel = "v1/predictions/p2/cancel" } })));
        var fixtures = await Detector(handler, o => o.VisionTimeoutMs = 600).DetectAsync(ImageDataUrl(SKColors.Gray));
        Assert.Empty(fixtures);
        Assert.Contains(handler.Requests, r => r.Method == HttpMethod.Get);
    }

    [Theory]
    [InlineData(500, "succeeded", "{\"fixtures\":[]}")]
    [InlineData(200, "failed", null)]
    [InlineData(200, "succeeded", "no json here")]
    public async Task Errors_and_garbage_fall_back_to_no_fixtures(int status, string predictionStatus, string? output)
    {
        var handler = new Handler((_, _) => Task.FromResult(Json(new { id = "p3", status = predictionStatus, output }, (HttpStatusCode)status)));
        Assert.Empty(await Detector(handler).DetectAsync(ImageDataUrl(SKColors.Gray)));
    }

    [Fact]
    public async Task Disabled_or_tokenless_detector_never_calls_replicate()
    {
        var handler = new Handler((_, _) => throw new InvalidOperationException("must not be called"));
        var disabled = Detector(handler, o => o.VisionEnabled = false);
        var tokenless = Detector(handler, o => o.ReplicateApiToken = "");
        var badModel = Detector(handler, o => o.VisionModel = "../../v1/account");
        Assert.False(disabled.IsConfigured || tokenless.IsConfigured || badModel.IsConfigured);
        Assert.Empty(await disabled.DetectAsync(ImageDataUrl(SKColors.Gray)));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Caller_cancellation_still_propagates()
    {
        var handler = new Handler(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
            return Json(new { });
        });
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Detector(handler).DetectAsync(ImageDataUrl(SKColors.Gray), cts.Token));
    }

    // ── Pixel shield ─────────────────────────────────────────────────────────────

    private static SKColor PixelAt(string jpegDataUrl, double nx, double ny)
    {
        using var bmp = SKBitmap.Decode(Convert.FromBase64String(jpegDataUrl[(jpegDataUrl.IndexOf(',') + 1)..]));
        return bmp.GetPixel((int)(nx * bmp.Width), (int)(ny * bmp.Height));
    }

    [Fact]
    public void Shield_restores_original_pixels_only_over_the_fixture()
    {
        var source = Convert.FromBase64String(ImageDataUrl(SKColors.Red, 400, 300)["data:image/png;base64,".Length..]);
        // The model returns a different size (aspect kept): the shield frames it on the source
        var generated = Convert.FromBase64String(ImageDataUrl(SKColors.Blue, 800, 600, SKEncodedImageFormat.Jpeg)["data:image/jpeg;base64,".Length..]);
        var outlet = new DetectedFixture("outlet", 0.45, 0.45, 0.10, 0.10, 0.9);

        var result = SkiaImageProcessor.ShieldJpegDataUrl(source, generated, [outlet]);

        var centre = PixelAt(result, 0.5, 0.5);
        Assert.True(centre.Red > 200 && centre.Blue < 60, $"fixture keeps the original pixels, got {centre}");
        foreach (var (x, y) in new[] { (0.1, 0.1), (0.9, 0.9), (0.3, 0.5), (0.5, 0.3) })
        {
            var px = PixelAt(result, x, y);
            Assert.True(px.Blue > 200 && px.Red < 60, $"outside the shield the render is untouched at ({x},{y}), got {px}");
        }
        using var codec = SKCodec.Create(new MemoryStream(Convert.FromBase64String(result[(result.IndexOf(',') + 1)..])));
        Assert.Equal((400, 300), (codec.Info.Width, codec.Info.Height));
    }
}

/// <summary>End-to-end: detector → grounded instruction → generation → pixel shield → <c>detectedFixtures</c> in the response.</summary>
public class FixturePipelineEndpointTests(SucvarApiFactory factory) : IClassFixture<SucvarApiFactory>
{
    private sealed class FakeDetector(Func<IReadOnlyList<DetectedFixture>> detect) : IRoomFixtureDetector
    {
        public int Calls { get; private set; }
        public bool IsConfigured => true;
        public Task<IReadOnlyList<DetectedFixture>> DetectAsync(string imageDataUrl, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(detect());
        }
    }

    private sealed class InstructionProvider : IImageProvider
    {
        public ImageGenerationRequest? Last { get; private set; }
        public string Id => "replicate";
        public bool IsConfigured => true;
        public PromptFormat PromptFormat => PromptFormat.Instruction;
        public Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default)
        {
            Last = request;
            return Task.FromResult(new ImageGenerationResult(FixtureDetectionTests.ImageDataUrl(SKColors.Blue, 400, 300, SKEncodedImageFormat.Jpeg), false));
        }
    }

    private sealed class Selector(IImageProvider provider) : IImageProviderSelector
    {
        public (IImageProvider Provider, string? Warning) Select() => (provider, null);
    }

    private HttpClient Client(IImageProvider provider, IRoomFixtureDetector detector)
    {
        var userId = Guid.NewGuid();
        factory.Subscriptions.SetTier(userId, "pro");
        var client = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IImageProviderSelector>();
            s.AddSingleton<IImageProviderSelector>(new Selector(provider));
            s.RemoveAll<IRoomFixtureDetector>();
            s.AddSingleton(detector);
        })).CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return client;
    }

    private static readonly DetectedFixture Outlet = new("outlet", 0.45, 0.45, 0.10, 0.10, 0.9);
    private static readonly DetectedFixture Window = new("window", 0.6, 0.1, 0.2, 0.4, 0.95);

    [Fact]
    public async Task Structure_locked_render_is_grounded_shielded_and_reports_fixtures()
    {
        var provider = new InstructionProvider();
        var detector = new FakeDetector(() => [Outlet, Window]);
        var res = await Client(provider, detector).PostAsJsonAsync("/api/generate", new
        {
            image = FixtureDetectionTests.ImageDataUrl(SKColors.Red, 400, 300), mode = "interiors",
            customPrompt = "living japandi", preserveStructure = true,
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1, detector.Calls);
        Assert.Contains("electrical outlet at (x=50%, y=50%)", provider.Last!.Prompt);
        Assert.Contains("the window at (x=70%, y=30%)", provider.Last.Prompt);

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var fixtures = body.GetProperty("detectedFixtures").EnumerateArray().ToList();
        Assert.Equal(2, fixtures.Count);
        var outlet = fixtures.Single(f => f.GetProperty("kind").GetString() == "outlet");
        Assert.True(outlet.GetProperty("shielded").GetBoolean());
        Assert.False(fixtures.Single(f => f.GetProperty("kind").GetString() == "window").GetProperty("shielded").GetBoolean());
        Assert.Equal(0.45, outlet.GetProperty("x").GetDouble());

        var result = body.GetProperty("result").GetString()!;
        using var bmp = SKBitmap.Decode(Convert.FromBase64String(result[(result.IndexOf(',') + 1)..]));
        Assert.True(bmp.GetPixel(200, 150).Red > 200, "outlet pixels restored from the source");
        Assert.True(bmp.GetPixel(20, 20).Blue > 200, "the rest is the generated render");
    }

    [Fact]
    public async Task Redesign_requests_skip_the_detector_and_empty_detection_still_renders()
    {
        var detector = new FakeDetector(() => []);
        var provider = new InstructionProvider();
        var client = Client(provider, detector);

        var redesign = await client.PostAsJsonAsync("/api/generate", new
        {
            image = FixtureDetectionTests.ImageDataUrl(SKColors.Red, 400, 300), mode = "interiors", customPrompt = "living japandi", preserveStructure = false,
        });
        Assert.Equal(HttpStatusCode.OK, redesign.StatusCode);
        Assert.Equal(0, detector.Calls);

        var locked = await client.PostAsJsonAsync("/api/generate", new
        {
            image = FixtureDetectionTests.ImageDataUrl(SKColors.Red, 400, 300), mode = "interiors", customPrompt = "living japandi", preserveStructure = true,
        });
        Assert.Equal(HttpStatusCode.OK, locked.StatusCode);
        Assert.Equal(1, detector.Calls);
        var body = await locked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.TryGetProperty("detectedFixtures", out _));
        Assert.DoesNotContain("Detected MEP fixtures", provider.Last!.Prompt);
    }
}
