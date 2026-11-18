namespace Sucvar.Api.Http;

/// <summary>
/// Per-user mutual exclusion for metered generations on this instance. The quota check runs before the (slow) provider
/// call and the generation is journaled after it, so without this gate two parallel requests of a user at
/// <c>limit − 1</c> would both pass the check. Holding the gate from the re-check until the journal entry is written
/// makes the second request see the first one's usage. Entries are reference-counted and removed when idle, so memory
/// stays proportional to the number of users generating right now.
/// </summary>
public sealed class GenerationGate
{
    private sealed class Entry
    {
        public readonly SemaphoreSlim Semaphore = new(1, 1);
        public int Holders;
    }

    private readonly Dictionary<string, Entry> _entries = new();
    private readonly Lock _gate = new();

    /// <summary>Waits until no other metered generation of <paramref name="userId"/> is running; dispose to release.</summary>
    public async Task<IDisposable> EnterAsync(string userId, CancellationToken ct)
    {
        Entry entry;
        lock (_gate)
        {
            if (!_entries.TryGetValue(userId, out entry!)) _entries[userId] = entry = new Entry();
            entry.Holders++;
        }
        try
        {
            await entry.Semaphore.WaitAsync(ct);
        }
        catch
        {
            Leave(userId, entry, entered: false);
            throw;
        }
        return new Lease(this, userId, entry);
    }

    private void Leave(string userId, Entry entry, bool entered)
    {
        lock (_gate)
        {
            if (entered) entry.Semaphore.Release();
            if (--entry.Holders == 0)
            {
                _entries.Remove(userId);
                entry.Semaphore.Dispose();
            }
        }
    }

    private sealed class Lease(GenerationGate owner, string userId, Entry entry) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0) owner.Leave(userId, entry, entered: true);
        }
    }
}
