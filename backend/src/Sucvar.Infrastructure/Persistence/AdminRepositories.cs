using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Sucvar.Application;
using Sucvar.Application.Admin;
using Sucvar.Domain.Admin;
using Sucvar.Domain.Portal;

namespace Sucvar.Infrastructure.Persistence;

/// <summary>Shared SQL fragments and helpers for the admin repositories (migration 005).</summary>
internal static class AdminSql
{
    public const string MigrationMessage =
        "Baza de date nu are încă migrarea 005 (panou admin). Rulează backend/db/migrations/005_admin_panel.sql în Supabase SQL Editor.";

    private const string TierNorm = "lower(trim(coalesce(pr.subscription_tier, '')))";
    private const string Expired = "(pr.current_period_end is not null and pr.current_period_end < @now)";

    /// <summary>SQL twin of PlanTiers.ResolveEffectiveTier (normalizeTier + expired paid period ⇒ starter).</summary>
    public const string EffectiveTier =
        "(case when " + TierNorm + " in ('agency', 'enterprise', 'business') and not " + Expired + " then 'agency'" +
        " when " + TierNorm + " in ('pro', 'professional') and not " + Expired + " then 'pro'" +
        " else 'starter' end)";

    public const string QuotaSince = "greatest(@month, coalesce(pr.quota_reset_at, @month))";

    /// <summary>ILIKE pattern with %, _ and \ escaped (the search box is untrusted input).</summary>
    public static string Contains(string search) =>
        "%" + search.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    public static AppException Translate(Exception ex, string what, ILogger logger) =>
        PgErrors.IsMissingColumn(ex) || PgErrors.IsMissingTable(ex)
            ? new AppException(503, "MIGRATION_REQUIRED", MigrationMessage)
            : PgErrors.ToAppException(ex, what, logger);

    public static async Task InsertAuditAsync(SucvarDbContext db, NpgsqlTransaction tx, AuditEntry entry, CancellationToken ct)
    {
        await using var cmd = await ProjectSql.CommandAsync(db, """
            insert into public.admin_audit_logs (admin_user_id, admin_email, action, target_type, target_id, details)
            values (@admin, @email, @action, @target_type, @target_id, @details::jsonb)
            """, ct,
            ("admin", entry.AdminUserId), ("email", entry.AdminEmail), ("action", entry.Action),
            ("target_type", entry.TargetType), ("target_id", entry.TargetId), ("details", entry.DetailsJson));
        cmd.Transaction = tx;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public static async Task<NpgsqlTransaction> BeginAsync(SucvarDbContext db, CancellationToken ct)
    {
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync(ct);
        return await connection.BeginTransactionAsync(ct);
    }
}

/// <summary>profiles.role / is_banned / bonus credits — read on every guarded request and by the AdminOnly policy.</summary>
public sealed class AccountStatusRepository(SucvarDbContext db, ILogger<AccountStatusRepository> logger) : IAccountStatusRepository
{
    public async Task<AccountStatus> GetAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, """
                select role, is_banned, banned_reason, bonus_generations, quota_reset_at from public.profiles where id = @id
                """, ct, ("id", userId));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return AccountStatus.Default;
            return new AccountStatus(
                ProjectSql.Str(r, "role") is { } role && Roles.IsValid(role) ? role : Roles.User,
                !r.IsDBNull(1) && r.GetBoolean(1),
                ProjectSql.Str(r, "banned_reason"),
                r.IsDBNull(3) ? 0 : r.GetInt32(3),
                ProjectSql.Date(r, "quota_reset_at"),
                true);
        }
        catch (Exception ex) when (PgErrors.IsMissingColumn(ex))
        {
            return AccountStatus.NotMigrated; // 005 not applied: nobody is admin, nobody is banned
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire rol cont", logger);
        }
    }
}

