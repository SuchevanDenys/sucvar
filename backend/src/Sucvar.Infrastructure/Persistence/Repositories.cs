using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Sucvar.Application;
using Sucvar.Domain;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Plans;
using Sucvar.Domain.Portal;

namespace Sucvar.Infrastructure.Persistence;

// Every repository connects with the server role (RLS bypassed), so EVERY query filters
// explicitly on user_id (ownership) — the same discipline as the original db.ts.

public sealed class SubscriptionRepository(SucvarDbContext db, ILogger<SubscriptionRepository> logger) : ISubscriptionRepository
{
    public async Task<ProfileRecord?> GetProfileAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            var p = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, ct);
            return p is null
                ? null
                : new ProfileRecord(p.Id.ToString(), string.IsNullOrEmpty(p.Email) ? null : p.Email, PlanTiers.NormalizeTier(p.SubscriptionTier),
                    NullIfEmpty(p.StripeCustomerId), NullIfEmpty(p.StripeSubscriptionId), p.CurrentPeriodEnd,
                    PlanTiers.NormalizeInterval(p.BillingInterval), p.CancelAtPeriodEnd == true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire profiles", logger);
        }
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;

    public async Task ActivateProfilePlanAsync(Guid userId, ActivationPatch patch, CancellationToken ct = default)
    {
        try
        {
            var profile = await db.Profiles.FirstOrDefaultAsync(x => x.Id == userId, ct);
            var isNew = profile is null;
            profile ??= new ProfileEntity { Id = userId };
            profile.SubscriptionTier = patch.Tier;
            if (!string.IsNullOrEmpty(patch.CustomerId)) profile.StripeCustomerId = patch.CustomerId;
            if (!string.IsNullOrEmpty(patch.SubscriptionId)) profile.StripeSubscriptionId = patch.SubscriptionId;
            if (patch.Period is { } period)
            {
                // Written only from Stripe's own period end; a sync without one keeps the stored date
                // (overwriting with null would make the paid plan never expire).
                if (period.CurrentPeriodEnd is { } end) profile.CurrentPeriodEnd = end.ToUniversalTime();
                else logger.LogWarning("[SUCVAR] Sincronizare fără current_period_end pentru {UserId}; se păstrează data existentă ({End}).",
                    userId, profile.CurrentPeriodEnd);
                profile.BillingInterval = period.Interval;
                profile.CancelAtPeriodEnd = period.CancelAtPeriodEnd;
            }
            if (isNew) db.Profiles.Add(profile); // account created before the trigger: the payment must not be lost
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not AppException)
        {
            throw PgErrors.ToAppException(ex, "actualizare profiles", logger);
        }
    }

    public async Task<string?> GetCurrentSubscriptionIdAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            return await db.Profiles.AsNoTracking().Where(x => x.Id == userId).Select(x => x.StripeSubscriptionId).FirstOrDefaultAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire stripe_subscription_id", logger);
        }
    }

    public async Task<string?> DowngradeBySubscriptionIdAsync(string subscriptionId, CancellationToken ct = default)
    {
        try
        {
            var rows = await db.Profiles.Where(x => x.StripeSubscriptionId == subscriptionId).ToListAsync(ct);
            foreach (var p in rows)
            {
                p.SubscriptionTier = PlanTiers.Starter;
                p.StripeSubscriptionId = null;
                p.CurrentPeriodEnd = null;
                p.BillingInterval = null;
                p.CancelAtPeriodEnd = false;
            }
            await db.SaveChangesAsync(ct);
            return rows.Count > 0 ? rows[0].Id.ToString() : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "downgrade profiles", logger);
        }
    }
}

