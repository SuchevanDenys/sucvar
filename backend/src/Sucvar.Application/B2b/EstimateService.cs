using Sucvar.Application.Subscriptions;
using Sucvar.Domain.B2b;
using Sucvar.Domain.Plans;

namespace Sucvar.Application.B2b;

/// <summary>Port of the b2b_estimates half of db.ts + the agency gate of /api/b2b/estimates.</summary>
public sealed class EstimateService(IEstimateRepository repository, SubscriptionService subscriptions)
{
    /// <summary>EnterpriseGate on the server: effective tier must be 'agency'. Returns the current tier when denied.</summary>
    public async Task<(bool Allowed, string CurrentTier)> CheckAgencyAsync(AuthUser user, CancellationToken ct = default)
    {
        var sub = await subscriptions.GetEffectiveSubscriptionAsync(user.UserId, ct);
        return (PlanTiers.HasB2bAccess(sub.Tier), sub.Tier);
    }

    public Task<IReadOnlyList<EstimateRecord>> ListAsync(AuthUser user, int limit = 50, CancellationToken ct = default) =>
        repository.ListAsync(Guid.Parse(user.UserId), Math.Min(Math.Max(limit, 1), 100), ct);

    /// <summary>One estimate per (user_id, project_id): update when it exists, insert otherwise.</summary>
    public async Task<EstimateRecord> SaveAsync(AuthUser user, EstimatePayload payload, CancellationToken ct = default)
    {
        var userId = Guid.Parse(user.UserId);
        if (payload.ProjectId is { } projectId)
        {
            var existing = await repository.FindIdByProjectAsync(userId, projectId, ct);
            if (existing is { } id) return await repository.UpdateAsync(id, userId, payload, ct);
        }
        return await repository.InsertAsync(userId, payload, ct);
    }

    /// <summary>false when the estimate does not exist or belongs to someone else.</summary>
    public Task<bool> DeleteAsync(AuthUser user, Guid estimateId, CancellationToken ct = default) =>
        repository.DeleteAsync(Guid.Parse(user.UserId), estimateId, ct);
}