public sealed class AppSettingsRepository(SucvarDbContext db, ILogger<AppSettingsRepository> logger) : IAppSettingsRepository
{
    public async Task<IReadOnlyDictionary<string, string>?> GetAllAsync(CancellationToken ct = default)
    {
        try
        {
            var rows = await db.AppSettings.AsNoTracking().ToListAsync(ct);
            return rows.ToDictionary(x => x.Key, x => x.Value);
        }
        catch (Exception ex) when (PgErrors.IsMissingTable(ex))
        {
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire app_settings", logger);
        }
    }

    public async Task SaveAsync(IReadOnlyDictionary<string, string> values, Guid adminUserId, AuditEntry audit, CancellationToken ct = default)
    {
        try
        {
            await using var tx = await AdminSql.BeginAsync(db, ct);
            foreach (var (key, value) in values)
            {
                await using var cmd = await ProjectSql.CommandAsync(db, """
                    insert into public.app_settings (key, value, updated_at, updated_by) values (@key, @value::jsonb, now(), @by)
                    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
                    """, ct, ("key", key), ("value", value), ("by", adminUserId));
                cmd.Transaction = tx;
                await cmd.ExecuteNonQueryAsync(ct);
            }
            await AdminSql.InsertAuditAsync(db, tx, audit, ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not AppException)
        {
            throw AdminSql.Translate(ex, "salvare app_settings", logger);
        }
    }
}

public sealed class AdminRepository(SucvarDbContext db, ILogger<AdminRepository> logger) : IAdminRepository
{
    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        await using var cmd = await ProjectSql.CommandAsync(db, "select 1", ct);
        return (int)(await cmd.ExecuteScalarAsync(ct) ?? 0) == 1;
    }

