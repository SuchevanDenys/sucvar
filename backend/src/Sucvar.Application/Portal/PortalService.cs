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

/// <summary>
/// Client-portal use cases: the owner toggles a project's public link, an anonymous client views a sanitised
/// projection and records a decision.
/// </summary>
public sealed class PortalService(IPortalRepository repository, TimeProvider clock, ILogger<PortalService> logger)
{
    /// <summary>Sharing state of the caller's projects; <c>Migrated=false</c> when migration 002 is missing.</summary>
    public Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(AuthUser user, string? projectId, CancellationToken ct = default) =>
        repository.ListSharingAsync(user.Id, projectId, ct);

    /// <summary>Publishes or revokes the caller's project link. 404 when the project is not in the cloud or not theirs.</summary>
    public async Task<ProjectSharing> SetPublicAsync(AuthUser user, string projectId, bool isPublic, CancellationToken ct = default) =>
        await repository.SetPublicAsync(user.Id, projectId, isPublic, ct)
        ?? throw new AppException(404, "NOT_FOUND", "Proiectul nu există în cloud. Salvează-l în Supabase înainte de a-l partaja.");

    /// <summary>
    /// Public project or null (missing OR private — never reveal which). The estimate is best-effort: if it cannot be
    /// read the portal still renders the design, just without a total.
    /// </summary>
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

    /// <summary>Records the client decision; null when the project is not (or no longer) public.</summary>
    public Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string feedback, CancellationToken ct = default) =>
        repository.SubmitReviewAsync(projectId, decision, feedback.Length > 0 ? feedback : null, clock.GetUtcNow(), ct);
}
