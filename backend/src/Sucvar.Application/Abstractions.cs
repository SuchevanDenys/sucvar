using Sucvar.Domain.B2b;
using Sucvar.Domain.Portal;

namespace Sucvar.Application;

/// <summary>
/// Expected business failure carrying the HTTP status and stable machine-readable <see cref="Code"/> the API must
/// return. Endpoints and the global exception handler translate it into the <c>{ error, code }</c> envelope; any
/// other exception type is treated as an unexpected 500 and logged.
/// </summary>
public sealed class AppException(int status, string code, string message) : Exception(message)
{
    /// <summary>Suggested HTTP status code (400, 403, 404, 409, 503, …).</summary>
    public int Status { get; } = status;

    /// <summary>Stable error code the frontend switches on (e.g. <c>AGENCY_REQUIRED</c>).</summary>
    public string Code { get; } = code;
}

/// <summary>
/// Authenticated caller. Built exclusively from the validated Supabase JWT (<c>sub</c> + <c>email</c>), never from
/// a request body, so a client cannot act on behalf of another user by editing its payload.
/// </summary>
/// <param name="UserId">The JWT <c>sub</c> claim; already verified to be a GUID by <c>RequestAuth</c>.</param>
/// <param name="Email">Lower-cased <c>email</c> claim (may be empty for phone-only accounts).</param>
public sealed record AuthUser(string UserId, string Email)
{
    /// <summary>
    /// <see cref="UserId"/> as the <see cref="Guid"/> used by every repository. The API layer only creates an
    /// <see cref="AuthUser"/> after <c>Guid.TryParse</c> succeeded, so parsing here cannot fail for real requests.
    /// </summary>
    public Guid Id => Guid.Parse(UserId);
}

// ── Profiles / subscription ───────────────────────────────────────────────────

/// <summary>Billing columns of <c>profiles</c> as stored (the tier is NOT yet resolved against the period end).</summary>
public sealed record ProfileRecord(
    string Id,
    string? Email,
    string SubscriptionTier,
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    DateTimeOffset? CurrentPeriodEnd,
    string? BillingInterval,
    bool CancelAtPeriodEnd);

/// <summary>Billing period read from a Stripe subscription (earliest item period end, interval, scheduled cancel).</summary>
public sealed record SubscriptionPeriod(DateTimeOffset? CurrentPeriodEnd, string? Interval, bool CancelAtPeriodEnd);

/// <summary>Absolute plan state to write on activation — never a delta, which is what makes replays harmless.</summary>
public sealed record ActivationPatch(string Tier, string? CustomerId, string? SubscriptionId, SubscriptionPeriod? Period);

/// <summary>Persistence port for the subscription columns of <c>profiles</c>.</summary>
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

/// <summary>Counts and journals AI generations for quota enforcement (see <c>UsageRepositoryExtensions</c>).</summary>
public interface IUsageRepository
{
    Task<int> CountProjectsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default);
    /// <summary>Missing table → 0 (never throws).</summary>
    Task<int> CountGenerationsSinceAsync(Guid userId, DateTimeOffset since, CancellationToken ct = default);
    /// <summary>Never throws: a paid generation must not fail because of the journal.</summary>
    Task LogGenerationAsync(Guid userId, string? provider, string? mode, CancellationToken ct = default);
}

// ── B2B estimates ─────────────────────────────────────────────────────────────

/// <summary>
/// Persistence port for <c>b2b_estimates</c> (devis). Every method is scoped by <c>userId</c>: the database role bypasses
/// RLS, so this filter is the ownership boundary.
/// </summary>
public interface IEstimateRepository
{
    Task<IReadOnlyList<EstimateRecord>> ListAsync(Guid userId, int limit, CancellationToken ct = default);
    Task<Guid?> FindIdByProjectAsync(Guid userId, string projectId, CancellationToken ct = default);
    Task<EstimateRecord> UpdateAsync(Guid id, Guid userId, EstimatePayload payload, CancellationToken ct = default);
    Task<EstimateRecord> InsertAsync(Guid userId, EstimatePayload payload, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid userId, Guid estimateId, CancellationToken ct = default);
}

/// <summary>Persistence port for <c>company_profiles</c> (the contractor identity printed on a devis, migration 003).</summary>
public interface ICompanyProfileRepository
{
    Task<CompanyProfile?> GetAsync(Guid userId, CancellationToken ct = default);
    /// <summary>Insert or update the caller's own row (user_id = token subject).</summary>
    Task<CompanyProfile> UpsertAsync(Guid userId, CompanyProfile profile, CancellationToken ct = default);
}

// ── Public portal / sharing ───────────────────────────────────────────────────

/// <summary>A public project row plus its owner id, which is used server-side only (to find the estimate) and never projected.</summary>
public sealed record PublicProjectRow(PublicProjectSource Source, Guid? OwnerId);

