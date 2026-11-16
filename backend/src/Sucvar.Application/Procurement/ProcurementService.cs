using Sucvar.Domain.Procurement;

namespace Sucvar.Application.Procurement;

/// <summary>Owner-side row needed to resolve a project's material list (no images, no client data).</summary>
public sealed record ProjectProcurementSource(
    string Id,
    string? Mode,
    string? SpaceType,
    string? StyleId,
    string? DimensionsJson,
    string? ProcurementItemsJson);

public interface IProcurementRepository
{
    /// <summary>Only the caller's own project (user_id filter); null when missing or not theirs.</summary>
    Task<ProjectProcurementSource?> GetAsync(Guid userId, string projectId, CancellationToken ct = default);
    /// <summary>false when migration 006 is missing (nothing is written, never throws for that case).</summary>
    Task<bool> SaveAsync(Guid userId, string projectId, string itemsJson, CancellationToken ct = default);
}

/// <summary>GET/POST /api/projects/{id}/procurement response.</summary>
public sealed record ProjectProcurement(string ProjectId, IReadOnlyList<BomItem> Items, double Total, string Currency, bool Persisted);

/// <summary>
/// Archive material lists: the saved list when present, otherwise the deterministic Studio list
/// (backfill on demand persists it so older projects end up with the same data as new ones).
/// </summary>
public sealed class ProcurementService(IProcurementRepository repository)
{
    private static readonly AppException NotFound = new(404, "NOT_FOUND", "Proiectul nu există în cloud.");

    public async Task<ProjectProcurement> GetAsync(AuthUser user, string projectId, CancellationToken ct = default)
    {
        var row = await repository.GetAsync(user.Id, projectId, ct) ?? throw NotFound;
        var (items, persisted) = ProcurementStore.Resolve(row.ProcurementItemsJson, row.Mode, row.SpaceType, row.StyleId, row.DimensionsJson);
        return new ProjectProcurement(row.Id, items, ProcurementStore.Total(items), "EUR", persisted);
    }

    /// <summary>Recomputes the list from the saved project parameters and stores it (idempotent).</summary>
    public async Task<ProjectProcurement> BackfillAsync(AuthUser user, string projectId, CancellationToken ct = default)
    {
        var userId = user.Id;
        var row = await repository.GetAsync(userId, projectId, ct) ?? throw NotFound;
        var bom = ProcurementStore.Compute(row.Mode, row.SpaceType, row.StyleId, row.DimensionsJson);
        var persisted = await repository.SaveAsync(userId, projectId, ProcurementStore.Serialize(bom.Items), ct);
        return new ProjectProcurement(row.Id, bom.Items, bom.Total, bom.Currency, persisted);
    }
}
