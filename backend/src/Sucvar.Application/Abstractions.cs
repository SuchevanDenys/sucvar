using Sucvar.Domain.B2b;
using Sucvar.Domain.Portal;

namespace Sucvar.Application;

/// <summary>Error with a suggested HTTP status (port of DbError) — endpoints translate it into { error, code }.</summary>
public sealed class AppException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>Identity taken from the validated Supabase JWT (`sub` + `email`), never from the body.</summary>
public sealed record AuthUser(string UserId, string Email);

// ── Profiles / subscription ───────────────────────────────────────────────────

public sealed record ProfileRecord(
    string Id,
    string? Email,
    string SubscriptionTier,
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    DateTimeOffset? CurrentPeriodEnd,
    string? BillingInterval,
    bool CancelAtPeriodEnd);

public sealed record SubscriptionPeriod(DateTimeOffset? CurrentPeriodEnd, string? Interval, bool CancelAtPeriodEnd);

public sealed record ActivationPatch(string Tier, string? CustomerId, string? SubscriptionId, SubscriptionPeriod? Period);

public interface ISubscriptionRepository
{
    Task<ProfileRecord?> GetProfileAsync(Guid userId, CancellationToken ct = default);
    /// <summary>Idempotent; inserts the profile if missing.</summary>
    Task ActivateProfilePlanAsync(Guid userId, ActivationPatch patch, CancellationToken ct = default);
    Task<string?> GetCurrentSubscriptionIdAsync(Guid userId, CancellationToken ct = default);
    /// <summary>Downgrades only the profile whose CURRENT subscription is <paramref name="subscriptionId"/>.</summary>
    Task<string?> DowngradeBySubscriptionIdAsync(string subscriptionId, CancellationToken ct = default);
}

// ── Usage (quota) ─────────────────────────────────────────────────────────────

public interface IUsageRepository
{
    Task<int> CountProjectsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default);
    /// <summary>Missing table → 0 (never throws).</summary>
    Task<int> CountGenerationsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default);
    /// <summary>Never throws: a paid generation must not fail because of the journal.</summary>
    Task LogGenerationAsync(Guid userId, string? provider, string? mode, CancellationToken ct = default);
}

// ── B2B estimates ─────────────────────────────────────────────────────────────

public interface IEstimateRepository
{
    Task<IReadOnlyList<EstimateRecord>> ListAsync(Guid userId, int limit, CancellationToken ct = default);
    Task<Guid?> FindIdByProjectAsync(Guid userId, string projectId, CancellationToken ct = default);
    Task<EstimateRecord> UpdateAsync(Guid id, Guid userId, EstimatePayload payload, CancellationToken ct = default);
    Task<EstimateRecord> InsertAsync(Guid userId, EstimatePayload payload, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid userId, Guid estimateId, CancellationToken ct = default);
}

public interface ICompanyProfileRepository
{
    Task<CompanyProfile?> GetAsync(Guid userId, CancellationToken ct = default);
    /// <summary>Insert or update the caller's own row (user_id = token subject).</summary>
    Task<CompanyProfile> UpsertAsync(Guid userId, CompanyProfile profile, CancellationToken ct = default);
}

// ── Public portal / sharing ───────────────────────────────────────────────────

public sealed record PublicProjectRow(PublicProjectSource Source, Guid? OwnerId);

public interface IPortalRepository
{
    /// <summary>(migrated=false, []) when the 002 columns are missing.</summary>
    Task<(bool Migrated, IReadOnlyList<ProjectSharing> Items)> ListSharingAsync(Guid userId, string? projectId, CancellationToken ct = default);
    Task<ProjectSharing?> SetPublicAsync(Guid userId, string projectId, bool isPublic, CancellationToken ct = default);
    /// <summary>Only rows with is_public = true; null otherwise (private and missing are identical).</summary>
    Task<PublicProjectRow?> GetPublicProjectAsync(string projectId, CancellationToken ct = default);
    Task<PublicEstimateSource?> GetPublicEstimateAsync(Guid ownerId, string projectId, CancellationToken ct = default);
    /// <summary>Writes only client_* columns and only on public projects.</summary>
    Task<ReviewResult?> SubmitReviewAsync(string projectId, string decision, string? feedback, DateTimeOffset now, CancellationToken ct = default);
}

// ── Stripe (gateway hides Stripe.net from the application layer) ──────────────

public sealed record CheckoutSessionInfo(
    string Id,
    string? PaymentStatus,
    string? ClientReferenceId,
    IReadOnlyDictionary<string, string> Metadata,
    string? CustomerId,
    string? SubscriptionId);

public sealed record SubscriptionInfo(
    string Id,
    string Status,
    IReadOnlyDictionary<string, string> Metadata,
    string? CustomerId,
    IReadOnlyList<DateTimeOffset> ItemPeriodEnds,
    string? PriceInterval,
    bool CancelAtPeriodEnd);

