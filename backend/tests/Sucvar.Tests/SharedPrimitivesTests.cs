using Sucvar.Application;
using Sucvar.Domain;

namespace Sucvar.Tests;

/// <summary>Cross-layer primitives whose output is part of the public JSON contract.</summary>
public class SharedPrimitivesTests
{
    [Fact]
    public void IsoTime_matches_the_PostgREST_timestamptz_shape()
    {
        var value = new DateTimeOffset(2026, 11, 15, 12, 30, 5, TimeSpan.FromHours(2)).AddTicks(1_234_560);
        Assert.Equal("2026-11-15T10:30:05.123456+00:00", IsoTime.Format(value));
    }

    [Fact]
    public void IsoTime_keeps_absent_timestamps_null()
    {
        Assert.Null(IsoTime.Format((DateTimeOffset?)null));
    }

    [Fact]
    public void AuthUser_exposes_the_token_subject_as_a_guid()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, new AuthUser(id.ToString(), "a@b.fr").Id);
    }
}
