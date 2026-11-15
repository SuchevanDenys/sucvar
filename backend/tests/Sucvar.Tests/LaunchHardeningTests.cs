using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Sucvar.Api.Http;
using Sucvar.Domain.B2b;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>Client IP resolution: forwarding headers are trusted only from known proxies.</summary>
public class ClientIpTests
{
    private static string Resolve(ProxyOptions options, string remote, string? xff)
    {
        var ctx = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddSingleton(Options.Create(options)).BuildServiceProvider(),
        };
        ctx.Connection.RemoteIpAddress = IPAddress.Parse(remote);
        if (xff is not null) ctx.Request.Headers["x-forwarded-for"] = xff;
        return HttpHelpers.ClientIp(ctx);
    }

    [Fact]
    public void Spoofed_forwarded_for_from_an_untrusted_peer_is_ignored()
    {
        Assert.Equal("203.0.113.9", Resolve(new ProxyOptions(), "203.0.113.9", "1.2.3.4"));
    }

    [Fact]
    public void Behind_a_trusted_proxy_the_rightmost_untrusted_hop_is_the_client()
    {
        var options = new ProxyOptions { KnownProxies = "10.0.0.0/8, 127.0.0.1" };
        // "6.6.6.6" was injected by the client itself; the proxy appended the real peer 198.51.100.7
        Assert.Equal("198.51.100.7", Resolve(options, "10.1.2.3", "6.6.6.6, 198.51.100.7"));
        Assert.Equal("198.51.100.7", Resolve(options, "127.0.0.1", "198.51.100.7, 10.0.0.5"));
        Assert.Equal("10.1.2.3", Resolve(options, "10.1.2.3", null));
    }

    [Fact]
    public void Invalid_entries_are_ignored_and_cidr_host_bits_are_masked()
    {
        var options = new ProxyOptions { KnownProxies = "not-an-ip, 10.0.0.5/8, ::1, 300.1.1.1" };
        Assert.True(options.IsTrusted("::1"));
        Assert.True(options.IsTrusted("10.9.9.9"));   // 10.0.0.5/8 ≡ 10.0.0.0/8
        Assert.False(options.IsTrusted("11.0.0.1"));
        Assert.False(options.IsTrusted("300.1.1.1"));
    }
}

/// <summary>RO CUI control digit (ANAF key 753217532) and IBAN mod-97.</summary>
public class CompanyProfileValidationTests
{
    [Theory]
    [InlineData("RO18547290", true)]   // ANAF example (control digit 0)
    [InlineData("18547290", true)]
    [InlineData("RO18547291", false)]  // wrong control digit
    [InlineData("RO1", false)]
    [InlineData("DE123456789", true)]  // other EU VAT: format check only
    [InlineData("RO-ABC", false)]
    public void Vat_ids_are_checked(string vatId, bool valid) =>
        Assert.Equal(valid, CompanyProfileParser.IsValidVatId(CompanyProfileParser.NormalizeVatId(vatId)));

    [Theory]
    [InlineData("RO49AAAA1B31007593840000", true)]
    [InlineData("RO49AAAA1B31007593840001", false)]
    [InlineData("DE89370400440532013000", true)]
    [InlineData("RO49AAAA1B3100759384", false)] // RO IBAN must be 24 chars
    public void Ibans_are_checked(string iban, bool valid) => Assert.Equal(valid, CompanyProfileParser.IsValidIban(iban));

    [Fact]
    public void Parser_normalizes_and_reports_specific_codes()
    {
        var ok = CompanyProfileParser.Parse(JsonSerializer.SerializeToElement(new { name = "  SC Test SRL ", vatId = "ro 18547290", iban = "ro49 aaaa 1b31 0075 9384 0000" }));
        Assert.True(ok.Ok);
        Assert.Equal(("SC Test SRL", "RO18547290", "RO49AAAA1B31007593840000"), (ok.Value!.Name, ok.Value.VatId, ok.Value.Iban));

        Assert.Equal("INVALID_VAT_ID", CompanyProfileParser.Parse(JsonSerializer.SerializeToElement(new { vatId = "RO18547291" })).Code);
        Assert.Equal("INVALID_IBAN", CompanyProfileParser.Parse(JsonSerializer.SerializeToElement(new { iban = "RO00XXXX" })).Code);
        Assert.Equal("INVALID_EMAIL", CompanyProfileParser.Parse(JsonSerializer.SerializeToElement(new { email = "nope" })).Code);
    }