public sealed class UsageRepository(SucvarDbContext db, ILogger<UsageRepository> logger) : IUsageRepository
{
    public async Task<int> CountProjectsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default)
    {
        try
        {
            // created_at may be TEXT in pre-001 databases: compare through ProjectSql.CreatedAt
            await using var cmd = await ProjectSql.CommandAsync(db,
                $"select count(*)::int from public.projects p where p.user_id = @user and {ProjectSql.CreatedAt} >= @since", ct,
                ("user", userId), ("since", since.ToUniversalTime()));
            return (int)(await cmd.ExecuteScalarAsync(ct) ?? 0);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "numărare projects", logger);
        }
    }

    public async Task<int> CountGenerationsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default)
    {
        try
        {
            return await db.AiGenerations.AsNoTracking().CountAsync(x => x.UserId == userId && x.CreatedAt >= since, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (!PgErrors.IsMissingTable(ex)) logger.LogWarning(ex, "[SUCVAR] ai_generations nu a putut fi citit");
            return 0;
        }
    }

    public async Task LogGenerationAsync(Guid userId, string? provider, string? mode, CancellationToken ct = default)
    {
        try
        {
            db.AiGenerations.Add(new AiGenerationEntity { Id = Guid.NewGuid(), UserId = userId, Provider = provider, Mode = mode });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[SUCVAR] ai_generations nu a putut fi scris (tabel lipsă?)");
        }
    }
}

public sealed class EstimateRepository(SucvarDbContext db, ILogger<EstimateRepository> logger) : IEstimateRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static T ReadJson<T>(string? json, T fallback)
    {
        if (string.IsNullOrEmpty(json)) return fallback;
        try { return JsonSerializer.Deserialize<T>(json, Json) ?? fallback; }
        catch (JsonException) { return fallback; }
    }

    public static EstimateRecord ToRecord(B2bEstimateEntity e) => new(
        e.Id.ToString(),
        e.ProjectId,
        e.DocNo,
        e.Status,
        ReadJson(e.Client, new EstimateClient("", "", "", "", "", "", "")),
        e.Region,
        e.FinishLevel,
        (double)e.AreaM2,
        e.Crew,
        (double)e.ContingencyPct,
        (double)e.MarginPct,
        (double)e.VatPct,
        ReadJson<Dictionary<string, double>>(e.Scope, []),
        ReadJson<Dictionary<string, double>>(e.RateOverride, []),
        ReadJson<List<EstimateLineItem>>(e.LineItems, []),
        (double)e.Subtotal,
        (double)e.Total,
        IsoTime.Format(e.CreatedAt),
        IsoTime.Format(e.UpdatedAt));

    private static void Apply(B2bEstimateEntity e, Guid userId, EstimatePayload p)
    {
        e.UserId = userId;
        e.ProjectId = p.ProjectId;
        e.DocNo = p.DocNo;
        e.Status = p.Status;
        e.Client = JsonSerializer.Serialize(p.Client, Json);
        e.Region = p.Region;
        e.FinishLevel = p.FinishLevel;
        e.AreaM2 = (decimal)p.AreaM2;
        e.Crew = (int)p.Crew;
        e.ContingencyPct = (decimal)p.ContingencyPct;
        e.MarginPct = (decimal)p.MarginPct;
        e.VatPct = (decimal)p.VatPct;
        e.Scope = JsonSerializer.Serialize(p.Scope, Json);
        e.RateOverride = JsonSerializer.Serialize(p.RateOverride, Json);
        e.LineItems = JsonSerializer.Serialize(p.LineItems, Json);
        e.Subtotal = (decimal)p.Subtotal;
        e.Total = (decimal)p.Total;
    }

    public async Task<IReadOnlyList<EstimateRecord>> ListAsync(Guid userId, int limit, CancellationToken ct = default)
    {
        try
        {
            var rows = await db.B2bEstimates.AsNoTracking().Where(x => x.UserId == userId)
                .OrderByDescending(x => x.UpdatedAt).Take(limit).ToListAsync(ct);
            return rows.Select(ToRecord).ToList();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "listare b2b_estimates", logger);
        }
    }

    public async Task<Guid?> FindIdByProjectAsync(Guid userId, string projectId, CancellationToken ct = default)
    {
        try
        {
            return await db.B2bEstimates.AsNoTracking().Where(x => x.UserId == userId && x.ProjectId == projectId)
                .Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "căutare b2b_estimates", logger);
        }
    }

    public async Task<EstimateRecord> UpdateAsync(Guid id, Guid userId, EstimatePayload payload, CancellationToken ct = default)
    {
        try
        {
            var entity = await db.B2bEstimates.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId, ct)
                ?? throw new AppException(404, "NOT_FOUND", "Devizul nu există.");
            Apply(entity, userId, payload);
            await db.SaveChangesAsync(ct);
            return ToRecord(entity);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not AppException)
        {
            throw PgErrors.ToAppException(ex, "actualizare b2b_estimates", logger);
        }
    }

    public async Task<EstimateRecord> InsertAsync(Guid userId, EstimatePayload payload, CancellationToken ct = default)
    {
        try
        {
            var entity = new B2bEstimateEntity { Id = Guid.NewGuid() };
            Apply(entity, userId, payload);
            db.B2bEstimates.Add(entity);
            await db.SaveChangesAsync(ct);
            return ToRecord(entity);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "inserare b2b_estimates", logger);
        }
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid estimateId, CancellationToken ct = default)
    {
        try
        {
            return await db.B2bEstimates.Where(x => x.Id == estimateId && x.UserId == userId).ExecuteDeleteAsync(ct) > 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "ștergere b2b_estimates", logger);
        }
    }
}

