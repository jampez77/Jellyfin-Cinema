using System.Text.Json;
using Jellyfin.Data.Enums;
#if JELLYFIN_1010
using User = Jellyfin.Data.Entities.User;
#else
using User = Jellyfin.Database.Implementations.Entities.User;
#endif
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Playlists;

namespace Jellyfin.Plugin.TvItemLayout.Watchlists;

/// <summary>Native private film playlists plus series references that never expand into episodes.</summary>
public sealed class WatchlistService(IPlaylistManager playlists, IApplicationPaths paths, ILibraryManager library)
{
    // Bounded shared locks cover trailer/detail mutations, including first playlist creation.
    private static readonly SemaphoreSlim[] Locks = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    private const int MaximumSeries = 10000;
    private const int MaximumBytes = 512 * 1024;
    public static async Task<IDisposable> Acquire(Guid userId, CancellationToken cancellationToken)
    {
        var gate = Locks[(uint)userId.GetHashCode() % Locks.Length];
        await gate.WaitAsync(cancellationToken);
        return new Lease(gate);
    }
    private sealed class Lease(SemaphoreSlim gate) : IDisposable { public void Dispose() => gate.Release(); }

    public static Playlist[] MovieLists(IPlaylistManager manager, User user) => manager.GetPlaylists(user.Id).Where(list =>
        list.OwnerUserId == user.Id && !list.OpenAccess && list.Shares.Count == 0
        && string.Equals(list.Name?.Trim(), "Watchlist", StringComparison.OrdinalIgnoreCase)
        && (list.MediaType == MediaType.Video || list.MediaType == MediaType.Unknown)
        && !list.ProviderIds.Keys.Any(key => key.Contains("SmartList", StringComparison.OrdinalIgnoreCase)))
        .Take(2).ToArray();

    public static bool Contains(Playlist playlist, Guid id) => playlist.LinkedChildren.Any(link => link.ItemId == id)
        || playlist.LinkedChildren.Any(link => !link.ItemId.HasValue || link.ItemId == Guid.Empty)
            && playlist.GetManageableItems().Any(entry => entry.Item2.Id == id);

    private Playlist? MovieList(User user)
    {
        var lists = MovieLists(playlists, user);
        if (lists.Length > 1) throw new WatchlistException("You have more than one private video playlist named Watchlist. Rename one before using your Watchlist.");
        return lists.SingleOrDefault();
    }

    private string SeriesPath(Guid userId) => Path.Combine(paths.DataPath, "jellyfin-cinema", "watchlists", userId.ToString("N") + ".json");
    private async Task<Guid[]> ReadSeries(Guid userId, CancellationToken cancellationToken)
    {
        FileStream stream;
        try { stream = new FileStream(SeriesPath(userId), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 4096, FileOptions.Asynchronous); }
        catch (FileNotFoundException) { return []; }
        catch (DirectoryNotFoundException) { return []; }
        await using var file = stream;
        if (file.Length > MaximumBytes) throw new InvalidDataException("Saved Watchlist exceeds its size limit.");
        var saved = await JsonSerializer.DeserializeAsync<SeriesWatchlist>(file, cancellationToken: cancellationToken);
        if (saved is not { Version: 1, ItemIds: not null } || saved.ItemIds.Length > MaximumSeries
            || saved.ItemIds.Any(id => id == Guid.Empty) || saved.ItemIds.Distinct().Count() != saved.ItemIds.Length)
            throw new InvalidDataException("Saved Watchlist is invalid.");
        return saved.ItemIds;
    }
    private async Task WriteSeries(Guid userId, Guid[] ids, CancellationToken cancellationToken)
    {
        if (ids.Length > MaximumSeries) throw new WatchlistException("Your Watchlist has reached its TV show limit. Remove a show before adding another.");
        var path = SeriesPath(userId);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(new SeriesWatchlist(1, ids)), cancellationToken);
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public async Task<HashSet<Guid>> ReadIds(User user, CancellationToken cancellationToken = default)
    {
        var list = MovieList(user);
        var ids = list?.LinkedChildren.Where(link => link.ItemId is not null && link.ItemId != Guid.Empty)
            .Select(link => link.ItemId!.Value).ToHashSet() ?? [];
        if (list?.LinkedChildren.Any(link => !link.ItemId.HasValue || link.ItemId == Guid.Empty) == true)
            ids.UnionWith(list.GetManageableItems().Select(entry => entry.Item2.Id));
        // A native Series entry is a folder, not a saved show: native playback
        // expands it into episodes. Keep film storage and series storage distinct
        // so detail-page removal always removes the source of membership.
        ids.RemoveWhere(id => library.GetItemById(id) is not Movie);
        ids.UnionWith((await ReadSeries(user.Id, cancellationToken)).Where(id => library.GetItemById(id) is Series));
        return ids;
    }
    /// <summary>Call under Acquire after revalidating the authenticated user and item.</summary>
    public async Task Set(User user, BaseItem item, bool saved, CancellationToken cancellationToken)
    {
        var list = MovieList(user);
        if (item is Series)
        {
            var ids = await ReadSeries(user.Id, cancellationToken);
            if (ids.Contains(item.Id) == saved) return;
            await WriteSeries(user.Id, saved ? [.. ids, item.Id] : ids.Where(id => id != item.Id).ToArray(), cancellationToken);
            return;
        }
        if (item is not Movie) throw new ArgumentException("Only films and TV shows can be saved.", nameof(item));
        cancellationToken.ThrowIfCancellationRequested();
        if (saved)
        {
            if (list is null)
            {
                var created = await playlists.CreatePlaylist(new PlaylistCreationRequest
                {
                    Name = "Watchlist", UserId = user.Id, Public = false, Users = [], ItemIdList = [item.Id], MediaType = MediaType.Video
                });
                list = playlists.GetPlaylistForUser(Guid.Parse(created.Id), user.Id);
            }
            else if (!Contains(list, item.Id))
            {
#if JELLYFIN_12
                await playlists.AddItemToPlaylistAsync(list.Id, [item.Id], null, user.Id);
#else
                await playlists.AddItemToPlaylistAsync(list.Id, [item.Id], user.Id);
#endif
                list = playlists.GetPlaylistForUser(list.Id, user.Id);
            }
            if (list is null || list.OwnerUserId != user.Id || list.OpenAccess || list.Shares.Count != 0 || !Contains(list, item.Id))
                throw new IOException("Jellyfin could not save this film to your private Watchlist. Please try again.");
        }
        else if (list is not null && Contains(list, item.Id))
        {
            await playlists.RemoveItemFromPlaylistAsync(list.Id.ToString("N"), [item.Id.ToString("N")]);
            list = playlists.GetPlaylistForUser(list.Id, user.Id);
            if (list is not null && Contains(list, item.Id)) throw new IOException("Jellyfin could not remove this film from your Watchlist. Please try again.");
        }
    }
    private sealed record SeriesWatchlist(int Version, Guid[] ItemIds);
}
public sealed class WatchlistException(string message) : Exception(message);