    [Fact]
    public void Default_vat_is_the_french_standard_rate() =>
        Assert.Equal(20, EstimateParser.Parse(JsonSerializer.SerializeToElement(new { })).Value!.VatPct);
}

/// <summary>Company profile and Stripe Customer Portal over HTTP.</summary>
public class LaunchEndpointTests : IClassFixture<SucvarApiFactory>
{
    private readonly SucvarApiFactory _factory;
    public LaunchEndpointTests(SucvarApiFactory factory) => _factory = factory;

    private HttpClient Client(Guid userId)
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", SucvarApiFactory.Token(userId));
        return c;
    }

    [Fact]
    public async Task Company_profile_is_saved_per_user_and_requires_agency_to_write()
    {
        var agency = Guid.NewGuid();
        var pro = Guid.NewGuid();
        _factory.Subscriptions.SetTier(agency, "agency");
        _factory.Subscriptions.SetTier(pro, "pro");

        var empty = await Client(agency).GetFromJsonAsync<JsonElement>("/api/b2b/company");
        Assert.Equal(JsonValueKind.Null, empty.GetProperty("company").ValueKind);

        var denied = await Client(pro).PutAsJsonAsync("/api/b2b/company", new { name = "X" });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        var bad = await Client(agency).PutAsJsonAsync("/api/b2b/company", new { vatId = "RO18547291" });
        Assert.Equal("INVALID_VAT_ID", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var saved = await Client(agency).PutAsJsonAsync("/api/b2b/company", new { name = "Firma SRL", vatId = "RO18547290", regNo = "J40/1/2020" });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var company = (await Client(agency).GetFromJsonAsync<JsonElement>("/api/b2b/company")).GetProperty("company");
        Assert.Equal("Firma SRL", company.GetProperty("name").GetString());
        Assert.Equal("J40/1/2020", company.GetProperty("regNo").GetString());
        Assert.False(_factory.Companies.Rows.ContainsKey(pro));
    }

    [Fact]
    public async Task Checkout_requires_terms_acceptance_on_the_server()
    {
        var user = Guid.NewGuid();
        var withoutTerms = await Client(user).PostAsJsonAsync("/api/checkout", new { plan = "pro", interval = "month" });
        Assert.Equal(HttpStatusCode.BadRequest, withoutTerms.StatusCode);
        Assert.Equal("TERMS_REQUIRED", (await withoutTerms.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.DoesNotContain(_factory.Stripe.Created, c => c.UserId == user.ToString());

        var ok = await Client(user).PostAsJsonAsync("/api/checkout", new { plan = "pro", interval = "month", acceptTerms = true });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var created = _factory.Stripe.Created.Single(c => c.UserId == user.ToString());
        Assert.NotNull(created.TermsAcceptedAt);
        Assert.Equal(2900, created.UnitAmount);
    }

    [Fact]
    public async Task Billing_portal_uses_the_callers_own_customer()
    {
        var paying = Guid.NewGuid();
        _factory.Subscriptions.SetTier(paying, "pro", DateTimeOffset.UtcNow.AddDays(10)); // customer cus_1 in the fake
        var ok = await Client(paying).PostAsync("/api/billing/portal", null);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.StartsWith("https://billing.stripe.com/", (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("url").GetString());
        Assert.Contains(_factory.Stripe.PortalSessions, s => s.Customer == "cus_1" && s.ReturnUrl.EndsWith("/account"));

        var free = await Client(Guid.NewGuid()).PostAsync("/api/billing/portal", null);
        Assert.Equal(HttpStatusCode.NotFound, free.StatusCode);
        Assert.Equal("NO_CUSTOMER", (await free.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var anon = await _factory.CreateClient().PostAsync("/api/billing/portal", null);
        Assert.Equal(HttpStatusCode.Unauthorized, anon.StatusCode);
    }
}
