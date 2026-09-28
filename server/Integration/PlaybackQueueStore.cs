using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Session;

namespace Jellyfin.Plugin.TvItemLayout.Integration;

/// <summary>
/// Retains the native client's authenticated playback queue. Jellyfin 12 saves
/// this queue on Stop, but omits it on Start/Progress, leaving first intros empty.
/// This does not change Jellyfin's session state or its playback queue.
/// </summary>
public sealed class PlaybackQueueStore
{
    private const int MaximumSessions = 128;
    private const int MaximumQueueItems = 1024;
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    private readonly object gate = new();
    private readonly Dictionary<(string Session, Guid User, string Device), Entry> entries = new();
    private readonly TimeProvider clock;
    private long sequence;

    public PlaybackQueueStore() : this(TimeProvider.System) { }
    public PlaybackQueueStore(TimeProvider clock) { this.clock = clock; }

    private sealed record Entry(Guid Item, string? PlaylistItem, string? PlaySession,
        QueueItem[] Queue, bool HasQueue, DateTimeOffset Expires, long Sequence);

    public long NextSequence() => Interlocked.Increment(ref sequence);

    private static (string, Guid, string) Key(SessionInfo session) => (session.Id, session.UserId, session.DeviceId);
    private static bool Same(string? a, string? b) => string.Equals(a ?? "", b ?? "", StringComparison.Ordinal);
    private static bool Matches(Entry entry, Guid item, string? playlist, string? playSession) =>
        entry.Item == item && Same(entry.PlaylistItem, playlist) && Same(entry.PlaySession, playSession);
    private static QueueItem[] Copy(IEnumerable<QueueItem> queue) => queue.Select(item =>
        new QueueItem { Id = item.Id, PlaylistItemId = item.PlaylistItemId }).ToArray();

    public void Record(SessionInfo session, PlaybackProgressInfo report, bool starting, long order)
    {
        if (session.NowPlayingItem?.Id != report.ItemId || !Same(session.PlaylistItemId, report.PlaylistItemId)
            || (report.PlaylistItemId?.Length ?? 0) > 256 || (report.PlaySessionId?.Length ?? 0) > 256) return;
        lock (gate)
        {
            var now = clock.GetUtcNow();
            Prune(now);
            var key = Key(session);
            entries.TryGetValue(key, out var previous);
            if (previous is not null && !starting && !Matches(previous, report.ItemId, report.PlaylistItemId, report.PlaySessionId)) return;
            var queue = report.NowPlayingQueue;
            if (previous is not null && previous.Sequence > order)
            {
                // A slow Start may complete after its first progress report.
                // Only fill a missing queue for that same playback; never undo
                // a newer explicit queue edit or restore another play session.
                if (previous.HasQueue || queue is null || !Matches(previous, report.ItemId, report.PlaylistItemId, report.PlaySessionId)) return;
                order = previous.Sequence;
            }
            // Progress reports normally omit the queue. Keep it for this exact
            // occurrence; a new Start without a queue must discard stale data.
            var retained = !starting && queue is null ? previous?.Queue : null;
            var hasQueue = queue is not null || (!starting && previous?.HasQueue == true);
            if (queue is not null && queue.Length <= MaximumQueueItems && queue.All(item => item is not null
                && item.Id != Guid.Empty && (item.PlaylistItemId?.Length ?? 0) <= 256))
                retained = Copy(queue);
            if (entries.Count >= MaximumSessions && previous is null)
                entries.Remove(entries.MinBy(pair => pair.Value.Expires).Key);
            entries[key] = new Entry(report.ItemId, report.PlaylistItemId, report.PlaySessionId,
                retained ?? [], hasQueue, now + Lifetime, order);
        }
    }

    public void Stop(SessionInfo session, PlaybackStopInfo report, long order)
    {
        lock (gate)
        {
            var key = Key(session);
            if (entries.TryGetValue(key, out var entry) && order >= entry.Sequence
                && Matches(entry, report.ItemId, report.PlaylistItemId, report.PlaySessionId)) entries.Remove(key);
        }
    }

    public IReadOnlyList<QueueItem> GetQueue(SessionInfo session)
    {
        lock (gate)
        {
            Prune(clock.GetUtcNow());
            if (entries.TryGetValue(Key(session), out var entry))
            {
                // Do not fall back to the outgoing native queue when this
                // session has started another item whose report is pending.
                return entry.Item == session.NowPlayingItem?.Id && Same(entry.PlaylistItem, session.PlaylistItemId)
                    ? Copy(entry.Queue) : [];
            }
            // Native Jellyfin 12 retains the outgoing queue on Stop. Without
            // a captured report it cannot prove this playback's queue, even if
            // the item and playlist IDs happen to be reused after reconnecting.
            return [];
        }
    }

    private void Prune(DateTimeOffset now)
    {
        foreach (var key in entries.Where(pair => pair.Value.Expires <= now).Select(pair => pair.Key).ToArray()) entries.Remove(key);
    }
}
