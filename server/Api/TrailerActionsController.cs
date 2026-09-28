using Jellyfin.Plugin.TvItemLayout.Watchlists;
using System.Text.Json.Serialization;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif
using MediaBrowser.Common.Extensions;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Playlists;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Jellyfin.Plugin.TvItemLayout.Integration;

namespace Jellyfin.Plugin.TvItemLayout.Api;

/// <summary>Actions for the current device's trailer, never the feature it advertises before.</summary>
[ApiController]
[Route("TvItemLayout/TrailerActions")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TrailerActionsController(
    IAuthorizationContext authorizationContext,
    ISessionManager sessionManager,
    IUserManager userManager,
    IDeviceManager deviceManager,
    INetworkManager networkManager,
    ILibraryManager libraryManager,
    IPlaylistManager playlistManager, PlaybackQueueStore playbackQueues) : ControllerBase
{
    private async Task<(User User, SessionInfo Session)?> CurrentSession()
    {
        var auth = await authorizationContext.GetAuthorizationInfo(HttpContext);
        if (string.IsNullOrWhiteSpace(auth.Token) || string.IsNullOrWhiteSpace(auth.DeviceId)
            || auth.UserId == Guid.Empty || auth.IsApiKey) return null;
        var ip = HttpContext.GetNormalizedRemoteIP();
        var session = await sessionManager.GetSessionByAuthenticationToken(auth.Token, auth.DeviceId, ip.ToString());
        if (session is null || session.UserId != auth.UserId
            || !string.Equals(session.DeviceId, auth.DeviceId, StringComparison.Ordinal)) return null;
        var user = userManager.GetUserById(auth.UserId);
        if (user is null || user.HasPermission(PermissionKind.IsDisabled) || !user.IsParentalScheduleAllowed()
            || !deviceManager.CanAccessDevice(user, auth.DeviceId)
            || (!networkManager.IsInLocalNetwork(ip) && !user.HasPermission(PermissionKind.EnableRemoteAccess))) return null;
        return (user, session);
    }

    private static bool Trailer(BaseItem item) => item is MediaBrowser.Controller.Entities.Trailer || item.ExtraType == ExtraType.Trailer;

    private BaseItem? CurrentTrailer(SessionInfo session, TrailerActionRequest expected)
    {
        if (session.NowPlayingItem?.Id != expected.PlayingItemId
            || (!string.IsNullOrEmpty(expected.PlaylistItemId)
                && !string.Equals(session.PlaylistItemId, expected.PlaylistItemId, StringComparison.Ordinal))) return null;
        var current = libraryManager.GetItemById(expected.PlayingItemId);
        return current is not null && Trailer(current) ? current : null;
    }

    private bool IsCurrentTrailer(SessionInfo session, User user, TrailerActionRequest expected, out BaseItem? trailer)
    {
        trailer = null;
        var current = CurrentTrailer(session, expected);
        if (current is null) return false;
        var queue = playbackQueues.GetQueue(session).ToArray();
        var positions = queue.Select((entry, index) => (entry, index)).Where(pair => pair.entry.Id == current.Id
            && (string.IsNullOrEmpty(session.PlaylistItemId) || pair.entry.PlaylistItemId == session.PlaylistItemId)).ToArray();
        if (positions.Length != 1) return false;
        // A manually opened trailer has no following feature. Stop at an unknown
        // entry rather than guessing past a stale or unrelated queue item.
        for (var i = positions[0].index + 1; i < Math.Min(queue.Length, positions[0].index + 33); i++)
        {
            var next = libraryManager.GetItemById(queue[i].Id);
            if (next is null) return false;
            if (Trailer(next) || next.GetType() == typeof(Video)) continue;
            if (next is not Movie || !next.IsVisibleStandalone(user)) return false;
            trailer = current;
            return true;
        }
        return false;
    }

    private Movie? AdvertisedMovie(BaseItem trailer, User user)
    {
        // Jellyfin extras have an OwnerId; ParentId is deliberately empty. A
        // trailer title or the upcoming feature is not evidence of its owner.
        if (trailer.OwnerId == Guid.Empty || libraryManager.GetItemById(trailer.OwnerId) is not Movie movie
            || movie.Id == trailer.Id || string.IsNullOrWhiteSpace(movie.Name)
            || movie.IsVirtualItem || movie.IsPlaceHolder || !movie.IsVisibleStandalone(user)) return null;
        return movie;
    }

    private Playlist[] Watchlists(User user) => WatchlistService.MovieLists(playlistManager, user);
    private static bool Contains(Playlist playlist, Guid id) => WatchlistService.Contains(playlist, id);

    private static TrailerActionsResponse Describe(string? playlistItemId, BaseItem trailer, Movie? movie, Playlist? list) =>
        new(trailer.Id, playlistItemId, movie is null ? null : new(movie.Id, movie.Name),
            movie is not null && list is not null && Contains(list, movie.Id), list?.Id);

    private static bool Valid(TrailerActionRequest request) => request.PlayingItemId != Guid.Empty
        && (request.PlaylistItemId is null || request.PlaylistItemId.Length <= 256);

    [HttpGet("~/TvItemLayout/TrailerDetails")]
    public async Task<IActionResult> GetTrailerDetails([FromQuery] Guid playingItemId, [FromQuery] string? playlistItemId = null)
    {
        var current = await CurrentSession();
        if (current is null) return Unauthorized();
        var expected = new TrailerActionRequest(playingItemId, playlistItemId);
        if (!Valid(expected)) return BadRequest("Invalid trailer identity.");
        var (user, session) = current.Value;
        var trailer = CurrentTrailer(session, expected);
        if (trailer is null) return new JsonResult(null);
        // Standalone trailers still have an advertised film. Metadata needs no
        // following feature and must not grant cinema-only Skip or Save actions.
        var movie = AdvertisedMovie(trailer, user);
        return Ok(new TrailerDetailsResponse(trailer.Id, session.PlaylistItemId,
            movie is null ? null : new(movie.Id, movie.Name)));
    }

    [HttpGet]
    public async Task<IActionResult> GetTrailerActions([FromQuery] Guid playingItemId, [FromQuery] string? playlistItemId = null)
    {
        var current = await CurrentSession();
        if (current is null) return Unauthorized();
        var expected = new TrailerActionRequest(playingItemId, playlistItemId);
        if (!Valid(expected)) return BadRequest("Invalid trailer identity.");
        var (user, session) = current.Value;
        if (!IsCurrentTrailer(session, user, expected, out var trailer)) return new JsonResult(null);
        var movie = AdvertisedMovie(trailer!, user);
        var lists = movie is null ? [] : Watchlists(user);
        // An ambiguous destination cannot hide the independent Skip trailer action.
        return Ok(Describe(session.PlaylistItemId, trailer!, movie, lists.Length == 1 ? lists[0] : null));
    }

    [HttpPost("Watchlist")]
    [RequestSizeLimit(2048)]
    public async Task<IActionResult> AddTrailerToWatchlist([FromBody] TrailerActionRequest expected, CancellationToken cancellationToken = default)
    {
        var initial = await CurrentSession();
        if (initial is null) return Unauthorized();
        if (!Valid(expected)) return BadRequest("Invalid trailer identity.");
        using var userLock = await WatchlistService.Acquire(initial.Value.User.Id, cancellationToken);
        // Waiting for another device must not let a stale trailer click save
        // the next trailer or continue with a revoked account/session.
        var current = await CurrentSession();
        if (current is null || current.Value.User.Id != initial.Value.User.Id) return Unauthorized();
        var (user, session) = current.Value;
        if (!IsCurrentTrailer(session, user, expected, out var trailer)) return Conflict("This trailer has finished. Try again on the current trailer.");
        var playlistItemId = session.PlaylistItemId;
        var movie = AdvertisedMovie(trailer!, user);
        if (movie is null) return NotFound("The film advertised by this trailer is not available in your library.");
        var lists = Watchlists(user);
        if (lists.Length > 1) return UnprocessableEntity("You have more than one private video playlist named Watchlist. Rename one before adding films.");
        var list = lists.FirstOrDefault();
        cancellationToken.ThrowIfCancellationRequested();
        if (list is null)
        {
            var created = await playlistManager.CreatePlaylist(new PlaylistCreationRequest
            {
                Name = "Watchlist", UserId = user.Id, Public = false, Users = [],
                ItemIdList = [movie.Id], MediaType = MediaType.Video
            });
            list = playlistManager.GetPlaylistForUser(Guid.Parse(created.Id), user.Id);
            if (list is null || list.OwnerUserId != user.Id || list.OpenAccess || list.Shares.Count != 0)
                return StatusCode(500, "Jellyfin could not create your private Watchlist. Please try again.");
        }
        else if (!Contains(list, movie.Id))
        {
#if JELLYFIN_12
            await playlistManager.AddItemToPlaylistAsync(list.Id, [movie.Id], null, user.Id);
#else
            await playlistManager.AddItemToPlaylistAsync(list.Id, [movie.Id], user.Id);
#endif
            list = playlistManager.GetPlaylistForUser(list.Id, user.Id);
        }
        if (list is null || !Contains(list, movie.Id)) return StatusCode(500, "Jellyfin could not save the film to your Watchlist. Please try again.");
        return Ok(Describe(playlistItemId, trailer!, movie, list));
    }
}

public sealed record TrailerActionRequest(
    [property: JsonPropertyName("PlayingItemId")] Guid PlayingItemId,
    [property: JsonPropertyName("PlaylistItemId")] string? PlaylistItemId = null);
public sealed record TrailerMovie(
    [property: JsonPropertyName("Id")] Guid Id,
    [property: JsonPropertyName("Name")] string Name);
public sealed record TrailerDetailsResponse(
    [property: JsonPropertyName("PlayingItemId")] Guid PlayingItemId,
    [property: JsonPropertyName("PlaylistItemId")] string? PlaylistItemId,
    [property: JsonPropertyName("Movie"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] TrailerMovie? Movie);
public sealed record TrailerActionsResponse(
    [property: JsonPropertyName("PlayingItemId")] Guid PlayingItemId,
    [property: JsonPropertyName("PlaylistItemId")] string? PlaylistItemId,
    [property: JsonPropertyName("Movie"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] TrailerMovie? Movie,
    [property: JsonPropertyName("InWatchlist")] bool InWatchlist,
    [property: JsonPropertyName("WatchlistId")] Guid? WatchlistId);
