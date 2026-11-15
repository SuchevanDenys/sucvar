using FluentValidation;
using Microsoft.Extensions.Logging;
using Sucvar.Domain.Portal;

namespace Sucvar.Application.Portal;

/// <summary>Body of POST /api/public/projects/{id}/review after JSON type checks.</summary>
public sealed record ReviewRequest(string? Status, string Feedback);

public sealed class ReviewRequestValidator : AbstractValidator<ReviewRequest>
{
    public ReviewRequestValidator()
    {
        RuleFor(r => r.Status)
            .Must(s => s is not null && ClientStatuses.Decisions.Contains(s))
            .WithErrorCode("INVALID_STATUS").WithMessage("Status invalid.");
        RuleFor(r => r.Feedback)
            .MaximumLength(ClientStatuses.FeedbackMax)
            .WithErrorCode("FEEDBACK_TOO_LONG").WithMessage($"Mesajul poate avea maximum {ClientStatuses.FeedbackMax} de caractere.");
    }
}

/// <summary>Port of the portal half of db.ts (sharing + public projection + client review).</summary>
public sealed class PortalService(IPortalRepository repository, TimeProvider clock, ILogger<PortalService> logger)
{
    public Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(AuthUser user, string? projectId, CancellationToken ct = default) =>
        repository.ListSharingAsync(Guid.Parse(user.UserId), projectId, ct);

    public async Task<ProjectSharing> SetPublicAsync(AuthUser user, string projectId, bool isPublic, CancellationToken ct = default) =>
        await repository.SetPublicAsync(Guid.Parse(user.UserId), projectId, isPublic, ct)
        ?? throw new AppException(404, "NOT_FOUND", "Proiectul nu există în cloud. Salvează-l în Supabase înainte de a-l partaja.");

    /// <summary>Public project or null (missing OR private — never reveal which).</summary>
    public async Task<PublicProject?> GetPublicProjectAsync(string projectId, CancellationToken ct = default)
    {
        var row = await repository.GetPublicProjectAsync(projectId, ct);
        if (row is null) return null;
        PublicEstimateSource? estimate = null;
        if (row.OwnerId is { } owner)
        {
            try
            {
                estimate = await repository.GetPublicEstimateAsync(owner, projectId, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "[SUCVAR] deviz public");
            }
        }
        return PublicProjection.Project(row.Source, estimate);
    }

    public Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string feedback, CancellationToken ct = default) =>
        repository.SubmitReviewAsync(projectId, decision, feedback.Length > 0 ? feedback : null, clock.GetUtcNow(), ct);
}
