using System.Net;
using System.Reflection;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif
using Jellyfin.Plugin.TvItemLayout.Api;
using Jellyfin.Plugin.TvItemLayout.Integration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Playlists;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Playlists;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class TrailerActionsChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        var user = new User("trailer-check", "default", "reset") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.IsDisabled, false);
        user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        var auth = new AuthorizationInfo { Token = "fixture-token", DeviceId = "fixture-device", User = user };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        SessionInfo session = null!;
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) =>
        {
            if (method.Name != "GetSessionByAuthenticationToken" || (string)args![0]! != auth.Token || (string)args[1]! != auth.DeviceId)
                throw new Exception("Trailer action must use only the authenticated device");
            return Task.FromResult(session);
        });
        var advertised = new TrailerCheckMovie { Id = Guid.NewGuid(), Name = "Advertised film" };
        var feature = new TrailerCheckMovie { Id = Guid.NewGuid(), Name = "Feature film" };
        var trailer = new Trailer { Id = Guid.NewGuid(), Name = "An unrelated trailer title", OwnerId = advertised.Id };
        var items = new Dictionary<Guid, BaseItem> { [advertised.Id] = advertised, [feature.Id] = feature, [trailer.Id] = trailer };
        var library = InterfaceStub.Create<ILibraryManager>((method, args) => method.Name == "GetItemById"
            ? items.GetValueOrDefault((Guid)args![0]!) : throw new Exception("Unexpected trailer library query"));
        var users = InterfaceStub.Create<IUserManager>((method, args) => method.Name == "GetUserById" && (Guid)args![0]! == user.Id
            ? user : throw new Exception("Trailer action cannot inspect another account"));
        var allowedDevice = true;
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => allowedDevice);
        var local = true;
        var network = InterfaceStub.Create<INetworkManager>((_, _) => local);
        var lists = new List<Playlist>();
        var creates = 0; var adds = 0;
        TaskCompletionSource? createStarted = null; TaskCompletionSource? finishCreate = null;
        async Task<PlaylistCreationResult> Create(PlaylistCreationRequest request)
        {
            assert(request.UserId == user.Id && request.Public == false && request.Users.Count == 0
                && request.MediaType == Jellyfin.Data.Enums.MediaType.Video
                && request.ItemIdList.SequenceEqual(new[] { advertised.Id }),
                "Watchlist creation is private, owned by the caller, and contains the advertised film only");
            creates++;
            createStarted?.TrySetResult();
            if (finishCreate is not null) await finishCreate.Task;
            var list = new Playlist { Id = Guid.NewGuid(), Name = request.Name, OwnerUserId = request.UserId,
                OpenAccess = false, Shares = [], LinkedChildren = [new LinkedChild { ItemId = advertised.Id }] };
            lists.Add(list);
            return new PlaylistCreationResult(list.Id.ToString("N"));
        }
        var playlists = InterfaceStub.Create<IPlaylistManager>((method, args) => method.Name switch
        {
            "GetPlaylists" => lists.ToArray(),
            "GetPlaylistForUser" => lists.SingleOrDefault(list => list.Id == (Guid)args![0]! && list.OwnerUserId == (Guid)args[1]!),
            "CreatePlaylist" => Create((PlaylistCreationRequest)args![0]!),
            "AddItemToPlaylistAsync" => Add(args!),
            _ => throw new Exception("Unexpected playlist operation")
        });
        Task Add(object?[] args)
        {
            var list = lists.Single(list => list.Id == (Guid)args[0]!);
            var movieIds = (IReadOnlyCollection<Guid>)args[1]!;
            assert(list.OwnerUserId == (Guid)args[^1]! && movieIds.SequenceEqual(new[] { advertised.Id }),
                "Appending a Watchlist item does not write to another user's list or save the feature");
            adds++;
            list.LinkedChildren = list.LinkedChildren.Concat(movieIds.Select(id => new LinkedChild { ItemId = id })).ToArray();
            return Task.CompletedTask;
        }
        var playbackQueues = new PlaybackQueueStore();
        void CaptureQueue() => playbackQueues.Record(session, new PlaybackStartInfo
        {
            ItemId = trailer.Id, PlaylistItemId = session.PlaylistItemId, PlaySessionId = "fixture-playback",
            NowPlayingQueue = session.NowPlayingQueue.ToArray()
        }, true, playbackQueues.NextSequence());
        void ResetPlayback()
        {
            session = new SessionInfo(sessions, NullLogger.Instance)
            {
                Id = "fixture-session", UserId = user.Id, DeviceId = auth.DeviceId, PlaylistItemId = "trailer-entry",
                NowPlayingItem = new BaseItemDto { Id = trailer.Id },
                NowPlayingQueue = [new QueueItem { Id = trailer.Id, PlaylistItemId = "trailer-entry" },
                    new QueueItem { Id = feature.Id, PlaylistItemId = "feature-entry" }]
            };
            CaptureQueue();
        }
        TrailerActionsController Controller()
        {
            var result = new TrailerActionsController(authorization, sessions, users, devices, network, library, playlists, playbackQueues)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            result.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
            return result;
        }
        var controller = Controller(); var second = Controller();
        var request = new TrailerActionRequest(trailer.Id, "trailer-entry");
        TrailerActionsResponse Value(IActionResult result) => (TrailerActionsResponse)((OkObjectResult)result).Value!;
        Task<IActionResult> Get() => controller.GetTrailerActions(trailer.Id, "trailer-entry");
        ResetPlayback();
        assert(typeof(TrailerActionsController).GetCustomAttribute<AuthorizeAttribute>() is not null
            && typeof(TrailerActionsController).GetCustomAttribute<ResponseCacheAttribute>()?.NoStore == true,
            "Trailer actions require authentication and never use shared HTTP caches");
        var initial = Value(await Get());
        assert(initial.Movie?.Id == advertised.Id && !initial.InWatchlist && initial.WatchlistId is null
            && trailer.ParentId == Guid.Empty, "Advertised film resolves from the trailer owner, never its title or upcoming feature");
        items[trailer.Id] = new Video { Id = trailer.Id, Name = "Trailer extra", ExtraType = ExtraType.Trailer, OwnerId = advertised.Id };
        assert(Value(await Get()).Movie?.Id == advertised.Id, "Video extras explicitly tagged Trailer resolve their advertised owner");
        items[trailer.Id] = new Video { Id = trailer.Id, Name = "Cinema bumper" };
        assert(await Get() is JsonResult { Value: null }, "An untagged cinema bumper cannot masquerade as a trailer");
        items[trailer.Id] = trailer;
        createStarted = new(); finishCreate = new();
        var firstAdd = controller.AddTrailerToWatchlist(request);
        await createStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var secondAdd = second.AddTrailerToWatchlist(request);
        finishCreate.SetResult();
        var results = await Task.WhenAll(firstAdd, secondAdd);
        createStarted = null; finishCreate = null;
        assert(results.All(result => Value(result).InWatchlist) && creates == 1 && adds == 0 && lists.Single().LinkedChildren.Length == 1,
            "Concurrent first adds create one private Watchlist with no duplicate film");
        assert(Value(await Get()).InWatchlist && Value(await controller.AddTrailerToWatchlist(request)).InWatchlist && creates == 1,
            "Watchlist membership persists across controller instances and repeated adds are idempotent");

        lists.Single().LinkedChildren = [];
        assert(Value(await second.AddTrailerToWatchlist(request)).InWatchlist && adds == 1 && creates == 1,
            "An existing private Watchlist is reused without changing its other metadata");
        var firstUser = user.Id;
        user.Id = Guid.NewGuid(); ResetPlayback();
        var own = Value(await Get());
        assert(!own.InWatchlist && own.WatchlistId is null, "Another account cannot discover the first user's Watchlist");
        assert(Value(await controller.AddTrailerToWatchlist(request)).InWatchlist && creates == 2
            && lists.Select(list => list.OwnerUserId).Distinct().Count() == 2, "Each account gets its own native private Watchlist");
        user.Id = firstUser; ResetPlayback();

        var original = lists.Single(list => list.OwnerUserId == user.Id);
        original.OpenAccess = true;
        assert(!Value(await Get()).InWatchlist, "A public playlist named Watchlist is never reused");
        original.OpenAccess = false; original.Shares = [new PlaylistUserPermissions(Guid.NewGuid(), false)];
        assert(!Value(await Get()).InWatchlist, "A shared playlist named Watchlist is never reused");
        original.Shares = []; original.ProviderIds["SmartLists"] = "managed";
        assert(!Value(await Get()).InWatchlist, "A generated SmartLists playlist is never reused");
        original.ProviderIds.Clear();
        original.SetMediaType(Jellyfin.Data.Enums.MediaType.Audio);
        assert(!Value(await Get()).InWatchlist, "An audio playlist named Watchlist cannot silently become a movie list");
        original.SetMediaType(Jellyfin.Data.Enums.MediaType.Video);
        lists.Add(new Playlist { Id = Guid.NewGuid(), Name = "Watchlist", OwnerUserId = user.Id, LinkedChildren = [] });
        assert(Value(await Get()).Movie?.Id == advertised.Id && await controller.AddTrailerToWatchlist(request) is UnprocessableEntityObjectResult,
            "Ambiguous private Watchlists preserve Skip trailer without permitting a guessed write");
        lists.RemoveAt(lists.Count - 1);

        advertised.Allowed = false;
        assert(Value(await Get()).Movie is null && await controller.AddTrailerToWatchlist(request) is NotFoundObjectResult,
            "Restricted advertised films expose no metadata and cannot enter the Watchlist");
        advertised.Allowed = true; trailer.OwnerId = Guid.Empty;
        assert(Value(await Get()).Movie is null && await controller.AddTrailerToWatchlist(request) is NotFoundObjectResult,
            "Ownerless trailers never add the upcoming feature as a fallback");
        trailer.OwnerId = advertised.Id;
        advertised.IsVirtualItem = true;
        assert(Value(await Get()).Movie is null, "Virtual advertised movies cannot be saved as playable library films");
        advertised.IsVirtualItem = false; advertised.IsPlaceHolder = true;
        assert(Value(await Get()).Movie is null, "Placeholder advertised movies cannot be saved as playable library films");
        advertised.IsPlaceHolder = false;
        feature.Allowed = false;
        assert(await Get() is JsonResult { Value: null }, "A restricted or stale queued feature does not verify a pre-film trailer");
        feature.Allowed = true;
        session.NowPlayingQueue = [new QueueItem { Id = trailer.Id, PlaylistItemId = "trailer-entry" }];
        CaptureQueue();
        assert(await Get() is JsonResult { Value: null }, "A directly opened trailer has no pre-film actions");
        ResetPlayback();
        session.NowPlayingQueue = [new QueueItem { Id = trailer.Id, PlaylistItemId = "trailer-entry" },
            new QueueItem { Id = Guid.NewGuid() }, new QueueItem { Id = feature.Id }];
        CaptureQueue();
        assert(await Get() is JsonResult { Value: null }, "An unknown queue entry prevents guessing at a later feature");
        ResetPlayback();
        session.NowPlayingQueue = session.NowPlayingQueue.Concat([new QueueItem { Id = trailer.Id, PlaylistItemId = "trailer-entry" }]).ToArray();
        CaptureQueue();
        assert(await Get() is JsonResult { Value: null }, "Repeated indistinguishable trailer queue entries fail closed");
        ResetPlayback(); session.NowPlayingItem = new BaseItemDto { Id = feature.Id };
        assert(await controller.AddTrailerToWatchlist(request) is ConflictObjectResult, "A click after the trailer ends cannot save another film");
        ResetPlayback(); session.PlaylistItemId = "next-trailer-entry";
        assert(await controller.AddTrailerToWatchlist(request) is ConflictObjectResult, "The same trailer ID in a changed queue position is rejected");
        ResetPlayback();

        auth.IsApiKey = true;
        assert(await Get() is UnauthorizedResult && await controller.AddTrailerToWatchlist(request) is UnauthorizedResult,
            "API keys cannot read or modify a user's Watchlist through trailer actions");
        auth.IsApiKey = false; session.UserId = Guid.NewGuid();
        assert(await Get() is UnauthorizedResult, "Another account's playback session is rejected");
        session.UserId = user.Id; session.DeviceId = "other-device";
        assert(await Get() is UnauthorizedResult, "Another device's playback session is rejected");
        session.DeviceId = auth.DeviceId; allowedDevice = false;
        assert(await controller.AddTrailerToWatchlist(request) is UnauthorizedResult, "Revoked device access prevents Watchlist writes");
        allowedDevice = true; user.SetPermission(PermissionKind.IsDisabled, true);
        assert(await Get() is UnauthorizedResult, "Disabled accounts cannot inspect trailer actions");
        user.SetPermission(PermissionKind.IsDisabled, false); local = false; user.SetPermission(PermissionKind.EnableRemoteAccess, false);
        assert(await controller.AddTrailerToWatchlist(request) is UnauthorizedResult, "Remote-disabled accounts cannot save Watchlists remotely");
        local = true;
        assert(await controller.GetTrailerActions(Guid.Empty) is BadRequestObjectResult
            && await controller.AddTrailerToWatchlist(new(trailer.Id, new string('a', 257))) is BadRequestObjectResult,
            "Malformed trailer identity is refused before playlist changes");
        assert(creates == 2 && adds == 1, "Rejected and repeated requests leave saved Watchlists unchanged");
        await TrailerActionsHttpChecks.Run(assert, services =>
        {
            services.AddSingleton(authorization); services.AddSingleton(sessions); services.AddSingleton(users);
            services.AddSingleton(playbackQueues);
            services.AddSingleton(devices); services.AddSingleton(network); services.AddSingleton(library); services.AddSingleton(playlists);
        }, trailer.Id, advertised.Id, feature.Id, hasOwner => trailer.OwnerId = hasOwner ? advertised.Id : Guid.Empty,
            playing => { ResetPlayback(); if (!playing) session.NowPlayingItem = new BaseItemDto { Id = feature.Id }; },
            apiKey => auth.IsApiKey = apiKey);
    }

    private sealed class TrailerCheckMovie : Movie
    {
        public bool Allowed { get; set; } = true;
        public override bool IsVisibleStandalone(User user) => Allowed;
    }
}