/// <summary>Persistence port for project sharing (owner side) and the anonymous client portal.</summary>
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

/// <summary>The subset of a Stripe Checkout Session the application needs, free of Stripe.net types.</summary>
public sealed record CheckoutSessionInfo(
    string Id,
    string? PaymentStatus,
    string? ClientReferenceId,
    IReadOnlyDictionary<string, string> Metadata,
    string? CustomerId,
    string? SubscriptionId);

/// <summary>The subset of a Stripe Subscription the application needs, free of Stripe.net types.</summary>
public sealed record SubscriptionInfo(
    string Id,
    string Status,
    IReadOnlyDictionary<string, string> Metadata,
    string? CustomerId,
    IReadOnlyList<DateTimeOffset> ItemPeriodEnds,
    string? PriceInterval,
    bool CancelAtPeriodEnd);

/// <summary>Everything needed to open a Checkout Session; <c>PriceId</c> null ⇒ inline <c>price_data</c> from <c>UnitAmount</c>.</summary>
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

/// <summary>A verified Stripe event, already narrowed to the object types the processor handles.</summary>
public sealed record WebhookEvent(
    string Id,
    string Type,
    CheckoutSessionInfo? CheckoutSession,
    SubscriptionInfo? Subscription,
    string? InvoiceSubscriptionId);

/// <summary>
/// Anti-corruption port over Stripe.net. Keeping the SDK in Infrastructure lets the subscription rules be unit-tested
/// with plain records and fakes, and confines Stripe API-version churn to one adapter.
/// </summary>
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

/// <summary>The <c>Stripe-Signature</c> header did not match the raw body (forged, replayed past tolerance, or wrong secret).</summary>
public sealed class WebhookSignatureException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Remembers processed Stripe event ids (Stripe delivers at-least-once).</summary>
public interface IWebhookIdempotencyStore
{
    bool WasProcessed(string eventId);
    void MarkProcessed(string eventId);
}

// ── AI image generation ──────────────────────────────────────────────────────

/// <summary>A fully-synthesised, validated generation job (prompts already built and clamped by the Domain).</summary>
public sealed record ImageGenerationRequest(
    string ImageDataUrl,
    string Prompt,
    string NegativePrompt,
    int InferenceSteps,
    double GuidanceScale,
    long? Seed,
    double PromptStrength,
    double TransformationStrength,
    string Mode,
    // Structure lock: drives ControlNet weight on providers that expose it (SD); Replicate's model is always conditioned.
    bool PreserveStructure = true,
    // "Edit selected area": binary PNG data URL aligned to the source pixels (white = edit, black = keep). Null = full
    // redesign. Providers that can inpaint use it natively; the API composites the result through it either way.
    string? MaskDataUrl = null,
    // "Proiect scanat 3D (LiDAR)": the source is a perspective render of a 3D scan, not a photo — img2img models use the
    // high synthesis band (flat planes → real materials) instead of the photo structure-lock band.
    bool Is3dScanSource = false);

/// <summary>Inputs for the optional LLM "Prompt Architect" (all already validated by the Domain).</summary>
public sealed record PromptEnhancementRequest(
    string Mode,
    string SpaceType,
    string? StyleId,
    string? Palette,
    string? Lighting,
    double? AreaSqm,
    double? CeilingHeight,
    bool PreserveStructure,
    string CustomPrompt,
    string DeterministicPrompt,
    IReadOnlyList<string> LockedSpecs);

/// <summary>
/// Optional LLM step that rewrites the compiled prompt into a more cohesive render description. It is configured
/// only when an LLM key exists; any failure or timeout falls back to the deterministic compiler (never fails a render).
/// </summary>
public interface IPromptEnhancer
{
    /// <summary>'anthropic' | 'openai' | 'openrouter' | 'none'</summary>
    string Id { get; }
    bool IsConfigured { get; }
    /// <summary>Comma-separated English render terms, or null when nothing usable came back.</summary>
    Task<string?> EnhanceAsync(PromptEnhancementRequest request, CancellationToken ct = default);
}

/// <summary>
/// Stage 1 of the precision pipeline: a vision-language model that locates outlets, switches, radiators, doors, windows
/// and structural corners on the source photo before generation. Best effort by contract: disabled, slow (strict
/// timeout), failing or unparsable ⇒ an empty list, never an exception (only the caller's own cancellation propagates).
/// </summary>
public interface IRoomFixtureDetector
{
    bool IsConfigured { get; }
    Task<IReadOnlyList<Sucvar.Domain.Ai.DetectedFixture>> DetectAsync(string imageDataUrl, CancellationToken ct = default);
}

