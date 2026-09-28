using System.Text.Json.Serialization;
using Jellyfin.Data.Enums;
#if JELLYFIN_1010
using User = Jellyfin.Data.Entities.User;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using User = Jellyfin.Database.Implementations.Entities.User;
#endif
using Jellyfin.Plugin.TvItemLayout.Watchlists;
using MediaBrowser.Common.Extensions;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Querying;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TvItemLayout.Api;

[ApiController]
[Route("TvItemLayout/Watchlist")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class WatchlistController(IAuthorizationContext authorizationContext, ISessionManager sessionManager,
    IUserManager userManager, IDeviceManager deviceManager, INetworkManager networkManager,
    ILibraryManager libraryManager, IDtoService dtoService, WatchlistService watchlists) : ControllerBase
{
    private async Task<User?> CurrentUser()
    {
        var auth = await authorizationContext.GetAuthorizationInfo(HttpContext);
        if (string.IsNullOrWhiteSpace(auth.Token) || string.IsNullOrWhiteSpace(auth.DeviceId) || auth.UserId == Guid.Empty || auth.IsApiKey) return null;
        var ip = HttpContext.GetNormalizedRemoteIP();
        var session = await sessionManager.GetSessionByAuthenticationToken(auth.Token, auth.DeviceId, ip.ToString());
        if (session is null || session.UserId != auth.UserId || session.DeviceId != auth.DeviceId) return null;
        var user = userManager.GetUserById(auth.UserId);
        if (user is null || user.HasPermission(PermissionKind.IsDisabled) || !user.IsParentalScheduleAllowed()
            || !deviceManager.CanAccessDevice(user, auth.DeviceId)
            || (!networkManager.IsInLocalNetwork(ip) && !user.HasPermission(PermissionKind.EnableRemoteAccess))) return null;
        return user;
    }
    private IEnumerable<BaseItem> Allowed(User user, string type = "All") => libraryManager.GetItemList(new InternalItemsQuery(user)
    {
        IncludeItemTypes = type == "Movie" ? [BaseItemKind.Movie] : type == "Series" ? [BaseItemKind.Series] : [BaseItemKind.Movie, BaseItemKind.Series],
        Recursive = true, IsVirtualItem = false, IsMissing = false, EnableTotalRecordCount = false
    }).Where(item => item is Movie or Series && !item.IsVirtualItem && (item is not Video video || !video.IsPlaceHolder));

    [HttpGet]
    public async Task<IActionResult> GetWatchlist([FromQuery] string type = "All", [FromQuery] int startIndex = 0,
        [FromQuery] int limit = 60, [FromQuery] string sort = "title", [FromQuery] Guid? parentId = null,
        [FromQuery] string? searchTerm = null, [FromQuery] string? letter = null, [FromQuery] Guid? genreId = null,
        CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if (type is not ("All" or "Movie" or "Series") || startIndex < 0 || limit is < 1 or > 200
            || sort is not ("collection" or "title" or "title-desc" or "newest" or "oldest")
            || searchTerm?.Length > 200 || letter is not null && (letter.Length != 1 || letter[0] != '#' && !char.IsAsciiLetter(letter[0]))
            || parentId == Guid.Empty || genreId == Guid.Empty) return BadRequest("Invalid Watchlist query.");
        try
        {
            var saved = await watchlists.ReadIds(user, cancellationToken);
            var matching = Allowed(user, type).Where(item => saved.Contains(item.Id));
            if (parentId.HasValue || genreId.HasValue)
            {
                // First intersect the unrestricted native user query, because explicit
                // IDs/parents alone can bypass Jellyfin's permitted library roots.
                var scoped = libraryManager.GetItemList(new InternalItemsQuery(user)
                {
                    ParentId = parentId ?? Guid.Empty, GenreIds = genreId.HasValue ? [genreId.Value] : [], Recursive = true,
                    IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series], EnableTotalRecordCount = false
                }).Select(item => item.Id).ToHashSet();
                matching = matching.Where(item => scoped.Contains(item.Id));
            }
            if (!string.IsNullOrWhiteSpace(searchTerm)) matching = matching.Where(item => item.Name.Contains(searchTerm.Trim(), StringComparison.OrdinalIgnoreCase));
            if (letter is not null) matching = letter == "#"
                ? matching.Where(item => item.SortName.Length == 0 || !char.IsAsciiLetter(item.SortName[0]))
                : matching.Where(item => item.SortName.StartsWith(letter, StringComparison.OrdinalIgnoreCase));
            var order = saved.Select((id, index) => (id, index)).ToDictionary(pair => pair.id, pair => pair.index);
            IOrderedEnumerable<BaseItem> sorted = sort switch
            {
                "collection" => matching.OrderBy(item => order.GetValueOrDefault(item.Id, int.MaxValue)),
                "title-desc" => matching.OrderByDescending(item => item.SortName, StringComparer.OrdinalIgnoreCase),
                "newest" => matching.OrderBy(item => item.ProductionYear is null).ThenByDescending(item => item.ProductionYear),
                "oldest" => matching.OrderBy(item => item.ProductionYear is null).ThenBy(item => item.ProductionYear),
                _ => matching.OrderBy(item => item.SortName, StringComparer.OrdinalIgnoreCase)
            };
            var items = sorted.ThenBy(item => item.SortName, StringComparer.OrdinalIgnoreCase).ThenBy(item => item.Id).ToArray();
            var options = new DtoOptions(false) { EnableImages = true, EnableUserData = true,
                Fields = [ItemFields.Overview, ItemFields.Genres, ItemFields.DateCreated, ItemFields.PrimaryImageAspectRatio, ItemFields.ProviderIds] };
            return Ok(new WatchlistResponse(items.Skip(startIndex).Take(limit).Select(item => dtoService.GetBaseItemDto(item, options, user)).ToArray(), items.Length, startIndex));
        }
        catch (WatchlistException error) { return UnprocessableEntity(error.Message); }
    }

    [HttpGet("{itemId}")]
    public async Task<IActionResult> GetWatchlistState(Guid itemId, CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if (itemId == Guid.Empty) return BadRequest("Invalid Watchlist item.");
        if (!Allowed(user).Any(item => item.Id == itemId)) return NotFound("This film or TV show is not available in your library.");
        try { return Ok(new WatchlistState(itemId, (await watchlists.ReadIds(user, cancellationToken)).Contains(itemId))); }
        catch (WatchlistException error) { return UnprocessableEntity(error.Message); }
    }
    [HttpPost("{itemId}")]
    [RequestSizeLimit(2048)]
    public Task<IActionResult> AddToWatchlist(Guid itemId, CancellationToken cancellationToken = default) => Set(itemId, true, cancellationToken);
    [HttpDelete("{itemId}")]
    public Task<IActionResult> RemoveFromWatchlist(Guid itemId, CancellationToken cancellationToken = default) => Set(itemId, false, cancellationToken);
    private async Task<IActionResult> Set(Guid itemId, bool saved, CancellationToken cancellationToken)
    {
        var initial = await CurrentUser();
        if (initial is null) return Unauthorized();
        if (itemId == Guid.Empty) return BadRequest("Invalid Watchlist item.");
        using var lease = await WatchlistService.Acquire(initial.Id, cancellationToken);
        var user = await CurrentUser();
        if (user is null || user.Id != initial.Id) return Unauthorized();
        var item = Allowed(user).FirstOrDefault(item => item.Id == itemId);
        if (item is null) return NotFound("This film or TV show is not available in your library.");
        try
        {
            await watchlists.Set(user, item, saved, cancellationToken);
            return Ok(new WatchlistState(itemId, saved));
        }
        catch (WatchlistException error) { return UnprocessableEntity(error.Message); }
    }
}
public sealed record WatchlistState([property: JsonPropertyName("ItemId")] Guid ItemId, [property: JsonPropertyName("InWatchlist")] bool InWatchlist);
public sealed record WatchlistResponse([property: JsonPropertyName("Items")] BaseItemDto[] Items,
    [property: JsonPropertyName("TotalRecordCount")] int TotalRecordCount, [property: JsonPropertyName("StartIndex")] int StartIndex);
