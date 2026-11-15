using Microsoft.EntityFrameworkCore;

namespace Sucvar.Infrastructure.Persistence;

// Entities mirror supabase/migrations/001_sucvar_schema.sql + 002_public_portal.sql EXACTLY.
// The schema is owned by Supabase: EF Core never generates or runs migrations against it.

public sealed class ProfileEntity
{
    public Guid Id { get; set; }
    public string? Email { get; set; }
    public string? FullName { get; set; }
    public string SubscriptionTier { get; set; } = "starter";
    public string? StripeCustomerId { get; set; }
    public string? StripeSubscriptionId { get; set; }
    public DateTimeOffset? CurrentPeriodEnd { get; set; }
    public string? BillingInterval { get; set; }
    /// <summary>Nullable in databases created before migration 001 (no NOT NULL there).</summary>
    public bool? CancelAtPeriodEnd { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// `projects` as it really exists: the table predates migration 001, so `create table if not exists`
/// skipped it — `created_at` may still be TEXT and several columns are nullable. `created_at` is NOT
/// mapped here; every query that needs it goes through <see cref="ProjectSql"/>, which casts it
/// explicitly and therefore works for both TEXT and TIMESTAMPTZ (before and after migration 004).
/// </summary>
public sealed class ProjectEntity
{
    public string Id { get; set; } = "";
    public Guid? UserId { get; set; }
    public string UserEmail { get; set; } = "";
    public string Title { get; set; } = "Proiect SUCVAR";
    public string? Mode { get; set; }
    public string? SpaceType { get; set; }
    public string? StyleId { get; set; }
    public string? Dimensions { get; set; }
    public string? OriginalImage { get; set; }
    public string? GeneratedImage { get; set; }
    public decimal? TotalBudget { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public bool IsPublic { get; set; }
    public string ClientStatus { get; set; } = "pending";
    public string? ClientFeedback { get; set; }
    public DateTimeOffset? ClientReviewedAt { get; set; }
}

public sealed class AiGenerationEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string? Provider { get; set; }
    public string? Mode { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class B2bEstimateEntity
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string? ProjectId { get; set; }
    public string DocNo { get; set; } = "";
    public string Status { get; set; } = "draft";
    public string Client { get; set; } = "{}";
    public string Region { get; set; } = "paris";
    public string FinishLevel { get; set; } = "standard";
    public decimal AreaM2 { get; set; }
    public int Crew { get; set; } = 1;
    public decimal ContingencyPct { get; set; }
    public decimal MarginPct { get; set; }
    public decimal VatPct { get; set; } = 21;
    public string Scope { get; set; } = "{}";
    public string RateOverride { get; set; } = "{}";
    public string LineItems { get; set; } = "[]";
    public decimal Subtotal { get; set; }
    public decimal Total { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class CompanyProfileEntity
{
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public string VatId { get; set; } = "";
    public string RegNo { get; set; } = "";
    public string Address { get; set; } = "";
    public string Iban { get; set; } = "";
    public string Bank { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Migration 005 — append-only journal of admin actions.</summary>
public sealed class AdminAuditLogEntity
{
    public Guid Id { get; set; }
    public Guid AdminUserId { get; set; }
    public string? AdminEmail { get; set; }
    public string Action { get; set; } = "";
    public string TargetType { get; set; } = "";
    public string TargetId { get; set; } = "";
    public string Details { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Migration 005 — platform configuration (plan_limits, pricing_display, system_flags).</summary>
public sealed class AppSettingEntity
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public sealed class SucvarDbContext(DbContextOptions<SucvarDbContext> options) : DbContext(options)
{
    public DbSet<ProfileEntity> Profiles => Set<ProfileEntity>();
    public DbSet<ProjectEntity> Projects => Set<ProjectEntity>();
    public DbSet<AiGenerationEntity> AiGenerations => Set<AiGenerationEntity>();
    public DbSet<B2bEstimateEntity> B2bEstimates => Set<B2bEstimateEntity>();
    public DbSet<CompanyProfileEntity> CompanyProfiles => Set<CompanyProfileEntity>();
    public DbSet<AdminAuditLogEntity> AdminAuditLogs => Set<AdminAuditLogEntity>();
    public DbSet<AppSettingEntity> AppSettings => Set<AppSettingEntity>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("public");

        b.Entity<ProfileEntity>(e =>
        {
            e.ToTable("profiles");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").ValueGeneratedNever();
            e.Property(x => x.Email).HasColumnName("email").HasColumnType("text");
            e.Property(x => x.FullName).HasColumnName("full_name").HasColumnType("text");
            e.Property(x => x.SubscriptionTier).HasColumnName("subscription_tier").HasColumnType("text");
            e.Property(x => x.StripeCustomerId).HasColumnName("stripe_customer_id").HasColumnType("text");
            e.Property(x => x.StripeSubscriptionId).HasColumnName("stripe_subscription_id").HasColumnType("text");
            e.Property(x => x.CurrentPeriodEnd).HasColumnName("current_period_end").HasColumnType("timestamptz");
            e.Property(x => x.BillingInterval).HasColumnName("billing_interval").HasColumnType("text");
            e.Property(x => x.CancelAtPeriodEnd).HasColumnName("cancel_at_period_end").HasColumnType("boolean");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
        });

        b.Entity<ProjectEntity>(e =>
        {
            e.ToTable("projects");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("text").ValueGeneratedNever();
            e.Property(x => x.UserId).HasColumnName("user_id").HasColumnType("uuid");
            e.Property(x => x.UserEmail).HasColumnName("user_email").HasColumnType("text");
            e.Property(x => x.Title).HasColumnName("title").HasColumnType("text");
            e.Property(x => x.Mode).HasColumnName("mode").HasColumnType("text");
            e.Property(x => x.SpaceType).HasColumnName("space_type").HasColumnType("text");
            e.Property(x => x.StyleId).HasColumnName("style_id").HasColumnType("text");
            e.Property(x => x.Dimensions).HasColumnName("dimensions").HasColumnType("jsonb");
            e.Property(x => x.OriginalImage).HasColumnName("original_image").HasColumnType("text");
            e.Property(x => x.GeneratedImage).HasColumnName("generated_image").HasColumnType("text");
            e.Property(x => x.TotalBudget).HasColumnName("total_budget").HasColumnType("numeric(12,2)");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
            e.Property(x => x.IsPublic).HasColumnName("is_public").HasColumnType("boolean");
            e.Property(x => x.ClientStatus).HasColumnName("client_status").HasColumnType("text");
            e.Property(x => x.ClientFeedback).HasColumnName("client_feedback").HasColumnType("text");
            e.Property(x => x.ClientReviewedAt).HasColumnName("client_reviewed_at").HasColumnType("timestamptz");
        });

        b.Entity<AiGenerationEntity>(e =>
        {
            e.ToTable("ai_generations");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").ValueGeneratedNever();
            e.Property(x => x.UserId).HasColumnName("user_id").HasColumnType("uuid");
            e.Property(x => x.Provider).HasColumnName("provider").HasColumnType("text");
            e.Property(x => x.Mode).HasColumnName("mode").HasColumnType("text");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
        });

        // Migration 003 (backend/db/migrations/003_company_profile_and_vat.sql)
        b.Entity<CompanyProfileEntity>(e =>
        {
            e.ToTable("company_profiles");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasColumnName("user_id").HasColumnType("uuid").ValueGeneratedNever();
            e.Property(x => x.Name).HasColumnName("name").HasColumnType("text");
            e.Property(x => x.VatId).HasColumnName("vat_id").HasColumnType("text");
            e.Property(x => x.RegNo).HasColumnName("reg_no").HasColumnType("text");
            e.Property(x => x.Address).HasColumnName("address").HasColumnType("text");
            e.Property(x => x.Iban).HasColumnName("iban").HasColumnType("text");
            e.Property(x => x.Bank).HasColumnName("bank").HasColumnType("text");
            e.Property(x => x.Email).HasColumnName("email").HasColumnType("text");
            e.Property(x => x.Phone).HasColumnName("phone").HasColumnType("text");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
        });

        // Migration 005 (backend/db/migrations/005_admin_panel.sql). The new `profiles` columns (role, is_banned,
        // banned_reason, bonus_generations, quota_reset_at) are deliberately NOT mapped on ProfileEntity: they are
        // read through raw SQL with a fallback, so every existing query keeps working before 005 is applied.
        b.Entity<AdminAuditLogEntity>(e =>
        {
            e.ToTable("admin_audit_logs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").HasDefaultValueSql("gen_random_uuid()").ValueGeneratedOnAdd();
            e.Property(x => x.AdminUserId).HasColumnName("admin_user_id").HasColumnType("uuid");
            e.Property(x => x.AdminEmail).HasColumnName("admin_email").HasColumnType("text");
            e.Property(x => x.Action).HasColumnName("action").HasColumnType("text");
            e.Property(x => x.TargetType).HasColumnName("target_type").HasColumnType("text");
            e.Property(x => x.TargetId).HasColumnName("target_id").HasColumnType("text");
            e.Property(x => x.Details).HasColumnName("details").HasColumnType("jsonb");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
        });

        b.Entity<AppSettingEntity>(e =>
        {
            e.ToTable("app_settings");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasColumnName("key").HasColumnType("text").ValueGeneratedNever();
            e.Property(x => x.Value).HasColumnName("value").HasColumnType("jsonb");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
            e.Property(x => x.UpdatedBy).HasColumnName("updated_by").HasColumnType("uuid");
        });

        b.Entity<B2bEstimateEntity>(e =>
        {
            e.ToTable("b2b_estimates");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid").ValueGeneratedNever();
            e.Property(x => x.UserId).HasColumnName("user_id").HasColumnType("uuid");
            e.Property(x => x.ProjectId).HasColumnName("project_id").HasColumnType("text");
            e.Property(x => x.DocNo).HasColumnName("doc_no").HasColumnType("text");
            e.Property(x => x.Status).HasColumnName("status").HasColumnType("text");
            e.Property(x => x.Client).HasColumnName("client").HasColumnType("jsonb");
            e.Property(x => x.Region).HasColumnName("region").HasColumnType("text");
            e.Property(x => x.FinishLevel).HasColumnName("finish_level").HasColumnType("text");
            e.Property(x => x.AreaM2).HasColumnName("area_m2").HasColumnType("numeric(12,2)");
            e.Property(x => x.Crew).HasColumnName("crew").HasColumnType("integer");
            e.Property(x => x.ContingencyPct).HasColumnName("contingency_pct").HasColumnType("numeric(5,2)");
            e.Property(x => x.MarginPct).HasColumnName("margin_pct").HasColumnType("numeric(5,2)");
            e.Property(x => x.VatPct).HasColumnName("vat_pct").HasColumnType("numeric(5,2)");
            e.Property(x => x.Scope).HasColumnName("scope").HasColumnType("jsonb");
            e.Property(x => x.RateOverride).HasColumnName("rate_override").HasColumnType("jsonb");
            e.Property(x => x.LineItems).HasColumnName("line_items").HasColumnType("jsonb");
            e.Property(x => x.Subtotal).HasColumnName("subtotal").HasColumnType("numeric(12,2)");
            e.Property(x => x.Total).HasColumnName("total").HasColumnType("numeric(12,2)");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAdd();
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamptz").HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
        });
    }
}