    public async Task<AdminOverviewCounts> GetOverviewCountsAsync(DateTimeOffset now, DateTimeOffset monthStart, DateTimeOffset dayStart, CancellationToken ct = default)
    {
        try
        {
            // Paying = effective paid tier backed by a Stripe subscription (manual grants are not revenue).
            await using var cmd = await ProjectSql.CommandAsync(db, $"""
                with t as (
                  select pr.created_at, pr.is_banned, pr.role, {AdminSql.EffectiveTier} as tier,
                         (coalesce(pr.stripe_subscription_id, '') <> '') as paying,
                         (pr.billing_interval = 'year') as yearly
                    from public.profiles pr
                )
                select (select count(*)::int from t),
                       (select count(*)::int from t where created_at >= @now - interval '30 days'),
                       (select count(*)::int from t where is_banned),
                       (select count(*)::int from t where role = 'admin'),
                       (select count(*)::int from t where tier = 'starter'),
                       (select count(*)::int from t where tier = 'pro'),
                       (select count(*)::int from t where tier = 'agency'),
                       (select count(*)::int from t where tier = 'pro' and paying and not yearly),
                       (select count(*)::int from t where tier = 'pro' and paying and yearly),
                       (select count(*)::int from t where tier = 'agency' and paying and not yearly),
                       (select count(*)::int from t where tier = 'agency' and paying and yearly),
                       (select count(*)::int from public.projects),
                       (select count(*)::int from public.projects where is_public),
                       (select count(*)::int from public.b2b_estimates)
                """, ct, ("now", now.ToUniversalTime()));
            int[] c;
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                await r.ReadAsync(ct);
                c = Enumerable.Range(0, 14).Select(r.GetInt32).ToArray();
            }

            int today = 0, month = 0, total = 0;
            try
            {
                await using var renders = await ProjectSql.CommandAsync(db, """
                    select count(*) filter (where created_at >= @day)::int,
                           count(*) filter (where created_at >= @month)::int,
                           count(*)::int
                      from public.ai_generations
                    """, ct, ("day", dayStart.ToUniversalTime()), ("month", monthStart.ToUniversalTime()));
                await using var rr = await renders.ExecuteReaderAsync(ct);
                await rr.ReadAsync(ct);
                (today, month, total) = (rr.GetInt32(0), rr.GetInt32(1), rr.GetInt32(2));
            }
            catch (Exception ex) when (PgErrors.IsMissingTable(ex))
            {
                // ai_generations missing (old database): renders stay 0
            }

            return new AdminOverviewCounts(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10],
                today, month, total, c[11], c[12], c[13]);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw AdminSql.Translate(ex, "statistici admin", logger);
        }
    }

    // ── Users ──────────────────────────────────────────────────────────────────

    private const string UserColumns = $"""
        pr.id, pr.email, pr.full_name, cp.name as company_name, pr.subscription_tier, pr.billing_interval, pr.current_period_end,
        coalesce(pr.cancel_at_period_end, false) as cancel_at_period_end,
        (coalesce(pr.stripe_subscription_id, '') <> '') as has_subscription,
        pr.role, pr.is_banned, pr.banned_reason, pr.bonus_generations, pr.quota_reset_at,
        greatest(
          (select count(*)::int from public.projects p where p.user_id = pr.id and {ProjectSql.CreatedAt} >= {AdminSql.QuotaSince}),
          (select count(*)::int from public.ai_generations g where g.user_id = pr.id and g.created_at >= {AdminSql.QuotaSince})
        ) as generations_used,
        (select count(*)::int from public.projects p where p.user_id = pr.id) as projects_count,
        pr.created_at
        """;

    private static AdminUserRow ReadUser(NpgsqlDataReader r) => new(
        r.GetGuid(0),
        ProjectSql.Str(r, "email"),
        ProjectSql.Str(r, "full_name"),
        ProjectSql.Str(r, "company_name"),
        ProjectSql.Str(r, "subscription_tier"),
        ProjectSql.Str(r, "billing_interval"),
        ProjectSql.Date(r, "current_period_end"),
        r.GetBoolean(7),
        r.GetBoolean(8),
        ProjectSql.Str(r, "role") ?? Roles.User,
        !r.IsDBNull(10) && r.GetBoolean(10),
        ProjectSql.Str(r, "banned_reason"),
        r.IsDBNull(12) ? 0 : r.GetInt32(12),
        ProjectSql.Date(r, "quota_reset_at"),
        r.GetInt32(14),
        r.GetInt32(15),
        ProjectSql.Date(r, "created_at"));

    public async Task<PagedResult<AdminUserRow>> ListUsersAsync(AdminUserQuery query, DateTimeOffset now, DateTimeOffset monthStart, CancellationToken ct = default)
    {
        try
        {
            // Only fixed SQL fragments are concatenated; every value is a parameter.
            var where = new List<string>();
            var parameters = new List<(string, object?)> { ("now", now.ToUniversalTime()), ("month", monthStart.ToUniversalTime()) };
            if (query.Search is { Length: > 0 } q)
            {
                where.Add("(pr.email ilike @pattern or pr.full_name ilike @pattern or cp.name ilike @pattern or pr.id::text = @exact)");
                parameters.Add(("pattern", AdminSql.Contains(q)));
                parameters.Add(("exact", q.ToLowerInvariant()));
            }
            if (query.Plan is { } plan) { where.Add($"{AdminSql.EffectiveTier} = @plan"); parameters.Add(("plan", plan)); }
            if (query.Role is { } role) { where.Add("pr.role = @role"); parameters.Add(("role", role)); }
            if (query.Banned is { } banned) { where.Add("pr.is_banned = @banned"); parameters.Add(("banned", banned)); }
            var filter = where.Count == 0 ? "" : "where " + string.Join(" and ", where);
            const string from = "from public.profiles pr left join public.company_profiles cp on cp.user_id = pr.id";

            int total;
            await using (var count = await ProjectSql.CommandAsync(db, $"select count(*)::int {from} {filter}", ct, parameters.ToArray()))
                total = (int)(await count.ExecuteScalarAsync(ct) ?? 0);

            parameters.Add(("limit", query.PageSize));
            parameters.Add(("offset", (query.Page - 1) * query.PageSize));
            await using var cmd = await ProjectSql.CommandAsync(db, $"""
                select {UserColumns} {from} {filter}
                 order by pr.created_at desc nulls last, pr.id
                 limit @limit offset @offset
                """, ct, parameters.ToArray());
            await using var r = await cmd.ExecuteReaderAsync(ct);
            var items = new List<AdminUserRow>();
            while (await r.ReadAsync(ct)) items.Add(ReadUser(r));
            return new PagedResult<AdminUserRow>(items, total, query.Page, query.PageSize);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw AdminSql.Translate(ex, "listare utilizatori", logger);
        }
    }

    public async Task<AdminUserRow?> GetUserAsync(Guid userId, DateTimeOffset monthStart, CancellationToken ct = default)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db, $"""
                select {UserColumns}
                  from public.profiles pr left join public.company_profiles cp on cp.user_id = pr.id
                 where pr.id = @id
                """, ct, ("id", userId), ("month", monthStart.ToUniversalTime()));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            return await r.ReadAsync(ct) ? ReadUser(r) : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw AdminSql.Translate(ex, "citire utilizator", logger);
        }
    }

    public async Task ApplyUserChangesAsync(Guid userId, AdminUserChanges changes, IReadOnlyList<AuditEntry> audit, CancellationToken ct = default)
    {
        var sets = new List<string>();
        var parameters = new List<(string, object?)> { ("id", userId) };
        if (changes.Tier is { } tier)
        {
            sets.Add("subscription_tier = @tier");
            parameters.Add(("tier", tier));
            if (tier == Sucvar.Domain.Plans.PlanTiers.Starter)
                sets.Add("current_period_end = null, billing_interval = null, cancel_at_period_end = false");
            else if (changes.ClearPeriod)
                sets.Add("current_period_end = null");
        }
        if (changes.QuotaDelta is { } delta)
        {
            sets.Add("bonus_generations = greatest(0, least(100000, bonus_generations + @delta))");
            parameters.Add(("delta", delta));
        }
        if (changes.ResetQuota) sets.Add("quota_reset_at = now()");
        if (changes.Role is { } role) { sets.Add("role = @role"); parameters.Add(("role", role)); }
        if (changes.IsBanned is { } banned)
        {
            sets.Add("is_banned = @banned, banned_reason = @reason");
            parameters.Add(("banned", banned));
            parameters.Add(("reason", banned ? changes.BannedReason : null));
        }
        if (sets.Count == 0) return;

        try
        {
            await using var tx = await AdminSql.BeginAsync(db, ct);
            await using (var cmd = await ProjectSql.CommandAsync(db, $"update public.profiles set {string.Join(", ", sets)} where id = @id", ct, parameters.ToArray()))
            {
                cmd.Transaction = tx;
                if (await cmd.ExecuteNonQueryAsync(ct) == 0)
                {
                    await tx.RollbackAsync(ct);
                    throw new AppException(404, "NOT_FOUND", "Utilizatorul nu există.");
                }
            }
            foreach (var entry in audit) await AdminSql.InsertAuditAsync(db, tx, entry, ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not AppException)
        {
            throw AdminSql.Translate(ex, "actualizare utilizator", logger);
        }
    }

    // ── Public portals ─────────────────────────────────────────────────────────

    public async Task<PagedResult<AdminPublicProject>> ListPublicProjectsAsync(string? search, int page, int pageSize, CancellationToken ct = default)
    {
        try
        {
            var filter = "where p.is_public";
            var parameters = new List<(string, object?)>();
            if (search is { Length: > 0 } q)
            {
                filter += " and (p.title ilike @pattern or p.user_email ilike @pattern or pr.email ilike @pattern or p.id = @exact)";
                parameters.Add(("pattern", AdminSql.Contains(q)));
                parameters.Add(("exact", q));
            }
            const string from = "from public.projects p left join public.profiles pr on pr.id = p.user_id";

            int total;
            await using (var count = await ProjectSql.CommandAsync(db, $"select count(*)::int {from} {filter}", ct, parameters.ToArray()))
                total = (int)(await count.ExecuteScalarAsync(ct) ?? 0);

            parameters.Add(("limit", pageSize));
            parameters.Add(("offset", (page - 1) * pageSize));
            await using var cmd = await ProjectSql.CommandAsync(db, $"""
                select p.id, p.title, p.mode, p.user_id, coalesce(nullif(p.user_email, ''), pr.email) as owner_email,
                       p.client_status, p.client_feedback, p.client_reviewed_at, {ProjectSql.CreatedAtIso} as created_iso,
                       coalesce(nullif(p.generated_image, ''), nullif(p.original_image, '')) as thumbnail
                  {from} {filter}
                 order by p.updated_at desc nulls last, p.id
                 limit @limit offset @offset
                """, ct, parameters.ToArray());
            await using var r = await cmd.ExecuteReaderAsync(ct);
            var items = new List<AdminPublicProject>();
            while (await r.ReadAsync(ct))
            {
                var title = ProjectSql.Str(r, "title")?.Trim();
                items.Add(new AdminPublicProject(
                    r.GetString(0),
                    string.IsNullOrEmpty(title) ? "Proiect SUCVAR" : title,
                    ProjectSql.Str(r, "mode") ?? "interiors",
                    ProjectSql.Str(r, "user_id"),
                    ProjectSql.Str(r, "owner_email"),
                    ClientStatuses.ToClientStatus(ProjectSql.Str(r, "client_status")),
                    ProjectSql.Str(r, "client_feedback") is { Length: > 0 } f ? f : null,
                    PgErrors.Iso(ProjectSql.Date(r, "client_reviewed_at")),
                    r.GetString(8),
                    ProjectSql.Str(r, "thumbnail")));
            }
            return new PagedResult<AdminPublicProject>(items, total, page, pageSize);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw AdminSql.Translate(ex, "listare portaluri publice", logger);
        }
    }

    public async Task<bool> UnpublishProjectAsync(string projectId, AuditEntry audit, CancellationToken ct = default)
    {
        try
        {
            await using var tx = await AdminSql.BeginAsync(db, ct);
            string? title, owner;
            await using (var cmd = await ProjectSql.CommandAsync(db, """
                update public.projects set is_public = false where id = @id and is_public returning title, user_email
                """, ct, ("id", projectId)))
            {
                cmd.Transaction = tx;
                await using var r = await cmd.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct))
                {
                    await r.DisposeAsync();
                    await tx.RollbackAsync(ct);
                    return false;
                }
                (title, owner) = (ProjectSql.Str(r, "title"), ProjectSql.Str(r, "user_email"));
            }

            var details = JsonNode.Parse(audit.DetailsJson) as JsonObject ?? new JsonObject();
            details["title"] = title;
            details["ownerEmail"] = owner;
            await AdminSql.InsertAuditAsync(db, tx, audit with { DetailsJson = details.ToJsonString() }, ct);
            await tx.CommitAsync(ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not AppException)
        {
            throw AdminSql.Translate(ex, "dezactivare link public", logger);
        }
    }

    // ── Audit log ──────────────────────────────────────────────────────────────

    public async Task<PagedResult<AuditLogEntry>> ListAuditLogsAsync(int page, int pageSize, CancellationToken ct = default)
    {
        try
        {
            var total = await db.AdminAuditLogs.AsNoTracking().CountAsync(ct);
            var rows = await db.AdminAuditLogs.AsNoTracking()
                .OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id)
                .Skip((page - 1) * pageSize).Take(pageSize)
                .ToListAsync(ct);
            var items = rows.Select(x => new AuditLogEntry(
                x.Id.ToString(), x.AdminUserId.ToString(), x.AdminEmail, x.Action, x.TargetType, x.TargetId,
                ParseDetails(x.Details), PgErrors.Iso(x.CreatedAt))).ToList();
            return new PagedResult<AuditLogEntry>(items, total, page, pageSize);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw AdminSql.Translate(ex, "jurnal admin", logger);
        }
    }

    private static JsonElement ParseDetails(string json)
    {
        try { return JsonDocument.Parse(json).RootElement.Clone(); }
        catch (JsonException) { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }
}
