using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Sucvar.Infrastructure.Persistence;

/// <summary>
/// Raw, parameterised SQL for `public.projects` where `created_at` is involved.
///
/// WHY: in databases where `projects` existed before migration 001 (Supabase "create table if not exists"
/// skipped it), `created_at` is TEXT holding ISO strings. EF Core cannot read TEXT as a date and Postgres
/// refuses `text &gt;= timestamptz` (42883), which broke the public portal (500) and the Starter quota.
/// Casting through text — <c>created_at::text::timestamptz</c> — is valid for BOTH column types, so the API
/// works before and after migration 004 (which converts the column to timestamptz).
/// </summary>
public static class ProjectSql
{
    /// <summary>created_at as timestamptz (NULL when the stored text is not an ISO date).</summary>
    public const string CreatedAt =
        "(case when p.created_at::text ~ '^\\d{4}-\\d{2}-\\d{2}' then p.created_at::text::timestamptz end)";

    /// <summary>The same value as an ISO-8601 UTC string (PostgREST style), '' when unknown.</summary>
    public const string CreatedAtIso =
        "coalesce(to_char(" + CreatedAt + " at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"'), '')";

    public static async Task<NpgsqlCommand> CommandAsync(SucvarDbContext db, string sql, CancellationToken ct, params (string Name, object? Value)[] parameters)
    {
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync(ct);
        var cmd = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    public static string? Str(DbDataReader r, string column)
    {
        var i = r.GetOrdinal(column);
        return r.IsDBNull(i) ? null : r.GetValue(i).ToString();
    }

    public static DateTimeOffset? Date(DbDataReader r, string column)
    {
        var i = r.GetOrdinal(column);
        return r.IsDBNull(i) ? null : r.GetFieldValue<DateTimeOffset>(i);
    }
}
