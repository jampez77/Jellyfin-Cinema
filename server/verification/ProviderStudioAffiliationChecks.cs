using System.Net;
using System.Text.Json;
using Jellyfin.Data.Enums;
#if JELLYFIN_1010
using User = Jellyfin.Data.Entities.User;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using User = Jellyfin.Database.Implementations.Entities.User;
#endif
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
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class ProviderStudioAffiliationChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "screenharbour-affiliation-" + Guid.NewGuid().ToString("N"));
        var user = new User("affiliation-user", "default", "reset") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.IsDisabled, false); user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        user.SetPreference(PreferenceKind.BlockedTags, ["restricted"]);
        var auth = new AuthorizationInfo { Token = "affiliation-token", DeviceId = "affiliation-device", User = user };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        SessionInfo session = null!;
        var sessions = InterfaceStub.Create<ISessionManager>((_, _) => Task.FromResult(session));
        session = new(sessions, NullLogger.Instance) { UserId = user.Id, DeviceId = auth.DeviceId };
        var users = InterfaceStub.Create<IUserManager>((_, _) => user);
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => true);
        var network = InterfaceStub.Create<INetworkManager>((_, _) => true);
        var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath" ? directory : throw new Exception("Unexpected affiliation path"));
        Movie Film(string name, string? tmdb, params string[] studios)
        {
            var item = new Movie { Id = Guid.NewGuid(), Name = name, SortName = name, Studios = studios };
            if (tmdb is not null) item.ProviderIds["Tmdb"] = tmdb;
            return item;
        }
        var animated = Film("Moana", "277834", "Walt Disney Animation Studios"); animated.ProductionYear = 2016;
        var liveAction = Film("Moana", "1108427", "Walt Disney Pictures", "Seven Bucks Productions"); liveAction.ProductionYear = 2026;
        var noId = Film("A Pixar film", null, "  pIxAr Animation Studios  ");
        var licensed = Film("Licensed film", "10", "Independent Productions");
        var unrelated = Film("Moana", "11", "Not Walt Disney Pictures", "Marvel Studios International", "Fox", "ABC", "Miramax", "Dimension Films");
        var series = new Series { Id = Guid.NewGuid(), Name = "A Marvel series", SortName = "A Marvel series", Studios = ["Marvel Television"] };
        var visible = new List<BaseItem> { animated, liveAction, noId, licensed, unrelated, series };
        InternalItemsQuery? seen = null; var libraryCalls = 0;
        var library = InterfaceStub.Create<ILibraryManager>((method, args) =>
        {
            if (method.Name != "GetItemList") throw new Exception("Affiliation must use only the native user-scoped library list");
            seen = (InternalItemsQuery)args![0]!; libraryCalls++;
            return visible.Where(item => seen.IncludeItemTypes.Contains(item is Series ? BaseItemKind.Series : BaseItemKind.Movie)).ToList();
        });
        var dtos = InterfaceStub.Create<IDtoService>((_, args) =>
        {
            if (!ReferenceEquals(args![2], user)) throw new Exception("Affiliated DTO escaped its account");
            var item = (BaseItem)args[0]!; return new BaseItemDto { Id = item.Id, Name = item.Name };
        });
        string[] lookedUp = []; var upstreamState = "ready";
        var availability = InterfaceStub.Create<IProviderAvailability>((_, args) =>
        {
            lookedUp = ((IEnumerable<string>)args![0]!).ToArray();
            var memberships = new Dictionary<string, ProviderMembership> { ["movie:10"] = new([337], [], []), ["movie:277834"] = new([337], [], []) };
            var pending = upstreamState == "refreshing" ? lookedUp.Length : 0;
            return Task.FromResult(new ProviderCacheSnapshot(memberships, pending, upstreamState == "unavailable" ? lookedUp.Length : 0,
                lookedUp.Length, lookedUp.Length > 0 ? DateTimeOffset.UtcNow : null, lookedUp.Length == 0 ? "ready" : upstreamState));
        });
        var source = new TmdbProviderSource(InterfaceStub.Create<IHttpClientFactory>((_, _) => throw new Exception("Affiliation must not fetch new metadata")));
        var watchlists = new WatchlistService(InterfaceStub.Create<IPlaylistManager>((method, _) => method.Name == "GetPlaylists" ? Array.Empty<Playlist>() : throw new Exception("Unexpected Watchlist write")), paths, library);
        var controller = new ProviderItemsController(authorization, sessions, users, devices, network, library, dtos, availability, paths, source, watchlists)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        controller.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
        ProviderItemsResponse Value(IActionResult result) => (ProviderItemsResponse)((OkObjectResult)result).Value!;
        JsonElement Draft(string id, int[] movieIds, int[] showIds, string[]? offers = null) => JsonSerializer.SerializeToElement(new
        { id, name = "Renamed service", logoUrl = "", accent = "#123456", movieProviderIds = movieIds, showProviderIds = showIds,
            offerTypes = offers ?? ["flatrate"], enabled = true, hero = true, rows = Array.Empty<object>() });
        try
        {
            var movies = Value(await controller.GetProviderItems("disney"));
            assert(movies.Items.Select(item => item.Id).ToHashSet().SetEquals([animated.Id, liveAction.Id, noId.Id, licensed.Id])
                && movies.TotalRecordCount == 4 && movies.MissingIds == 0 && lookedUp.ToHashSet().SetEquals(["movie:10", "movie:11"]),
                "Disney includes both Moana editions through their studios regardless of absent offers, includes metadata-free Pixar, and retains licensed availability matches");
            assert(seen is not null && ReferenceEquals(seen.User, user) && seen.Recursive && seen.IsVirtualItem == false && seen.IsMissing == false
                && seen.ItemIds.Length == 0 && seen.TopParentIds.Length == 0 && seen.AncestorIds.Length == 0 && seen.ExcludeInheritedTags.Contains("restricted"),
                "Studio matching preserves native library roots, missing/virtual exclusions and the current user's content restrictions");
            var ordered = movies.Items.Select(item => item.Id).ToArray();
            var first = Value(await controller.GetProviderItems("disney", limit: 2));
            var second = Value(await controller.GetProviderItems("disney", startIndex: 2, limit: 2));
            assert(first.Items.Concat(second.Items).Select(item => item.Id).SequenceEqual(ordered) && first.TotalRecordCount == second.TotalRecordCount
                && ordered.Distinct().Count() == 4 && Value(await controller.GetProviderItems("disney", sort: "newest")).Items.First().Id == liveAction.Id,
                "Studio and availability matches share stable paging and release sorting without duplicating titles");
            assert(Value(await controller.GetProviderItems("disney", type: "Series")).Items.Single().Id == series.Id
                && Value(await controller.GetProviderItems("disney", type: "Mixed")).TotalRecordCount == 5,
                "Disney studio matching includes television and mixed rows with the same membership rule");
            assert(Value(await controller.PreviewProviderItems(Draft("custom-disney", [337], [8]), mediaType: "Mixed")).TotalRecordCount == 4
                && Value(await controller.PreviewProviderItems(Draft("custom-disney", [8], [337]), mediaType: "Mixed")).Items.Single().Id == series.Id,
                "Custom service affiliation uses its distinct configured movie and TV provider IDs");
            assert(Value(await controller.PreviewProviderItems(Draft("disney", [8], [8]), mediaType: "Mixed")).TotalRecordCount == 0
                && Value(await controller.GetProviderItems("netflix", type: "Mixed")).TotalRecordCount == 0
                && Value(await controller.PreviewProviderItems(Draft("custom-disney", [337], [337], ["free"]), mediaType: "Mixed")).TotalRecordCount == 4,
                "A Disney route remapped away from Disney+ and other providers gain no studio matches; owned content is independent of offer types");
            var config = new ConfiguredProvider([337], [337], ["flatrate"], true);
            foreach (var studio in new[] { "Lucasfilm Ltd.", "Twentieth Century-Fox Film Corporation", "Fox Searchlight Pictures", "Blue Sky Studios", "Disney Television Animation", "ABC Signature", "20th Television", "FX Productions" })
                assert(ProviderStudioAffiliation.Includes(Film("A title", null, studio), config), "Disney production studio aliases include " + studio);
            assert(!ProviderStudioAffiliation.Includes(unrelated, config) && !ProviderStudioAffiliation.Includes(Film("Disney Pixar Marvel Lucasfilm Moana", null), config),
                "Affiliation rejects partial studio names, ambiguous networks, former unrelated subsidiaries and title-only guesses");
            visible = [animated, liveAction, noId, series]; upstreamState = "refreshing";
            var independent = Value(await controller.GetProviderItems("disney", type: "Mixed"));
            assert(independent.TotalRecordCount == 4 && independent.Pending == 0 && independent.Total == 0 && independent.MissingIds == 0
                && independent.Status == "ready" && lookedUp.Length == 0,
                "Already affiliated titles do not wait for availability jobs or produce missing-metadata diagnostics");
            upstreamState = "unavailable";
            assert(Value(await controller.GetProviderItems("disney", type: "Mixed")) is { TotalRecordCount: 4, Status: "ready", FailedIds: 0 },
                "Local Disney affiliations remain ready even when availability lookup is unavailable");
            visible = [unrelated, liveAction]; upstreamState = "refreshing";
            var partial = Value(await controller.GetProviderItems("disney"));
            assert(partial.Items.Single().Id == liveAction.Id && partial.Pending == 1 && lookedUp.SequenceEqual(["movie:11"]),
                "Disney films appear immediately while only unrelated candidates await availability");
            var unidentified = Film("Unidentified independent film", null, "Independent Productions");
            visible = [liveAction, unidentified];
            var locallyReady = Value(await controller.GetProviderItems("disney"));
            assert(locallyReady.Items.Single().Id == liveAction.Id && locallyReady.Status == "ready" && locallyReady.MissingIds == 1 && locallyReady.Total == 0,
                "Fresh Disney studio matches remain ready when an unrelated title has no TMDB metadata");
            visible = [unidentified];
            assert(Value(await controller.GetProviderItems("disney")) is { TotalRecordCount: 0, Status: "unavailable", MissingIds: 1 },
                "An unidentified catalogue without any local studio matches still reports unavailable");
            visible = [series];
            assert(Value(await controller.GetProviderItems("disney", type: "Mixed")).Items.Single().Id == series.Id,
                "Revoked movie library access removes formerly affiliated titles on the next read");
            var before = libraryCalls; user.SetPermission(PermissionKind.IsDisabled, true);
            assert(await controller.GetProviderItems("disney") is UnauthorizedResult && libraryCalls == before,
                "Disney affiliations cannot bypass a disabled account's authorization");
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
