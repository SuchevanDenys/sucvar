using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Sucvar.Application;

namespace Sucvar.Infrastructure.Persistence;

/// <summary>Port of isMissingColumn / isMissingTable / toDbError from app/lib/server/db.ts.</summary>
public static class PgErrors
{
    public static PostgresException? Pg(Exception ex) => ex switch
    {
        PostgresException pg => pg,
        DbUpdateException { InnerException: PostgresException pg } => pg,
        _ => ex.InnerException is PostgresException inner ? inner : null,
    };

    public static bool IsMissingColumn(Exception ex) => Pg(ex)?.SqlState == PostgresErrorCodes.UndefinedColumn;
    public static bool IsMissingTable(Exception ex) => Pg(ex)?.SqlState == PostgresErrorCodes.UndefinedTable;

    public static AppException ToAppException(Exception ex, string what, ILogger logger)
    {
        var state = Pg(ex)?.SqlState;
        switch (state)
        {
            case PostgresErrorCodes.UndefinedTable or PostgresErrorCodes.UndefinedColumn:
                return new AppException(503, "MIGRATION_REQUIRED",
                    $"Baza de date nu este migrată ({what}). Rulează migrările din supabase/migrations/ (001, 002).");
            case PostgresErrorCodes.UniqueViolation:
                return new AppException(409, "CONFLICT", "Înregistrarea există deja.");
            case PostgresErrorCodes.ForeignKeyViolation:
                return new AppException(400, "INVALID_REFERENCE", "Referință invalidă (proiect inexistent).");
            case PostgresErrorCodes.CheckViolation:
                return new AppException(400, "CONSTRAINT_VIOLATION", "Valori în afara limitelor permise.");
            default:
                logger.LogError(ex, "[SUCVAR] DB {What}", what);
                return new AppException(500, "DB_ERROR", "Eroare de bază de date.");
        }
    }

    /// <summary>timestamptz as PostgREST serializes it (e.g. 2026-11-15T10:00:00.123456+00:00).</summary>
    public static string Iso(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", CultureInfo.InvariantCulture);

    public static string? Iso(DateTimeOffset? value) => value is { } v ? Iso(v) : null;
}
