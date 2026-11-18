using Sucvar.Api.Http;

namespace Sucvar.Tests;

/// <summary>Per-user serialisation of metered generations (quota check → provider → journal).</summary>
public class GenerationGateTests
{
    [Fact]
    public async Task Second_generation_of_the_same_user_waits_for_the_first()
    {
        var gate = new GenerationGate();
        var first = await gate.EnterAsync("user-a", CancellationToken.None);

        var second = gate.EnterAsync("user-a", CancellationToken.None);
        await Task.Delay(50);
        Assert.False(second.IsCompleted);

        first.Dispose();
        (await second.WaitAsync(TimeSpan.FromSeconds(5))).Dispose();
    }

    [Fact]
    public async Task Different_users_do_not_block_each_other()
    {
        var gate = new GenerationGate();
        using var a = await gate.EnterAsync("user-a", CancellationToken.None);
        using var b = await gate.EnterAsync("user-b", CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task Cancelled_waiter_does_not_hold_the_gate_and_double_dispose_is_harmless()
    {
        var gate = new GenerationGate();
        var first = await gate.EnterAsync("user-a", CancellationToken.None);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => gate.EnterAsync("user-a", cts.Token));

        first.Dispose();
        first.Dispose();
        (await gate.EnterAsync("user-a", CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5))).Dispose();
    }
}
