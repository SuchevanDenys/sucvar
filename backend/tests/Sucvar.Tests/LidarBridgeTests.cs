using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Sucvar.Api.Endpoints;
using Sucvar.Application.Lidar;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>The in-memory pairing store: codes, single delivery, expiry and TTL cleanup.</summary>
public class LidarBridgeServiceTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 20, 10, 0, 0, TimeSpan.Zero);
    private const string User = "11111111-1111-1111-1111-111111111111";
    private const string Other = "22222222-2222-2222-2222-222222222222";

    private static (LidarBridgeService Bridge, FakeClock Clock) Create()
    {
        var clock = new FakeClock(T0);
        return (new LidarBridgeService(clock), clock);
    }

    private static LidarUploadStatus Upload(LidarBridgeService bridge, string code, out LidarScan? scan) =>
        bridge.Upload(code, "living.json", "application/json", "utf8", "{\"walls\":[]}", 12, out scan);

    [Fact]
    public void Pair_issues_a_six_digit_code_valid_for_15_minutes()
    {
        var (bridge, _) = Create();
        var codes = Enumerable.Range(0, 200).Select(i => bridge.Pair($"user-{i}")).ToList();
        Assert.All(codes, p => Assert.Matches("^[0-9]{6}$", p.Code));
        Assert.All(codes, p => Assert.Equal(T0 + TimeSpan.FromMinutes(15), p.ExpiresAtUtc));
        Assert.Equal(codes.Count, codes.Select(p => p.Code).Distinct().Count()); // unique among live sessions
    }

    [Fact]
    public void A_new_pairing_revokes_the_users_previous_code()
    {
        var (bridge, _) = Create();
        var first = bridge.Pair(User);
        var second = bridge.Pair(User);
        Assert.Equal(LidarUploadStatus.NotFound, Upload(bridge, first.Code, out _));
        Assert.Equal(LidarUploadStatus.Accepted, Upload(bridge, second.Code, out _));
    }

    [Fact]
    public void Upload_then_poll_delivers_the_scan_exactly_once()
    {
        var (bridge, clock) = Create();
        var code = bridge.Pair(User).Code;
        Assert.Equal(LidarPollStatus.Waiting, bridge.Poll(User, code).Status);

        clock.Now = T0.AddMinutes(3);
        Assert.Equal(LidarUploadStatus.Accepted, Upload(bridge, code, out var scan));
        Assert.NotNull(scan);
        Assert.Equal(T0.AddMinutes(3), scan!.UploadedAtUtc);

        var poll = bridge.Poll(User, code);
        Assert.Equal(LidarPollStatus.NewScan, poll.Status);
        Assert.Equal(scan.ScanId, poll.Scan!.ScanId);
        Assert.Equal("{\"walls\":[]}", poll.Scan.RawPayload);
        Assert.Equal(LidarPollStatus.Waiting, bridge.Poll(User, code).Status);
    }

    [Fact]
    public void The_newest_upload_replaces_an_undelivered_one()
    {
        var (bridge, _) = Create();
        var code = bridge.Pair(User).Code;
        Upload(bridge, code, out var first);
        Upload(bridge, code, out var second);
        Assert.NotEqual(first!.ScanId, second!.ScanId);
        Assert.Equal(second.ScanId, bridge.Poll(User, code).Scan!.ScanId);
    }

    [Fact]
    public void Unknown_malformed_and_foreign_codes_are_rejected()
    {
        var (bridge, _) = Create();
        var code = bridge.Pair(User).Code;
        var unknown = code == "000000" ? "000001" : "000000";
        Assert.Equal(LidarUploadStatus.NotFound, Upload(bridge, unknown, out _));
        Assert.Equal(LidarUploadStatus.NotFound, Upload(bridge, "12345", out _));
        Assert.Equal(LidarUploadStatus.NotFound, Upload(bridge, "12a456", out _));
        Upload(bridge, code, out _);
        // Another signed-in user cannot read the scan, even knowing the code
        Assert.Equal(LidarPollStatus.NotFound, bridge.Poll(Other, code).Status);
        Assert.Equal(LidarPollStatus.NewScan, bridge.Poll(User, code).Status);
    }

    [Fact]
    public void Upload_after_15_minutes_is_expired_but_a_scan_sent_in_time_is_still_delivered()
    {
        var (bridge, clock) = Create();
        var code = bridge.Pair(User).Code;
        clock.Now = T0.AddMinutes(14);
        Assert.Equal(LidarUploadStatus.Accepted, Upload(bridge, code, out _));

        clock.Now = T0.AddMinutes(15);
        Assert.Equal(LidarUploadStatus.Expired, Upload(bridge, code, out _));
        var poll = bridge.Poll(User, code);
        Assert.Equal(LidarPollStatus.NewScan, poll.Status);
        Assert.True(poll.CodeExpired);
    }

    [Fact]
    public void Sessions_are_swept_after_30_minutes()
    {
        var (bridge, clock) = Create();
        var code = bridge.Pair(User).Code;
        bridge.Pair(Other);
        clock.Now = T0.AddMinutes(29);
        Assert.Equal(0, bridge.Sweep());
        clock.Now = T0.AddMinutes(30);
        Assert.Equal(2, bridge.Sweep());
        Assert.Equal(LidarUploadStatus.NotFound, Upload(bridge, code, out _));
        Assert.Equal(LidarPollStatus.NotFound, bridge.Poll(User, code).Status);
    }

    [Theory]
    [InlineData("Living Room", ".json", "Living Room.json")]
    [InlineData("../../etc/passwd", ".obj", "etcpasswd.obj")]
    [InlineData("scan.zip", ".zip", "scan.zip")]
    [InlineData(null, ".json", "roomplan-iphone.json")]
    [InlineData("  ", ".usdz", "roomplan-iphone.usdz")]
    public void File_names_are_sanitized(string? name, string ext, string expected) =>
        Assert.Equal(expected, LidarBridgeEndpoints.SafeFileName(name, ext));

    [Fact]
    public void Upload_url_prefers_the_configured_base_then_the_request_host()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Scheme = "http";
        ctx.Request.Host = new HostString("localhost", 5080);
        Assert.Equal("http://192.168.1.20:5080", LidarBridgeEndpoints.PublicServerUrl(ctx, "http://192.168.1.20:5080/"));
        // localhost is swapped for the LAN IPv4 when the machine has one; the port is always kept
        Assert.EndsWith(":5080", LidarBridgeEndpoints.PublicServerUrl(ctx, null));

        ctx.Request.Host = new HostString("10.0.0.7", 5080);
        Assert.Equal("http://10.0.0.7:5080", LidarBridgeEndpoints.PublicServerUrl(ctx, null));
    }
}

