using Microsoft.Extensions.Logging.Abstractions;
using Sucvar.Application;
using Sucvar.Application.Portal;
using Sucvar.Domain.Portal;
using Sucvar.Tests.Support;

namespace Sucvar.Tests;

/// <summary>
/// Regression for the broken /p/[id] link: in the real (pre-001) database `projects` has nullable mode,
/// space_type, style_id, dimensions, total_budget and a TEXT created_at. The projection must cope with all of it.
/// </summary>
public class PublicProjectServiceTests
{
    private sealed class NullColumnsRepository : IPortalRepository
    {
        public Task<PublicProjectRow?> GetPublicProjectAsync(string projectId, CancellationToken ct = default) =>
            Task.FromResult<PublicProjectRow?>(projectId != "legacy" ? null : new PublicProjectRow(
                new PublicProjectSource("legacy", null, null, null, null, null, null, null, 0, "", null, null), null));
        public Task<PublicEstimateSource?> GetPublicEstimateAsync(Guid ownerId, string projectId, CancellationToken ct = default) => throw new InvalidOperationException("no owner → never called");
        public Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(Guid userId, string? projectId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ProjectSharing?> SetPublicAsync(Guid userId, string projectId, bool isPublic, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string? feedback, DateTimeOffset now, CancellationToken ct = default) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Legacy_rows_with_null_columns_are_projected_with_safe_defaults()
    {
        var service = new PortalService(new NullColumnsRepository(), TimeProvider.System, NullLogger<PortalService>.Instance);
        var p = await service.GetPublicProjectAsync("legacy");

        Assert.NotNull(p);
        Assert.Equal(("interiors", "kitchen", "scandinavian", "Proiect SUCVAR"), (p!.Mode, p.SpaceType, p.StyleId, p.Title));
        Assert.Equal(20, p.AreaM2);            // default 4 × 5 m from sanitizeDimensions
        Assert.Equal(0, p.ClientTotal);
        Assert.False(p.VatIncluded);
        Assert.Equal("pending", p.ClientStatus);
        Assert.Equal("SUC-LEGACY", p.Reference);
        Assert.Null(await service.GetPublicProjectAsync("missing"));
    }

    [Fact]
    public async Task Owner_estimate_failures_do_not_break_the_public_page()
    {
        var portal = new FakePortalRepositoryThrowingEstimates();
        var service = new PortalService(portal, TimeProvider.System, NullLogger<PortalService>.Instance);
        var p = await service.GetPublicProjectAsync("p1");
        Assert.NotNull(p);
        Assert.Empty(p!.Materials);
    }

    private sealed class FakePortalRepositoryThrowingEstimates : IPortalRepository
    {
        public Task<PublicProjectRow?> GetPublicProjectAsync(string projectId, CancellationToken ct = default) =>
            Task.FromResult<PublicProjectRow?>(new PublicProjectRow(
                new PublicProjectSource("p1", "T", "gardens", "residential garden", "modern", """{"width":10,"length":12}""", null, null, 500, "2026-11-15T12:25:50.276000+00:00", "approved", null),
                Guid.NewGuid()));
        public Task<PublicEstimateSource?> GetPublicEstimateAsync(Guid ownerId, string projectId, CancellationToken ct = default) => throw new AppException(500, "DB_ERROR", "x");
        public Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(Guid userId, string? projectId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ProjectSharing?> SetPublicAsync(Guid userId, string projectId, bool isPublic, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string? feedback, DateTimeOffset now, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