/// <summary>Provider output: a URL or data URL, plus whether it came from the demo provider (no real AI call).</summary>
public sealed record ImageGenerationResult(string ImageUrl, bool IsDemo);

/// <summary>Provider contract (app/lib/ai/providers/types.ts).</summary>
public interface IImageProvider
{
    /// <summary>'stable-diffusion' | 'replicate' | 'demo'</summary>
    string Id { get; }
    bool IsConfigured { get; }
    /// <summary>The prompt the active model reads: CLIP tags (SD 1.5) or a natural-language instruction (FLUX Kontext).</summary>
    Sucvar.Domain.Ai.PromptFormat PromptFormat => Sucvar.Domain.Ai.PromptFormat.Clip;
    /// <summary>The model behind the provider (e.g. <c>black-forest-labs/flux-kontext-pro</c>); defaults to <see cref="Id"/>.</summary>
    string ModelId => Id;
    /// <summary>The prompt format for a request with (<paramref name="masked"/>) or without a selection mask.</summary>
    Sucvar.Domain.Ai.PromptFormat PromptFormatFor(bool masked) => PromptFormat;
    /// <summary>The model that serves a masked request (e.g. <c>black-forest-labs/flux-fill-pro</c>).</summary>
    string ModelIdFor(bool masked) => ModelId;
    Task<ImageGenerationResult> GenerateAsync(ImageGenerationRequest request, CancellationToken ct = default);
}

/// <summary>Chooses the active provider from configuration (explicit <c>Ai:Provider</c>, else SD → Replicate → demo).</summary>
public interface IImageProviderSelector
{
    (IImageProvider Provider, string? Warning) Select();
}

/// <summary>Header-level facts about an uploaded image, read without decoding the pixels.</summary>
public sealed record ImageInspection(string Format, int Width, int Height);

/// <summary>Image inspection and normalisation (SkiaSharp in Infrastructure).</summary>
public interface IImageProcessor
{
    /// <summary>Reads only the header (format + size) — no full decode. Throws on corrupt data.</summary>
    ImageInspection Inspect(byte[] data);
    /// <summary>Downloads (if needed) and re-encodes into a permanent JPEG data URL (≤1280 px wide, q82, white background).</summary>
    Task<string> ToPermanentJpegDataUrlAsync(string source, CancellationToken ct = default);
    /// <summary>
    /// Validates an "Edit selected area" mask against the source photo and returns it as a clean binary PNG with the
    /// source's exact (upright) pixel size, plus the selection measured from its pixels.
    /// Throws <see cref="MaskRejectedException"/> for a mask the user must redo; any other exception = corrupt data.
    /// </summary>
    PreparedMask PrepareMask(string maskDataUrl, string sourceDataUrl);
    /// <summary>
    /// Downloads (if needed) the generated image and composites it over the source through the feathered mask, so
    /// every pixel outside the selection comes from the original photo. Returns a permanent JPEG data URL.
    /// </summary>
    Task<string> CompositeRegionAsync(string sourceDataUrl, string generatedSource, string maskDataUrl, CancellationToken ct = default);
    /// <summary>
    /// Pixel-level MEP fixture shield: downloads (if needed) the generated image, frames it on the source photo (same frame as
    /// <see cref="CompositeRegionAsync"/>) and restores the source pixels over each padded fixture box through a feathered
    /// alpha. Every pixel outside the boxes is the generated image's. Returns a permanent JPEG data URL (one encode).
    /// </summary>
    Task<string> ShieldFixturesAsync(string sourceDataUrl, string generatedSource, IReadOnlyList<Sucvar.Domain.Ai.DetectedFixture> shields,
        CancellationToken ct = default);
}

/// <summary>A validated selection mask: binary PNG data URL at the source size and the selection it describes.</summary>
public sealed record PreparedMask(string DataUrl, int Width, int Height, Sucvar.Domain.Ai.SelectionRegion Region);

/// <summary>A mask that cannot be used (wrong proportions, empty selection…); <see cref="Code"/> is the API error code.</summary>
public sealed class MaskRejectedException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
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

/// <summary>Portfolio counters shown on the account page.</summary>
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

/// <summary>Persistence port for the account page aggregate (identity, defaults, stats and portfolio).</summary>
public interface IProfileRepository
{
    Task<ProfileRow?> GetAsync(Guid userId, CancellationToken ct = default);
    /// <summary>Updates only the provided sections; inserts the profile row if missing. 503 when 004 is not applied.</summary>
    Task UpdateAsync(Guid userId, string email, Sucvar.Domain.Profile.ProfileUpdate update, CancellationToken ct = default);
    Task<ProfileStats> GetStatsAsync(Guid userId, CancellationToken ct = default);
    Task<IReadOnlyList<ProfileProject>> ListProjectsAsync(Guid userId, int limit, CancellationToken ct = default);
}
