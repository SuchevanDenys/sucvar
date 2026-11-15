using Microsoft.Extensions.Logging;
using Sucvar.Application;
using Sucvar.Application.Procurement;

namespace Sucvar.Infrastructure.Persistence;

/// <summary>
/// `projects.procurement_items` (migration 006) accessed with raw SQL and in SEPARATE statements, so every
/// existing query keeps working on databases where the column does not exist yet (42703 → "not migrated").
/// </summary>
internal static class ProcurementColumn
{
    /// <summary>The stored JSON of one project (owner filter optional — public reads already checked is_public).</summary>
    public static async Task<string?> ReadAsync(SucvarDbContext db, string projectId, Guid? ownerId, ILogger logger, CancellationToken ct)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, """
                select p.procurement_items::text
                  from public.projects p
                 where p.id = @id and (@owner::uuid is null or p.user_id = @owner)
                """, ct, ("id", projectId), ("owner", ownerId));
            var value = await cmd.ExecuteScalarAsync(ct);
            return value is string s ? s : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (!PgErrors.IsMissingColumn(ex)) logger.LogWarning(ex, "[SUCVAR] procurement_items (citire)");
            return null;
        }
    }

    /// <summary>All stored lists of an owner's projects (id → JSON); empty before migration 006.</summary>
    public static async Task<Dictionary<string, string>> ReadManyAsync(SucvarDbContext db, Guid ownerId, IReadOnlyCollection<string> ids, ILogger logger, CancellationToken ct)
    {
        var map = new Dictionary<string, string>();
        if (ids.Count == 0) return map;
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, """
                select p.id, p.procurement_items::text
                  from public.projects p
                 where p.user_id = @owner and p.id = any(@ids) and p.procurement_items is not null
                """, ct, ("owner", ownerId), ("ids", ids.ToArray()));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                if (!r.IsDBNull(1)) map[r.GetString(0)] = r.GetString(1);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (!PgErrors.IsMissingColumn(ex)) logger.LogWarning(ex, "[SUCVAR] procurement_items (listă)");
        }
        return map;
    }
}

public sealed class ProcurementRepository(SucvarDbContext db, ILogger<ProcurementRepository> logger) : IProcurementRepository
{
    public async Task<ProjectProcurementSource?> GetAsync(Guid userId, string projectId, CancellationToken ct = default)
    {
        try
        {
            ProjectProcurementSource source;
            await using (var cmd = await ProjectSql.CommandAsync(db, """
                select p.id, p.mode, p.space_type, p.style_id, p.dimensions::text as dimensions
                  from public.projects p
                 where p.id = @id and p.user_id = @owner
                """, ct, ("id", projectId), ("owner", userId)))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                if (!await r.ReadAsync(ct)) return null;
                source = new ProjectProcurementSource(r.GetString(0), ProjectSql.Str(r, "mode"), ProjectSql.Str(r, "space_type"),
                    ProjectSql.Str(r, "style_id"), ProjectSql.Str(r, "dimensions"), null);
            }
            return source with { ProcurementItemsJson = await ProcurementColumn.ReadAsync(db, projectId, userId, logger, ct) };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire materiale proiect", logger);
        }
    }

    public async Task<bool> SaveAsync(Guid userId, string projectId, string itemsJson, CancellationToken ct = default)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, """
                update public.projects p
                   set procurement_items = @items::jsonb
                 where p.id = @id and p.user_id = @owner
                """, ct, ("items", itemsJson), ("id", projectId), ("owner", userId));
            return await cmd.ExecuteNonQueryAsync(ct) > 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (PgErrors.IsMissingColumn(ex)) return false; // migration 006 not applied: the list is still returned (computed)
            throw PgErrors.ToAppException(ex, "salvare materiale proiect", logger);
        }
    }
}
