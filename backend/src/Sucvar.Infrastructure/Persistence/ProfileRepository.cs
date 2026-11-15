using Sucvar.Domain.Procurement;
using Microsoft.Extensions.Logging;
using Npgsql;
using Sucvar.Application;
using Sucvar.Domain.Portal;
using Sucvar.Domain.Profile;

namespace Sucvar.Infrastructure.Persistence;

/// <summary>
/// `profiles` + aggregates for /api/profile. Raw SQL on purpose: the columns from migration 004
/// (avatar_url, default_*) may not exist yet — reads then degrade to defaults (Migrated = false)
/// instead of failing the whole page; writes answer 503 MIGRATION_REQUIRED.
/// </summary>
public sealed class ProfileRepository(SucvarDbContext db, ILogger<ProfileRepository> logger) : IProfileRepository
{
    private const string MigrationMessage =
        "Baza de date nu are încă migrarea 004 (detalii profil). Rulează backend/db/migrations/004_user_profile_details.sql în Supabase SQL Editor.";

    public async Task<ProfileRow?> GetAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, """
                select full_name, email, avatar_url, created_at, default_currency, default_vat_rate, default_margin_percent
                  from public.profiles where id = @id
                """, ct, ("id", userId));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return null;
            return new ProfileRow(ProjectSql.Str(r, "full_name"), ProjectSql.Str(r, "email"), ProjectSql.Str(r, "avatar_url"),
                ProjectSql.Date(r, "created_at"),
                new ProfileDefaults(ProjectSql.Str(r, "default_currency") ?? "EUR", (double)r.GetDecimal(5), (double)r.GetDecimal(6)),
                true);
        }
        catch (Exception ex) when (PgErrors.IsMissingColumn(ex))
        {
            // Migration 004 not applied yet: identity still works, defaults fall back
            await using var cmd = await ProjectSql.CommandAsync(db, "select full_name, email, created_at from public.profiles where id = @id", ct, ("id", userId));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return null;
            return new ProfileRow(ProjectSql.Str(r, "full_name"), ProjectSql.Str(r, "email"), null, ProjectSql.Date(r, "created_at"), ProfileDefaults.Initial, false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire profil", logger);
        }
    }

    public async Task UpdateAsync(Guid userId, string email, ProfileUpdate update, CancellationToken ct = default)
    {
        var sets = new List<string>();
        var parameters = new List<(string, object?)> { ("id", userId), ("email", email.ToLowerInvariant()) };
        if (update.SetFullName) { sets.Add("full_name = @full_name"); parameters.Add(("full_name", update.FullName)); }
        if (update.SetAvatar) { sets.Add("avatar_url = @avatar_url"); parameters.Add(("avatar_url", update.AvatarUrl)); }
        if (update.Defaults is { } d)
        {
            sets.Add("default_currency = @currency, default_vat_rate = @vat, default_margin_percent = @margin");
            parameters.Add(("currency", d.Currency));
            parameters.Add(("vat", (decimal)d.VatRate));
            parameters.Add(("margin", (decimal)d.MarginPercent));
        }
        if (sets.Count == 0) return;

        try
        {
            // The profile row normally exists (trigger handle_new_user); create it for older accounts.
            // Only explicit columns are written — never subscription_tier / Stripe ids (server-managed).
            await using var cmd = await ProjectSql.CommandAsync(db, $"""
                insert into public.profiles (id, email) values (@id, @email) on conflict (id) do nothing;
                update public.profiles set {string.Join(", ", sets)} where id = @id;
                """, ct, parameters.ToArray());
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (PgErrors.IsMissingColumn(ex))
        {
            throw new AppException(503, "MIGRATION_REQUIRED", MigrationMessage);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "actualizare profil", logger);
        }
    }

    public async Task<ProfileStats> GetStatsAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, """
                select (select count(*)::int from public.projects where user_id = @id),
                       (select count(*)::int from public.projects where user_id = @id and is_public),
                       (select count(*)::int from public.b2b_estimates where user_id = @id)
                """, ct, ("id", userId));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            await r.ReadAsync(ct);
            return new ProfileStats(r.GetInt32(0), r.GetInt32(1), r.GetInt32(2));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "statistici profil", logger);
        }
    }

    public async Task<IReadOnlyList<ProfileProject>> ListProjectsAsync(Guid userId, int limit, CancellationToken ct = default)
    {
        try
        {
            // No image columns are transferred: only a has_image flag (images are hundreds of KB each).
            await using var cmd = await ProjectSql.CommandAsync(db, $"""
                select p.id, p.title, p.mode, p.space_type, p.style_id, {ProjectSql.CreatedAtIso} as created_iso,
                       (coalesce(p.generated_image, '') <> '') as has_image,
                       p.is_public, p.client_status, p.client_feedback, p.client_reviewed_at,
                       p.dimensions::text as dimensions
                  from public.projects p
                 where p.user_id = @id
                 order by {ProjectSql.CreatedAt} desc nulls last
                 limit @limit
                """, ct, ("id", userId), ("limit", Math.Clamp(limit, 1, 200)));
            var list = new List<ProfileProject>();
            var dims = new Dictionary<string, string?>();
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct))
            {
                var title = ProjectSql.Str(r, "title")?.Trim();
                dims[r.GetString(0)] = ProjectSql.Str(r, "dimensions");
                list.Add(new ProfileProject(
                    r.GetString(0),
                    string.IsNullOrEmpty(title) ? "Proiect SUCVAR" : title,
                    ProjectSql.Str(r, "mode") ?? "interiors",
                    ProjectSql.Str(r, "space_type") ?? "",
                    ProjectSql.Str(r, "style_id") ?? "",
                    r.GetString(5),
                    r.GetBoolean(6),
                    !r.IsDBNull(7) && r.GetBoolean(7),
                    ClientStatuses.ToClientStatus(ProjectSql.Str(r, "client_status")),
                    ProjectSql.Str(r, "client_feedback") is { Length: > 0 } f ? f : null,
                    PgErrors.Iso(ProjectSql.Date(r, "client_reviewed_at"))));
            }

            // Material lists: saved ones (migration 006) or recomputed from the saved Studio parameters
            var stored = await ProcurementColumn.ReadManyAsync(db, userId, dims.Keys, logger, ct);
            return list.Select(p =>
            {
                var (items, persisted) = ProcurementStore.Resolve(stored.GetValueOrDefault(p.Id), p.Mode, p.SpaceType, p.StyleId, dims.GetValueOrDefault(p.Id));
                return p with { ProcurementItems = items, ProcurementTotal = ProcurementStore.Total(items), ProcurementPersisted = persisted };
            }).ToList();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "listare proiecte profil", logger);
        }
    }
}
