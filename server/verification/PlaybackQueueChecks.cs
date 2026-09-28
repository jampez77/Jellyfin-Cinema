using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout;
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
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif

public static class PlaybackQueueChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        var clock = new QueueClock();
        var queues = new PlaybackQueueStore(clock);
        var trailerId = Guid.NewGuid(); var featureId = Guid.NewGuid();
        var user = new User("queue-user", "default", "reset") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.IsDisabled, false);
        user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        var fixture = new NativePlaybackReportsFixture();
        var auth = new AuthorizationInfo { Token = "queue-test-token", DeviceId = "queue-device", User = user };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) => method.Name == "GetSessionByAuthenticationToken"
            && (string)args![0]! == auth.Token && (string)args[1]! == auth.DeviceId
            ? Task.FromResult(fixture.Session) : throw new Exception("Unexpected queue session lookup"));
        SessionInfo Session(string id = "queue-session") => new(sessions, NullLogger.Instance)
        {
            Id = id, UserId = user.Id, DeviceId = auth.DeviceId,
            NowPlayingItem = new BaseItemDto { Id = trailerId }, PlaylistItemId = "trailer-0"
        };
        QueueItem[] NativeQueue() => [new() { Id = trailerId, PlaylistItemId = "trailer-0" }, new() { Id = featureId, PlaylistItemId = "feature-1" }];
        PlaybackStartInfo Start(QueueItem[]? queue = null) => new()
        {
            ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1", NowPlayingQueue = queue ?? NativeQueue()
        };
        fixture.Session = Session();
        var report = Start(); queues.Record(fixture.Session, report, true, queues.NextSequence());
        report.NowPlayingQueue[1].Id = Guid.NewGuid();
        var copy = queues.GetQueue(fixture.Session); copy[1].Id = Guid.NewGuid();
        assert(queues.GetQueue(fixture.Session)[1].Id == featureId, "Captured playback queues detach mutable reports and returned arrays");
        var other = Session("other-session");
        assert(queues.GetQueue(other).Count == 0, "Captured queues never cross session IDs");
        other.Id = fixture.Session.Id; other.DeviceId = "other-device";
        assert(queues.GetQueue(other).Count == 0, "Captured queues never cross device IDs");
        other.DeviceId = auth.DeviceId; other.UserId = Guid.NewGuid();
        assert(queues.GetQueue(other).Count == 0, "Captured queues never cross user IDs");
        fixture.Session.PlaylistItemId = "different-occurrence";
        assert(queues.GetQueue(fixture.Session).Count == 0, "A cached queue cannot describe a different current queue occurrence");
        fixture.Session.PlaylistItemId = "trailer-0";
        var older = queues.NextSequence(); var newer = queues.NextSequence();
        queues.Record(fixture.Session, Start(), true, newer);
        queues.Record(fixture.Session, new PlaybackStartInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "old", NowPlayingQueue = [] }, true, older);
        queues.Record(fixture.Session, new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "old", NowPlayingQueue = [] }, false, queues.NextSequence());
        queues.Stop(fixture.Session, new PlaybackStopInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "old" }, queues.NextSequence());
        assert(queues.GetQueue(fixture.Session).Count == 2, "Late starts, progress and stops cannot replace a newer play session's queue");
        queues.Record(fixture.Session, new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1" }, false, queues.NextSequence());
        assert(queues.GetQueue(fixture.Session).Count == 2, "Ordinary progress without a queue retains this exact play session's queue");
        queues.Record(fixture.Session, new PlaybackStartInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-2" }, true, queues.NextSequence());
        assert(queues.GetQueue(fixture.Session).Count == 0, "New playback without a queue discards the previous queue instead of guessing");
        older = queues.NextSequence(); newer = queues.NextSequence();
        queues.Record(fixture.Session, Start(), true, older);
        queues.Record(fixture.Session, new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1", NowPlayingQueue = [] }, false, newer);
        queues.Record(fixture.Session, Start(), true, older);
        assert(queues.GetQueue(fixture.Session).Count == 0, "A delayed Start cannot undo a newer explicit empty queue");
        queues.Record(fixture.Session, Start(), true, queues.NextSequence());
        fixture.Session.NowPlayingQueue = NativeQueue();
        clock.Now += TimeSpan.FromMinutes(29);
        queues.Record(fixture.Session, new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1" }, false, queues.NextSequence());
        clock.Now += TimeSpan.FromMinutes(29);
        assert(queues.GetQueue(fixture.Session).Count == 2, "Native progress renews captured queues through long playback sessions");
        clock.Now += TimeSpan.FromMinutes(2);
        assert(queues.GetQueue(fixture.Session).Count == 0, "Expired captured queues never fall back to Jellyfin 12's stale outgoing queue");
        for (var i = 0; i < 129; i++) { clock.Now += TimeSpan.FromSeconds(1); var candidate = Session("bounded-" + i); queues.Record(candidate, Start(), true, queues.NextSequence()); }
        var evicted = Session("bounded-0"); evicted.NowPlayingQueue = NativeQueue();
        assert(queues.GetQueue(evicted).Count == 0 && queues.GetQueue(Session("bounded-128")).Count == 2,
            "Captured queues are bounded to 128 recent sessions");
        var oversized = Start(Enumerable.Range(0, 1025).Select(_ => new QueueItem { Id = featureId }).ToArray());
        queues.Record(fixture.Session, oversized, true, queues.NextSequence());
        assert(queues.GetQueue(fixture.Session).Count == 0, "Oversized queues cannot grow the retained playback cache");

        // Use the real plugin registration for the filter, store and MVC options,
        // while excluding unrelated provider hosted services from this HTTP host.
        var registered = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(registered, null!);
        var builder = WebApplication.CreateBuilder();
        builder.Logging.SetMinimumLevel(LogLevel.Warning); builder.WebHost.UseUrls("http://127.0.0.1:0");
        foreach (var descriptor in registered.Where(descriptor => descriptor.ServiceType == typeof(PlaybackQueueStore)
            || descriptor.ServiceType == typeof(PlaybackQueueCaptureFilter) || descriptor.ServiceType == typeof(IConfigureOptions<MvcOptions>)))
            builder.Services.Add(descriptor);
        builder.Services.AddSingleton(fixture); builder.Services.AddSingleton(authorization); builder.Services.AddSingleton(sessions);
        var advertised = new TrailerCheckMovie { Id = Guid.NewGuid(), Name = "Advertised movie" };
        var feature = new TrailerCheckMovie { Id = featureId, Name = "Queued movie" };
        var trailer = new Trailer { Id = trailerId, OwnerId = advertised.Id, Name = "First trailer" };
        var items = new Dictionary<Guid, BaseItem> { [trailer.Id] = trailer, [advertised.Id] = advertised, [feature.Id] = feature };
        builder.Services.AddSingleton(InterfaceStub.Create<ILibraryManager>((method, args) => method.Name == "GetItemById"
            ? items.GetValueOrDefault((Guid)args![0]!) : throw new Exception("Unexpected queue library query")));
        builder.Services.AddSingleton(InterfaceStub.Create<IUserManager>((_, _) => user));
        builder.Services.AddSingleton(InterfaceStub.Create<IDeviceManager>((_, _) => true));
        builder.Services.AddSingleton(InterfaceStub.Create<INetworkManager>((_, _) => true));
        builder.Services.AddSingleton(InterfaceStub.Create<IPlaylistManager>((method, _) => method.Name == "GetPlaylists"
            ? Array.Empty<Playlist>() : throw new Exception("Queue discovery must not modify playlists")));
        builder.Services.AddAuthorization();
        builder.Services.AddControllers().AddApplicationPart(typeof(PlaybackContextController).Assembly).AddJsonOptions(options =>
        {
            options.JsonSerializerOptions.PropertyNamingPolicy = JsonDefaults.PascalCaseOptions.PropertyNamingPolicy;
            options.JsonSerializerOptions.DefaultIgnoreCondition = JsonDefaults.PascalCaseOptions.DefaultIgnoreCondition;
            options.JsonSerializerOptions.Converters.Clear();
            foreach (var converter in JsonDefaults.PascalCaseOptions.Converters) options.JsonSerializerOptions.Converters.Add(converter);
        });
        await using var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.Id.ToString())], "fixture"));
            await next();
        });
        app.UseAuthorization(); app.MapControllers(); await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        var captured = app.Services.GetRequiredService<PlaybackQueueStore>();
        async Task Send(string route, object body) { using var response = await client.PostAsJsonAsync(route, body, JsonDefaults.PascalCaseOptions); response.EnsureSuccessStatusCode(); }
        async Task<JsonDocument> Read(string route) => JsonDocument.Parse(await client.GetStringAsync(route));
        var trailerEndpoint = $"/TvItemLayout/TrailerActions?playingItemId={trailerId}&playlistItemId=trailer-0";
        try
        {
            fixture.Session = Session(); fixture.Session.NowPlayingItem = null;
            var first = Start(); first.SessionId = "client-cannot-choose-session";
            await Send("/Sessions/Playing", first);
            using var playback = await Read("/TvItemLayout/PlaybackContext");
            using var actions = await Read(trailerEndpoint);
            assert(fixture.Session.NowPlayingQueue.Count == 0 && playback.RootElement.GetProperty("Queue").GetArrayLength() == 2
                && Guid.Parse(actions.RootElement.GetProperty("Movie").GetProperty("Id").GetString()!) == advertised.Id,
                "First native Start exposes trailer actions before any Stop, despite Jellyfin 12 leaving its session queue empty");
            fixture.Session = Session("delayed-start"); fixture.Session.NowPlayingItem = null;
            fixture.StartEntered = new(); fixture.FinishStart = new();
            var delayedStart = Send("/Sessions/Playing", Start());
            await fixture.StartEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await Send("/Sessions/Playing/Progress", new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1" });
            assert(captured.GetQueue(fixture.Session).Count == 0, "Progress preceding a slow Start response does not invent queue entries");
            fixture.FinishStart.SetResult(); await delayedStart;
            fixture.StartEntered = null; fixture.FinishStart = null;
            using var delayedActions = await Read(trailerEndpoint);
            assert(captured.GetQueue(fixture.Session).Count == 2 && delayedActions.RootElement.ValueKind == JsonValueKind.Object,
                "A slow native Start still supplies its queue after ordinary progress completed first");
            await Send("/Sessions/Playing/Progress", new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1", IsPaused = true });
            using var paused = await Read(trailerEndpoint);
            assert(fixture.Session.PlayState.IsPaused && paused.RootElement.ValueKind == JsonValueKind.Object,
                "Native pause progress without a queue preserves first-trailer actions");
            await Send("/Sessions/Playing/Progress", new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1", NowPlayingQueue = [NativeQueue()[0]] });
            using var standalone = await Read(trailerEndpoint);
            assert(standalone.RootElement.ValueKind == JsonValueKind.Null, "A reported standalone trailer cannot borrow a preceding cinema queue");
            await Send("/Sessions/Playing", Start());
            await Send("/Sessions/Playing/Progress", new PlaybackProgressInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1", NowPlayingQueue = [NativeQueue()[0], NativeQueue()[0], NativeQueue()[1]] });
            using var repeated = await Read(trailerEndpoint);
            assert(repeated.RootElement.ValueKind == JsonValueKind.Null, "Ambiguous reported trailer queue occurrences still cannot enable actions");
            await Send("/Sessions/Playing", Start());
            var owner = fixture.Session.UserId; fixture.Session.UserId = Guid.NewGuid();
            using var wrongUser = await client.GetAsync(trailerEndpoint);
            assert(wrongUser.StatusCode == HttpStatusCode.Unauthorized, "Captured queues do not bypass the current account guard");
            fixture.Session.UserId = owner;
            fixture.Session.NowPlayingQueue = NativeQueue();
            await Send("/Sessions/Playing/Stopped", new PlaybackStopInfo { ItemId = trailerId, PlaylistItemId = "trailer-0", PlaySessionId = "play-1" });
            fixture.Session.NowPlayingItem = new BaseItemDto { Id = trailerId };
            assert(captured.GetQueue(fixture.Session).Count == 0, "Native Stop clears retained data without resurrecting its stale native queue");
            fixture.Reject = true;
            using var rejected = await client.PostAsJsonAsync("/Sessions/Playing", Start(), JsonDefaults.PascalCaseOptions);
            assert(rejected.StatusCode == HttpStatusCode.BadRequest && captured.GetQueue(fixture.Session).Count == 0,
                "Failed native playback reports cannot seed a captured queue");
            fixture.Reject = false; auth.IsApiKey = true;
            await Send("/Sessions/Playing", Start());
            assert(captured.GetQueue(fixture.Session).Count == 0, "API-key reports cannot seed a user's playback queue");
            auth.IsApiKey = false; fixture.Session.UserId = Guid.NewGuid();
            await Send("/Sessions/Playing", Start());
            assert(captured.GetQueue(fixture.Session).Count == 0, "Reports for a different authenticated user cannot seed a queue");
            fixture.Session.UserId = owner; fixture.Session.DeviceId = "other-device";
            await Send("/Sessions/Playing", Start());
            assert(captured.GetQueue(fixture.Session).Count == 0, "Reports for a different authenticated device cannot seed a queue");
        }
        finally { await app.StopAsync(); }
    }

    private sealed class QueueClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class TrailerCheckMovie : Movie
    {
        public override bool IsVisibleStandalone(User user) => true;
    }
}
