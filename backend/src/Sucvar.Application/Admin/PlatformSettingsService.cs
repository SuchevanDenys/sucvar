using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Sucvar.Domain.Admin;

namespace Sucvar.Application.Admin;

/// <summary>Process-wide cache of `app_settings` (singleton). Hot paths (quota, guard) read it on every request.</summary>
public sealed class SettingsCache
{
    public static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);
    private readonly Lock _gate = new();
    private PlatformSettings? _value;
    private DateTimeOffset _expires;

    public PlatformSettings? Get(DateTimeOffset now)
    {
        lock (_gate) return _value is not null && now < _expires ? _value : null;
    }

    public void Set(PlatformSettings value, DateTimeOffset now)
    {
        lock (_gate) { _value = value; _expires = now + Ttl; }
    }

    public void Invalidate()
    {
        lock (_gate) _value = null;
    }
}

/// <summary>Settings plus whether migration 005 is applied (the admin UI disables editing when it is not).</summary>
public sealed record SettingsView(PlatformSettings Settings, bool Migrated);

/// <summary>
/// `app_settings` (migration 005): plan limits, displayed prices and system flags, editable from /admin
/// without a deployment. Reads never fail: missing table / DB error ⇒ the defaults hard-coded in PlanTiers.
/// </summary>
public sealed class PlatformSettingsService(IAppSettingsRepository repository, SettingsCache cache, TimeProvider clock, ILogger<PlatformSettingsService> logger)
{
    /// <summary>Cached read (30 s TTL) for hot paths; never throws — falls back to the compiled-in defaults.</summary>
    public async Task<PlatformSettings> GetAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        if (cache.Get(now) is { } cached) return cached;
        var (settings, _) = await LoadAsync(ct);
        cache.Set(settings, now);
        return settings;
    }

    /// <summary>Uncached read for the admin page.</summary>
    public async Task<SettingsView> GetViewAsync(CancellationToken ct = default)
    {
        var (settings, migrated) = await LoadAsync(ct);
        return new SettingsView(settings, migrated);
    }

    private async Task<(PlatformSettings Settings, bool Migrated)> LoadAsync(CancellationToken ct)
    {
        try
        {
            var rows = await repository.GetAllAsync(ct);
            return rows is null ? (PlatformSettings.Defaults, false) : (SettingsCodec.FromStorage(rows), true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[SUCVAR] app_settings indisponibil; se folosesc valorile implicite");
            return (PlatformSettings.Defaults, true);
        }
    }

    /// <summary>
    /// Validates a partial settings update, persists only the changed keys together with a before/after audit row, and
    /// invalidates the cache so the new limits apply on this instance immediately (other instances within one TTL).
    /// </summary>
    public async Task<SettingsView> UpdateAsync(AuthUser admin, JsonElement? body, CancellationToken ct = default)
    {
        var (current, migrated) = await LoadAsync(ct);
        if (!migrated)
            throw new AppException(503, "MIGRATION_REQUIRED", "Rulează backend/db/migrations/005_admin_panel.sql în Supabase SQL Editor.");

        var parsed = SettingsCodec.ParseUpdate(body, current);
        if (!parsed.Ok) throw new AppException(400, "INVALID_SETTINGS", parsed.Error!);
        if (parsed.ChangedKeys.Count == 0) return new SettingsView(current, true);

        var values = parsed.ChangedKeys.ToDictionary(k => k, k => SettingsCodec.ToStorage(parsed.Value!, k));
        var before = new JsonObject();
        var after = new JsonObject();
        foreach (var key in parsed.ChangedKeys)
        {
            before[key] = JsonNode.Parse(SettingsCodec.ToStorage(current, key));
            after[key] = JsonNode.Parse(values[key]);
        }
        var details = new JsonObject
        {
            ["keys"] = new JsonArray(parsed.ChangedKeys.Select(k => (JsonNode?)JsonValue.Create(k)).ToArray()),
            ["before"] = before,
            ["after"] = after,
        };
        var adminId = admin.Id;
        await repository.SaveAsync(values, adminId,
            new AuditEntry(adminId, admin.Email, AuditActions.UpdateSettings, AuditTargets.Settings, string.Join(",", parsed.ChangedKeys), details.ToJsonString()), ct);

        cache.Invalidate();
        logger.LogInformation("[SUCVAR] admin {Admin} settings.update {Keys}", admin.UserId, string.Join(",", parsed.ChangedKeys));
        return new SettingsView(parsed.Value!, true);
    }
}
