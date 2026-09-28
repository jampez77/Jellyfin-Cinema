using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Data.Enums;
#if JELLYFIN_1010
using User = Jellyfin.Data.Entities.User;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using User = Jellyfin.Database.Implementations.Entities.User;
#endif
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout.Api;
using Jellyfin.Plugin.TvItemLayout.Providers;
using Jellyfin.Plugin.TvItemLayout.Watchlists;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Playlists;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class WatchlistChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "screenharbour-watchlist-" + Guid.NewGuid().ToString("N"));
        var user = new User("watchlist-user", "default", "reset") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.IsDisabled, false); user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        user.SetPreference(PreferenceKind.BlockedTags, ["restricted"]);
        var auth = new AuthorizationInfo { Token = "watchlist-token", DeviceId = "watchlist-device", User = user };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        SessionInfo session = null!;
        var sessions = InterfaceStub.Create<ISessionManager>((_, _) => Task.FromResult(session));
        session = new(sessions, NullLogger.Instance) { UserId = user.Id, DeviceId = auth.DeviceId };
        var users = InterfaceStub.Create<IUserManager>((_, args) => (Guid)args![0]! == user.Id ? user : null);
        var allowedDevice = true; var local = true;
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => allowedDevice);
        var network = InterfaceStub.Create<INetworkManager>((_, _) => local);
        var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath" ? directory : throw new Exception("Unexpected Watchlist path"));
        var alpha = new Movie { Id = Guid.NewGuid(), Name = "Alpha", SortName = "Alpha", ProductionYear = 2024 };
        var beta = new Movie { Id = Guid.NewGuid(), Name = "Beta", SortName = "Beta", ProductionYear = 2001 };
        var digits = new Movie { Id = Guid.NewGuid(), Name = "12 Monkeys", SortName = "12 Monkeys" };
        var show = new Series { Id = Guid.NewGuid(), Name = "Northern lights", SortName = "Northern lights", ProductionYear = 2020 };
        var show2 = new Series { Id = Guid.NewGuid(), Name = "Another series", SortName = "Another series" };
        var hidden = new Movie { Id = Guid.NewGuid(), Name = "Restricted movie" };
        var episode = new Episode { Id = Guid.NewGuid(), Name = "Episode" };
        alpha.ProviderIds["Tmdb"] = "1"; beta.ProviderIds["Tmdb"] = "3"; show.ProviderIds["Tmdb"] = "2";
        BaseItem[] permitted = [alpha, beta, digits, show, show2];
        var scopedIds = new HashSet<Guid> { alpha.Id, show.Id };
        var parentId = Guid.NewGuid(); var genreId = Guid.NewGuid();
        var libraryQueries = 0;
        var library = InterfaceStub.Create<ILibraryManager>((method, args) =>
        {
            if (method.Name == "GetItemById") return permitted.Concat([hidden, episode]).FirstOrDefault(item => item.Id == (Guid)args![0]!);
            if (method.Name != "GetItemList") throw new Exception("Watchlist permissions must use native user-scoped queries");
            var query = (InternalItemsQuery)args![0]!; libraryQueries++;
            if (!ReferenceEquals(query.User, user) || !query.Recursive || query.ItemIds.Length != 0 || query.AncestorIds.Length != 0
                || query.TopParentIds.Length != 0 || !query.ExcludeInheritedTags.Contains("restricted")) throw new Exception("Watchlist query lost user restrictions");
            return permitted.Where(item => query.IncludeItemTypes.Contains(item is Series ? BaseItemKind.Series : BaseItemKind.Movie))
                .Where(item => query.ParentId == Guid.Empty && query.GenreIds.Count == 0 || scopedIds.Contains(item.Id)).ToList();
        });
        var dtos = InterfaceStub.Create<IDtoService>((_, args) =>
        {
            if (!ReferenceEquals(args![2], user) || !((DtoOptions)args[1]!).EnableUserData) throw new Exception("Watchlist DTO lost user data isolation");
            var item = (BaseItem)args[0]!;
            return new BaseItemDto { Id = item.Id, Name = item.Name, Type = item is Series ? BaseItemKind.Series : BaseItemKind.Movie };
        });
        var legacy = new Playlist { Id = Guid.NewGuid(), Name = "Watchlist", OwnerUserId = user.Id,
            LinkedChildren = [new() { ItemId = alpha.Id }, new() { ItemId = hidden.Id }, new() { ItemId = show.Id }, new() { ItemId = episode.Id }, new() { ItemId = Guid.NewGuid() }] };
        var lists = new List<Playlist> { legacy };
        var writes = 0;
        var playlists = InterfaceStub.Create<IPlaylistManager>((method, args) =>
        {
            if (method.Name == "GetPlaylists") return lists.ToArray();
            if (method.Name == "GetPlaylistForUser") return lists.SingleOrDefault(list => list.Id == (Guid)args![0]! && list.OwnerUserId == (Guid)args[1]!);
            if (method.Name == "CreatePlaylist")
            {
                var request = (PlaylistCreationRequest)args![0]!;
                if (request.UserId != user.Id || request.Public != false || request.Users.Count != 0 || request.MediaType != MediaType.Video)
                    throw new Exception("Watchlist creation must remain native and private");
                var list = new Playlist { Id = Guid.NewGuid(), Name = request.Name, OwnerUserId = user.Id,
                    LinkedChildren = request.ItemIdList.Select(id => new LinkedChild { ItemId = id }).ToArray() };
                lists.Add(list); writes++; return Task.FromResult(new PlaylistCreationResult(list.Id.ToString("N")));
            }
            if (method.Name == "AddItemToPlaylistAsync")
            {
                var list = lists.Single(list => list.Id == (Guid)args![0]!);
                var ids = (IReadOnlyCollection<Guid>)args![1]!;
                if (list.OwnerUserId != user.Id || (Guid)args[^1]! != user.Id || ids.Any(id => permitted.Any(item => item.Id == id && item is Series)))
                    throw new Exception("Series must never enter Jellyfin's episode-expanding native playlist API");
                list.LinkedChildren = [.. list.LinkedChildren, .. ids.Select(id => new LinkedChild { ItemId = id })];
                writes++; return Task.CompletedTask;
            }
            if (method.Name == "RemoveItemFromPlaylistAsync")
            {
                var list = lists.Single(list => list.Id.ToString("N") == (string)args![0]!);
                var ids = ((IEnumerable<string>)args![1]!).Select(Guid.Parse).ToHashSet();
                list.LinkedChildren = list.LinkedChildren.Where(link => !ids.Contains(link.ItemId!.Value)).ToArray();
                writes++; return Task.CompletedTask;
            }
            throw new Exception("Unexpected native Watchlist operation");
        });
        var service = new WatchlistService(playlists, paths, library);
        WatchlistController Controller(WatchlistService? store = null)
        {
            var result = new WatchlistController(authorization, sessions, users, devices, network, library, dtos, store ?? service)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            result.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback; return result;
        }
        var controller = Controller();
        WatchlistResponse Value(IActionResult result) => (WatchlistResponse)((OkObjectResult)result).Value!;
        WatchlistState State(IActionResult result) => (WatchlistState)((OkObjectResult)result).Value!;
        try
        {
            assert(typeof(WatchlistController).GetCustomAttribute<AuthorizeAttribute>() is not null
                && typeof(WatchlistController).GetCustomAttribute<ResponseCacheAttribute>()?.NoStore == true,
                "Watchlist endpoints require authentication and prohibit shared HTTP caching");
            assert(Value(await controller.GetWatchlist()).Items.Single().Id == alpha.Id && writes == 0
                && State(await controller.GetWatchlistState(alpha.Id)).InWatchlist,
                "Existing trailer-saved movies appear immediately without migration; restricted, stale and episode entries are excluded");
            assert(await controller.GetWatchlistState(hidden.Id) is NotFoundObjectResult && await controller.AddToWatchlist(hidden.Id) is NotFoundObjectResult
                && await controller.AddToWatchlist(episode.Id) is NotFoundObjectResult,
                "Watchlist cannot disclose or save restricted items or individual episodes");
            var saved = await Task.WhenAll(controller.AddToWatchlist(show.Id), Controller().AddToWatchlist(show.Id), Controller().AddToWatchlist(show2.Id));
            assert(saved.All(result => State(result).InWatchlist) && writes == 0
                && Value(await Controller(new WatchlistService(playlists, paths, library)).GetWatchlist(type: "Series")).TotalRecordCount == 2,
                "Concurrent TV show saves persist once across restarted services without creating episode playlist entries");
            await controller.RemoveFromWatchlist(show.Id);
            assert(!State(await controller.GetWatchlistState(show.Id)).InWatchlist && legacy.LinkedChildren.Any(link => link.ItemId == show.Id),
                "Native Series links are never imported as movie membership; removing a saved show cannot leave ghost membership");
            await controller.AddToWatchlist(show.Id);
            assert(Value(await controller.GetWatchlist(type: "Movie")).Items.Single().Id == alpha.Id
                && Value(await controller.GetWatchlist(type: "All")).TotalRecordCount == 3,
                "Movie tabs exclude series while Home's Watchlist includes both media types");
            await controller.AddToWatchlist(beta.Id); await controller.AddToWatchlist(beta.Id); await controller.AddToWatchlist(digits.Id);
            assert(writes == 2 && lists.Single().Id == legacy.Id && State(await controller.GetWatchlistState(beta.Id)).InWatchlist,
                "Movie details reuse the exact trailer Watchlist and repeated adds are idempotent");
            var page = Value(await controller.GetWatchlist(startIndex: 1, limit: 1, sort: "title"));
            assert(page.Items.Single().Id == alpha.Id && page.TotalRecordCount == 5 && page.StartIndex == 1
                && Value(await controller.GetWatchlist(type: "Movie", letter: "#")).Items.Single().Id == digits.Id
                && Value(await controller.GetWatchlist(searchTerm: "northern")).Items.Single().Id == show.Id,
                "Watchlist pagination, total counts, title search and alphabet filtering operate on the saved subset");
            assert(Value(await controller.GetWatchlist(parentId: parentId, genreId: genreId)).TotalRecordCount == 2
                && Value(await controller.GetWatchlist(sort: "newest")).Items.First().Id == alpha.Id
                && Value(await controller.GetWatchlist(sort: "oldest")).Items.First().Id == beta.Id,
                "Library and genre scope intersect permitted saved items; release-year sorts keep unknown years last");
            await controller.RemoveFromWatchlist(beta.Id); await controller.RemoveFromWatchlist(beta.Id);
            await controller.RemoveFromWatchlist(show2.Id); await controller.RemoveFromWatchlist(show2.Id);
            assert(writes == 3 && !State(await controller.GetWatchlistState(beta.Id)).InWatchlist
                && !State(await controller.GetWatchlistState(show2.Id)).InWatchlist && Value(await controller.GetWatchlist()).TotalRecordCount == 3,
                "Removing movies and series is idempotent and leaves other saved items intact");
            var firstUser = user.Id; user.Id = Guid.NewGuid(); session.UserId = user.Id;
            assert(Value(await controller.GetWatchlist()).TotalRecordCount == 0, "Accounts cannot read another user's film playlist or saved series");
            await controller.AddToWatchlist(show2.Id); await controller.AddToWatchlist(beta.Id);
            user.Id = firstUser; session.UserId = user.Id;
            assert(Value(await controller.GetWatchlist()).TotalRecordCount == 3 && !State(await controller.GetWatchlistState(show2.Id)).InWatchlist,
                "Independent account writes do not change the first user's Watchlist");
            legacy.OpenAccess = true;
            assert(Value(await controller.GetWatchlist(type: "Movie")).TotalRecordCount == 0, "Public Watchlist playlists cannot become a personal Watchlist");
            legacy.OpenAccess = false; legacy.Shares = [new PlaylistUserPermissions(Guid.NewGuid(), false)];
            assert(Value(await controller.GetWatchlist(type: "Movie")).TotalRecordCount == 0, "Shared Watchlist playlists cannot expose a private user's saved row");
            legacy.Shares = []; lists.Add(new Playlist { Id = Guid.NewGuid(), Name = "Watchlist", OwnerUserId = user.Id });
            assert(await controller.GetWatchlist() is UnprocessableEntityObjectResult && await controller.AddToWatchlist(alpha.Id) is UnprocessableEntityObjectResult,
                "Ambiguous existing Watchlists fail clearly instead of selecting another destination");
            lists.RemoveAt(lists.Count - 1);

            await ProviderAndHttp();
            var before = libraryQueries;
            auth.IsApiKey = true;
            assert(await controller.GetWatchlist() is UnauthorizedResult && await controller.AddToWatchlist(alpha.Id) is UnauthorizedResult,
                "API keys cannot impersonate personal Watchlist reads or writes");
            auth.IsApiKey = false; session.DeviceId = "different";
            assert(await controller.GetWatchlistState(alpha.Id) is UnauthorizedResult, "Watchlist status rejects a mismatched device session");
            session.DeviceId = auth.DeviceId; allowedDevice = false;
            assert(await controller.RemoveFromWatchlist(alpha.Id) is UnauthorizedResult, "Revoked device access cannot remove Watchlist items");
            allowedDevice = true; user.SetPermission(PermissionKind.IsDisabled, true);
            assert(await controller.GetWatchlist() is UnauthorizedResult, "Disabled users cannot read saved Watchlist items");
            user.SetPermission(PermissionKind.IsDisabled, false); local = false; user.SetPermission(PermissionKind.EnableRemoteAccess, false);
            assert(await controller.AddToWatchlist(alpha.Id) is UnauthorizedResult && libraryQueries == before,
                "Revoked remote access fails before Watchlist or library data is read");
            local = true;
            assert(await controller.GetWatchlist(type: "Episode") is BadRequestObjectResult && await controller.GetWatchlist(limit: 201) is BadRequestObjectResult
                && await controller.GetWatchlist(letter: "ab") is BadRequestObjectResult && await controller.GetWatchlist(startIndex: -1) is BadRequestObjectResult,
                "Malformed Watchlist filters and pagination are rejected");
            // Use an explicit lease for a deterministic queued mutation check.
            allowedDevice = true;
            var lease = await WatchlistService.Acquire(user.Id, default);
            var pending = Controller().AddToWatchlist(show2.Id);
            allowedDevice = false; lease.Dispose();
            assert(await pending is UnauthorizedResult, "A Watchlist mutation rechecks authorization after waiting for another device");
            allowedDevice = true;
            assert(!Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories).Any(), "Atomic series Watchlist saves leave no temporary files");
            var file = Path.Combine(directory, "jellyfin-cinema", "watchlists", user.Id.ToString("N") + ".json");
            var original = await File.ReadAllTextAsync(file); await File.WriteAllTextAsync(file, "{}");
            try { await controller.AddToWatchlist(show2.Id); throw new Exception("Corrupt Watchlist unexpectedly overwritten"); }
            catch (InvalidDataException) { assert(await File.ReadAllTextAsync(file) == "{}", "Corrupt saved series fail visibly and are never overwritten as an empty Watchlist"); }
            await File.WriteAllTextAsync(file, original);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

        async Task ProviderAndHttp()
        {
            string[] lookedUp = [];
            var availability = InterfaceStub.Create<IProviderAvailability>((_, args) =>
            {
                lookedUp = ((IEnumerable<string>)args![0]!).ToArray();
                return Task.FromResult(new ProviderCacheSnapshot(new Dictionary<string, ProviderMembership>
                { ["movie:1"] = new([8], [], []), ["tv:2"] = new([9], [], []), ["movie:3"] = new([8], [], []) }, 0, 0, lookedUp.Length, DateTimeOffset.UtcNow, "ready"));
            });
            var source = new TmdbProviderSource(InterfaceStub.Create<IHttpClientFactory>((_, _) => throw new Exception("Watchlist reads must use cached provider availability")));
            var provider = new ProviderItemsController(authorization, sessions, users, devices, network, library, dtos, availability, paths, source, service)
            { ControllerContext = controller.ControllerContext };
            var draft = JsonSerializer.SerializeToElement(new { id = "custom-mixed", name = "Mixed", logoUrl = "", accent = "#123456",
                movieProviderIds = new[] { 8 }, showProviderIds = new[] { 9 }, offerTypes = new[] { "flatrate" }, enabled = true, hero = true,
                rows = new[] { new { id = "watch", title = "Watchlist", source = "watchlist", collectionId = "", enabled = true, ranked = false, itemSort = "title" } } });
            var result = (ProviderItemsResponse)((OkObjectResult)await provider.PreviewProviderItems(draft, mediaType: "Mixed", watchlist: true)).Value!;
            assert(result.Items.Select(item => item.Id).ToHashSet().SetEquals([alpha.Id, show.Id])
                && lookedUp.ToHashSet().SetEquals(["movie:1", "tv:2"]),
                "Mixed provider Watchlist intersects saved movies/shows with separate configured provider IDs and looks up no unsaved titles");
            var savedSettings = JsonSerializer.SerializeToElement(new { version = 2, enabled = true, title = "", placement = "start", tileScale = 100,
                showNames = true, providers = new[] { draft } });
            var settings = new ProviderHomesController(authorization, sessions, users, devices, network, paths) { ControllerContext = controller.ControllerContext };
            assert(await settings.PutProviderHomes(new(null, savedSettings)) is OkObjectResult
                && ((ProviderItemsResponse)((OkObjectResult)await provider.GetProviderItems("custom-mixed", type: "Mixed", watchlist: true)).Value!).TotalRecordCount == 2,
                "Saved provider Watchlist rows use the same mixed intersection as unsaved previews");
            var homeSettings = JsonSerializer.SerializeToElement(new { version = 1, rows = new[] { new { id = "watch", kind = "watchlist", title = "My Watchlist",
                collectionIds = Array.Empty<string>(), ranked = false, placement = "start", itemSort = "collection", itemOrder = Array.Empty<string>() } } });
            var homes = new HomeCollectionsController(authorization, sessions, users, devices, network, paths) { ControllerContext = controller.ControllerContext };
            assert(await homes.PutHomeCollections(new(null, homeSettings)) is OkObjectResult,
                "Main Home accepts an optional mixed Watchlist row without collection IDs or ranked cards");
            var invalidHome = JsonDocument.Parse(homeSettings.GetRawText().Replace("\"ranked\":false", "\"ranked\":true")).RootElement;
            assert(await homes.PutHomeCollections(new(null, invalidHome)) is BadRequestObjectResult,
                "Home Watchlist schema rejects collection-only ranked configuration");

            var builder = WebApplication.CreateBuilder(); builder.Logging.SetMinimumLevel(LogLevel.Warning); builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Services.AddSingleton(authorization); builder.Services.AddSingleton(sessions); builder.Services.AddSingleton(users);
            builder.Services.AddSingleton(devices); builder.Services.AddSingleton(network); builder.Services.AddSingleton(library); builder.Services.AddSingleton(dtos);
            builder.Services.AddSingleton(service); builder.Services.AddSingleton(paths); builder.Services.AddSingleton(availability); builder.Services.AddSingleton(source);
            builder.Services.AddAuthorization();
            builder.Services.AddControllers().AddApplicationPart(typeof(WatchlistController).Assembly).AddJsonOptions(options =>
            {
                var native = JsonDefaults.PascalCaseOptions; options.JsonSerializerOptions.DefaultIgnoreCondition = native.DefaultIgnoreCondition;
                options.JsonSerializerOptions.PropertyNamingPolicy = native.PropertyNamingPolicy;
                foreach (var converter in native.Converters) options.JsonSerializerOptions.Converters.Add(converter);
            });
            await using var app = builder.Build();
            app.Use(async (context, next) => { context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "watchlist-test")], "fixture")); await next(); });
            app.UseAuthorization(); app.MapControllers(); await app.StartAsync();
            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            using var client = new HttpClient { BaseAddress = new Uri(address) };
            try
            {
                using var list = await client.GetAsync("/TvItemLayout/Watchlist?type=All&limit=1&startIndex=0");
                var json = JsonDocument.Parse(await list.Content.ReadAsStringAsync()).RootElement;
                assert(list.IsSuccessStatusCode && list.Headers.CacheControl?.NoStore == true && json.GetProperty("TotalRecordCount").GetInt32() == 3
                    && json.GetProperty("Items").GetArrayLength() == 1 && json.GetProperty("StartIndex").GetInt32() == 0,
                    "Real Watchlist HTTP route binds pagination and preserves native DTO and explicit PascalCase response fields");
                using var providerList = await client.GetAsync("/TvItemLayout/Providers/custom-mixed/Items?type=Mixed&watchlist=true&limit=1");
                var providerJson = JsonDocument.Parse(await providerList.Content.ReadAsStringAsync()).RootElement;
                assert(providerList.IsSuccessStatusCode && providerJson.GetProperty("TotalRecordCount").GetInt32() == 2
                    && providerJson.GetProperty("Items").GetArrayLength() == 1 && providerJson.GetProperty("Status").GetString() == "ready",
                    "Real provider HTTP route binds Mixed and Watchlist filters with ordinary status and pagination fields");
                using var providerPreview = await client.PostAsJsonAsync("/TvItemLayout/Providers/Preview?mediaType=Mixed&watchlist=true", draft);
                var previewJson = JsonDocument.Parse(await providerPreview.Content.ReadAsStringAsync()).RootElement;
                assert(providerPreview.IsSuccessStatusCode && previewJson.GetProperty("Items").GetArrayLength() == 2,
                    "Real provider preview HTTP route filters the authenticated Watchlist using an unsaved mixed-media mapping");
                using var added = await client.PostAsJsonAsync("/TvItemLayout/Watchlist/" + beta.Id, new { UserId = Guid.NewGuid(), ItemId = hidden.Id });
                var membership = JsonDocument.Parse(await added.Content.ReadAsStringAsync()).RootElement;
                assert(added.IsSuccessStatusCode && membership.GetProperty("InWatchlist").GetBoolean()
                    && Guid.Parse(membership.GetProperty("ItemId").GetString()!) == beta.Id,
                    "Watchlist HTTP add ignores forged user/item body fields and uses only authenticated user plus route ID");
                using var removed = await client.DeleteAsync("/TvItemLayout/Watchlist/" + beta.Id);
                assert(removed.IsSuccessStatusCode && !JsonDocument.Parse(await removed.Content.ReadAsStringAsync()).RootElement.GetProperty("InWatchlist").GetBoolean(),
                    "Watchlist HTTP delete returns explicit false with Jellyfin's native serializer");
                using var invalid = await client.GetAsync("/TvItemLayout/Watchlist/not-a-guid");
                assert(invalid.StatusCode == HttpStatusCode.BadRequest, "Watchlist HTTP binding rejects malformed item identifiers");
                auth.IsApiKey = true;
                using var denied = await client.DeleteAsync("/TvItemLayout/Watchlist/" + alpha.Id);
                assert(denied.StatusCode == HttpStatusCode.Unauthorized, "Real Watchlist HTTP mutations reject API-key impersonation");
            }
            finally { auth.IsApiKey = false; await app.StopAsync(); }
        }
    }
}