public sealed class CompanyProfileRepository(SucvarDbContext db, ILogger<CompanyProfileRepository> logger) : ICompanyProfileRepository
{
    private static CompanyProfile ToDomain(CompanyProfileEntity e) =>
        new(e.Name, e.VatId, e.RegNo, e.Address, e.Iban, e.Bank, e.Email, e.Phone);

    public async Task<CompanyProfile?> GetAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            var e = await db.CompanyProfiles.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == userId, ct);
            return e is null ? null : ToDomain(e);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "citire company_profiles", logger);
        }
    }

    public async Task<CompanyProfile> UpsertAsync(Guid userId, CompanyProfile p, CancellationToken ct = default)
    {
        try
        {
            var e = await db.CompanyProfiles.FirstOrDefaultAsync(x => x.UserId == userId, ct);
            if (e is null) db.CompanyProfiles.Add(e = new CompanyProfileEntity { UserId = userId });
            (e.Name, e.VatId, e.RegNo, e.Address, e.Iban, e.Bank, e.Email, e.Phone) =
                (p.Name, p.VatId, p.RegNo, p.Address, p.Iban, p.Bank, p.Email, p.Phone);
            await db.SaveChangesAsync(ct);
            return ToDomain(e);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "salvare company_profiles", logger);
        }
    }
}

public sealed class PortalRepository(SucvarDbContext db, ILogger<PortalRepository> logger) : IPortalRepository
{
    private static ProjectSharing ToSharing(string id, bool isPublic, string? status, string? feedback, DateTimeOffset? reviewedAt) =>
        new(id, isPublic, ClientStatuses.ToClientStatus(status), string.IsNullOrEmpty(feedback) ? null : feedback, IsoTime.Format(reviewedAt));

    public async Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(Guid userId, string? projectId, CancellationToken ct = default)
    {
        try
        {
            await using var cmd = await ProjectSql.CommandAsync(db,
                $"""
                select p.id, p.is_public, p.client_status, p.client_feedback, p.client_reviewed_at
                  from public.projects p
                 where p.user_id = @user and (@project::text is null or p.id = @project)
                 order by {ProjectSql.CreatedAt} desc nulls last
                 limit 200
                """, ct, ("user", userId), ("project", string.IsNullOrEmpty(projectId) ? null : projectId));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            var items = new List<ProjectSharing>();
            while (await r.ReadAsync(ct))
            {
                items.Add(ToSharing(r.GetString(0), !r.IsDBNull(1) && r.GetBoolean(1), ProjectSql.Str(r, "client_status"),
                    ProjectSql.Str(r, "client_feedback"), ProjectSql.Date(r, "client_reviewed_at")));
            }
            return (true, items);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (PgErrors.IsMissingColumn(ex)) return (false, []);
            throw PgErrors.ToAppException(ex, "citire partajare projects", logger);
        }
    }