public sealed record CreateCheckoutRequest(
    string UserId,
    string Email,
    string? StripeCustomerId,
    string Plan,
    string Interval,
    string? PriceId,
    long UnitAmount,
    string ProductName,
    string SuccessUrl,
    string CancelUrl,
    DateTimeOffset? TermsAcceptedAt = null);

public sealed record WebhookEvent(
    string Id,
    string Type,
    CheckoutSessionInfo? CheckoutSession,
    SubscriptionInfo? Subscription,
    string? InvoiceSubscriptionId);

public interface IStripeGateway
{
    bool IsConfigured { get; }
    Task<string?> CreateCheckoutSessionAsync(CreateCheckoutRequest request, CancellationToken ct = default);
    Task<CheckoutSessionInfo> GetCheckoutSessionAsync(string sessionId, CancellationToken ct = default);
    Task<SubscriptionInfo> GetSubscriptionAsync(string subscriptionId, CancellationToken ct = default);
    Task CancelSubscriptionAsync(string subscriptionId, CancellationToken ct = default);
    /// <summary>Stripe Customer Portal session (change card, cancel, invoices). Returns the portal URL.</summary>
    Task<string> CreatePortalSessionAsync(string customerId, string returnUrl, CancellationToken ct = default);
    /// <summary>Validates Stripe-Signature on the RAW body; throws <see cref="WebhookSignatureException"/>.</summary>
    WebhookEvent ParseWebhook(string rawBody, string signature, string secret);
}

public sealed class WebhookSignatureException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Remembers processed Stripe event ids (Stripe delivers at-least-once).</summary>
public interface IWebhookIdempotencyStore
{
    bool WasProcessed(string eventId);
    void MarkProcessed(string eventId);
}

// ── AI image generation ──────────────────────────────────────────────────────

public sealed record ImageGenerationRequest(
    string ImageDataUrl,
    string Prompt,
    string NegativePrompt,
    int InferenceSteps,
    double GuidanceScale,
    long? Seed,
    double PromptStrength,
    double TransformationStrength,
    string Mode);

public sealed record ImageGenerationResult(string ImageUrl, bool IsDemo);

/// <summary>Provider contract (app/lib/ai/providers/types.ts).</summary>
public interface IImageProvider
{
    /// <summary>'stable-diffusion' | 'replicate' | 'demo'</summary>
    string Id { get; }
    bool IsConfigured { get; }
    Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default);
}

public interface IImageProviderSelector
{
    (IImageProvider Provider, string? Warning) Select();
}

public sealed record ImageInspection(string Format, int Width, int Height);

public interface IImageProcessor
{
    /// <summary>Reads only the header (format + size) — no full decode. Throws on corrupt data.</summary>
    ImageInspection Inspect(byte[] data);
    /// <summary>Downloads (if needed) and re-encodes into a permanent JPEG data URL (≤1280 px wide, q82, white background).</summary>
    Task<string> ToPermanentJpegDataUrlAsync(string source, CancellationToken ct = default);
}

// ── User profile (/api/profile) ───────────────────────────────────────────────

/// <summary>Row of `profiles` relevant to the profile page. `Migrated` = false when migration 004 is missing.</summary>
public sealed record ProfileRow(
    string? FullName,
    string? Email,
    string? AvatarUrl,
    DateTimeOffset? CreatedAt,
    Sucvar.Domain.Profile.ProfileDefaults Defaults,
    bool Migrated);

public sealed record ProfileStats(int ProjectsTotal, int ProjectsPublic, int EstimatesTotal);

/// <summary>A saved project in the profile portfolio — no images (they are hundreds of KB each).</summary>
public sealed record ProfileProject(
    string Id,
    string Title,
    string Mode,
    string SpaceType,
    string StyleId,
    string CreatedAt,
    bool HasImage,
    bool IsPublic,
    string ClientStatus,
    string? ClientFeedback,
    string? ClientReviewedAt,
    IReadOnlyList<Sucvar.Domain.Procurement.BomItem>? ProcurementItems = null,
    double ProcurementTotal = 0,
    bool ProcurementPersisted = false);

public interface IProfileRepository
{
    Task<ProfileRow?> GetAsync(Guid userId, CancellationToken ct = default);
    /// <summary>Updates only the provided sections; inserts the profile row if missing. 503 when 004 is not applied.</summary>
    Task UpdateAsync(Guid userId, string email, Sucvar.Domain.Profile.ProfileUpdate update, CancellationToken ct = default);
    Task<ProfileStats> GetStatsAsync(Guid userId, CancellationToken ct = default);
    Task<IReadOnlyList<ProfileProject>> ListProjectsAsync(Guid userId, int limit, CancellationToken ct = default);
}