/// <summary>The three HTTP endpoints on the real host (auth, status codes, JSON + multipart uploads).</summary>
public class LidarBridgeEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public LidarBridgeEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private HttpClient Web(Guid userId)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return c;
    }

    /// <summary>The iPhone: no Authorization header; a distinct IP per test keeps the upload limiter independent.</summary>
    private HttpClient Phone()
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Forwarded-For", $"198.51.100.{Random.Shared.Next(1, 254)}");
        return c;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage res) => JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

    private static async Task<string> PairAsync(HttpClient web)
    {
        var res = await web.PostAsync("/api/studio/lidar/pair", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await Json(res);
        var code = body.GetProperty("code").GetString()!;
        Assert.Matches("^[0-9]{6}$", code);
        Assert.EndsWith("/api/studio/lidar/upload", body.GetProperty("uploadUrl").GetString());
        Assert.True(body.GetProperty("expiresAtUtc").GetDateTimeOffset() > DateTimeOffset.UtcNow.AddMinutes(14));
        return code;
    }

    private const string RoomPlan = """
        {"walls":[{"dimensions":[4.0,2.6,0],"transform":[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,1.3,-1.5,1]}],"doors":[],"windows":[]}
        """;

    [Fact]
    public async Task Pairing_requires_a_signed_in_user()
    {
        var res = await _factory.CreateClient().PostAsync("/api/studio/lidar/pair", null);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("AUTH_REQUIRED", (await Json(res)).GetProperty("code").GetString());
        var poll = await _factory.CreateClient().GetAsync("/api/studio/lidar/latest?code=123456");
        Assert.Equal(HttpStatusCode.Unauthorized, poll.StatusCode);
    }

    [Fact]
    public async Task Json_upload_is_delivered_to_the_paired_studio_once()
    {
        var user = Guid.NewGuid();
        var web = Web(user);
        var code = await PairAsync(web);

        var waiting = await Json(await web.GetAsync($"/api/studio/lidar/latest?code={code}"));
        Assert.False(waiting.GetProperty("hasNewScan").GetBoolean());

        using var scanDoc = JsonDocument.Parse(RoomPlan);
        var up = await Phone().PostAsJsonAsync("/api/studio/lidar/upload", new { code, roomName = "Dormitor", scanJson = scanDoc.RootElement });
        Assert.Equal(HttpStatusCode.OK, up.StatusCode);
        var upBody = await Json(up);
        Assert.Equal("Scanare recepționată în SUCVAR Studio.", upBody.GetProperty("message").GetString());
        var scanId = upBody.GetProperty("scanId").GetString();

        // Another account cannot read it
        var foreign = await Web(Guid.NewGuid()).GetAsync($"/api/studio/lidar/latest?code={code}");
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);

        var latest = await Json(await web.GetAsync($"/api/studio/lidar/latest?code={code}"));
        Assert.True(latest.GetProperty("hasNewScan").GetBoolean());
        Assert.Equal(scanId, latest.GetProperty("scanId").GetString());
        Assert.Equal("Dormitor.json", latest.GetProperty("fileName").GetString());
        Assert.Equal("application/json", latest.GetProperty("contentType").GetString());
        Assert.Equal("utf8", latest.GetProperty("encoding").GetString());
        using var echoed = JsonDocument.Parse(latest.GetProperty("rawPayload").GetString()!);
        Assert.Equal(4.0, echoed.RootElement.GetProperty("walls")[0].GetProperty("dimensions")[0].GetDouble());

        var again = await Json(await web.GetAsync($"/api/studio/lidar/latest?code={code}"));
        Assert.False(again.GetProperty("hasNewScan").GetBoolean());
    }

    [Fact]
    public async Task Scan_json_may_also_be_sent_as_a_string_and_the_code_as_a_number()
    {
        var web = Web(Guid.NewGuid());
        var code = await PairAsync(web);
        var up = await Phone().PostAsync("/api/studio/lidar/upload",
            new StringContent($"{{\"code\":{int.Parse(code)},\"scanJson\":{JsonSerializer.Serialize(RoomPlan)}}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, up.StatusCode);
        var latest = await Json(await web.GetAsync($"/api/studio/lidar/latest?code={code}"));
        Assert.Equal("roomplan-iphone.json", latest.GetProperty("fileName").GetString());
    }

    [Fact]
    public async Task Multipart_obj_and_zip_uploads_are_accepted()
    {
        var web = Web(Guid.NewGuid());
        var code = await PairAsync(web);

        using (var form = new MultipartFormDataContent())
        {
            form.Add(new StringContent(code), "code");
            form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")), "file", "Bucatarie.obj");
            var up = await Phone().PostAsync("/api/studio/lidar/upload", form);
            Assert.Equal(HttpStatusCode.OK, up.StatusCode);
        }
        var obj = await Json(await web.GetAsync($"/api/studio/lidar/latest?code={code}"));
        Assert.Equal("Bucatarie.obj", obj.GetProperty("fileName").GetString());
        Assert.Equal("model/obj", obj.GetProperty("contentType").GetString());
        Assert.StartsWith("v 0 0 0", obj.GetProperty("rawPayload").GetString());

        var zipBytes = new byte[] { (byte)'P', (byte)'K', 3, 4, 1, 2, 3 };
        using (var form = new MultipartFormDataContent())
        {
            form.Add(new StringContent(code), "code");
            form.Add(new ByteArrayContent(zipBytes), "file", "scan.zip");
            Assert.Equal(HttpStatusCode.OK, (await Phone().PostAsync("/api/studio/lidar/upload", form)).StatusCode);
        }
        var zip = await Json(await web.GetAsync($"/api/studio/lidar/latest?code={code}"));
        Assert.Equal("base64", zip.GetProperty("encoding").GetString());
        Assert.Equal(zipBytes, Convert.FromBase64String(zip.GetProperty("rawPayload").GetString()!));
    }

    [Fact]
    public async Task Invalid_codes_and_payloads_get_clear_romanian_errors()
    {
        var web = Web(Guid.NewGuid());
        var code = await PairAsync(web);
        var unknown = code == "000000" ? "000001" : "000000";
        using var scanDoc = JsonDocument.Parse(RoomPlan);

        var notFound = await Phone().PostAsJsonAsync("/api/studio/lidar/upload", new { code = unknown, scanJson = scanDoc.RootElement });
        Assert.Equal(HttpStatusCode.NotFound, notFound.StatusCode);
        var nf = await Json(notFound);
        Assert.Equal("LIDAR_CODE_NOT_FOUND", nf.GetProperty("code").GetString());
        Assert.Contains("Codul de asociere", nf.GetProperty("error").GetString());

        var malformed = await Phone().PostAsJsonAsync("/api/studio/lidar/upload", new { code = "12ab", scanJson = scanDoc.RootElement });
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal("LIDAR_CODE_INVALID", (await Json(malformed)).GetProperty("code").GetString());

        var missing = await Phone().PostAsJsonAsync("/api/studio/lidar/upload", new { code });
        Assert.Equal("LIDAR_SCAN_REQUIRED", (await Json(missing)).GetProperty("code").GetString());

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(code), "code");
        form.Add(new ByteArrayContent([1, 2, 3]), "file", "scan.exe");
        var badType = await Phone().PostAsync("/api/studio/lidar/upload", form);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, badType.StatusCode);
    }
}