    public async Task<ProjectSharing?> SetPublicAsync(Guid userId, string projectId, bool isPublic, CancellationToken ct = default)
    {
        try
        {
            var affected = await db.Projects.Where(x => x.Id == projectId && x.UserId == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsPublic, isPublic), ct);
            if (affected == 0) return null;
            var r = await db.Projects.AsNoTracking().Where(x => x.Id == projectId && x.UserId == userId)
                .Select(x => new { x.Id, x.IsPublic, x.ClientStatus, x.ClientFeedback, x.ClientReviewedAt }).FirstAsync(ct);
            return ToSharing(r.Id, r.IsPublic, r.ClientStatus, r.ClientFeedback, r.ClientReviewedAt);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw PgErrors.ToAppException(ex, "actualizare is_public", logger);
        }
    }

    public async Task<PublicProjectRow?> GetPublicProjectAsync(string projectId, CancellationToken ct = default)
    {
        try
        {
            // Explicit column list: internal columns (user_email, client_feedback…) are never read.
            await using var cmd = await ProjectSql.CommandAsync(db,
                $"""
                select p.id, p.user_id, p.title, p.mode, p.space_type, p.style_id, p.dimensions::text as dimensions,
                       p.original_image, p.generated_image, p.total_budget, {ProjectSql.CreatedAtIso} as created_iso,
                       p.client_status, p.client_reviewed_at
                  from public.projects p
                 where p.id = @id and p.is_public
                """, ct, ("id", projectId));
            PublicProjectRow result;
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                if (!await r.ReadAsync(ct)) return null;
                var owner = r.IsDBNull(1) ? (Guid?)null : r.GetGuid(1);
                var budget = r.IsDBNull(9) ? 0 : (double)r.GetDecimal(9);
                result = new PublicProjectRow(
                new PublicProjectSource(r.GetString(0), ProjectSql.Str(r, "title"), ProjectSql.Str(r, "mode"), ProjectSql.Str(r, "space_type"),
                    ProjectSql.Str(r, "style_id"), ProjectSql.Str(r, "dimensions"), ProjectSql.Str(r, "original_image"),
                    ProjectSql.Str(r, "generated_image"), budget, r.GetString(10), ProjectSql.Str(r, "client_status"),
                    IsoTime.Format(ProjectSql.Date(r, "client_reviewed_at"))),
                owner);
            }
            // Separate, tolerant read: works before migration 006 (column missing → recomputed list)
            var procurement = await ProcurementColumn.ReadAsync(db, projectId, null, logger, ct);
            return result with { Source = result.Source with { ProcurementItemsJson = procurement } };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (PgErrors.IsMissingColumn(ex)) return null; // unmigrated DB: nothing is public
            throw PgErrors.ToAppException(ex, "citire proiect public", logger);
        }
    }

    public async Task<PublicEstimateSource?> GetPublicEstimateAsync(Guid ownerId, string projectId, CancellationToken ct = default)
    {
        try
        {
            // Contingency / margin / VAT % and the net subtotal are read ONLY to compute client line prices on the
            // server (PublicProjection.Pricing); they are never serialized. Rates, scope and client notes are not read.
            var e = await db.B2bEstimates.AsNoTracking().Where(x => x.UserId == ownerId && x.ProjectId == projectId)
                .Select(x => new { x.DocNo, x.AreaM2, x.LineItems, x.Total, x.ContingencyPct, x.MarginPct, x.VatPct, x.Subtotal })
                .FirstOrDefaultAsync(ct);
            return e is null ? null : new PublicEstimateSource(e.DocNo, (double)e.AreaM2, e.LineItems, (double)e.Total,
                (double)e.ContingencyPct, (double)e.MarginPct, (double)e.VatPct, (double)e.Subtotal);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (!PgErrors.IsMissingTable(ex)) logger.LogWarning(ex, "[SUCVAR] deviz public");
            return null;
        }
    }

    public async Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string? feedback, DateTimeOffset now, CancellationToken ct = default)
    {
        try
        {
            var at = now.ToUniversalTime();
            var affected = await db.Projects.Where(x => x.Id == projectId && x.IsPublic)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(x => x.ClientStatus, decision)
                    .SetProperty(x => x.ClientFeedback, feedback)
                    .SetProperty(x => x.ClientReviewedAt, at), ct);
            if (affected == 0) return null;
            var r = await db.Projects.AsNoTracking().Where(x => x.Id == projectId)
                .Select(x => new { x.ClientStatus, x.ClientReviewedAt }).FirstAsync(ct);
            return new ReviewResult(ClientStatuses.ToClientStatus(r.ClientStatus), IsoTime.Format(r.ClientReviewedAt));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (PgErrors.IsMissingColumn(ex)) return null;
            throw PgErrors.ToAppException(ex, "recenzie client", logger);
        }
    }
}
