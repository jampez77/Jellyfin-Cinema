using Jellyfin.Plugin.TvItemLayout.Watchlists;
using MediaBrowser.Controller.Playlists;
using System.Net;
using System.Reflection;
using System.Reflection.Emit;
using System.Text;
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
using MediaBrowser.Common.Net;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class ProviderChecks
{
    private static TmdbProviderSource directorySource = null!;
    public static async Task Run(Action<bool, string> assert)
    {
        using var json = JsonDocument.Parse("""{"results":{"US":{"flatrate":[{"provider_id":350}]},"GB":{"flatrate":[{"provider_id":8},{"provider_id":337}],"buy":[{"provider_id":9}],"rent":[{"provider_id":350}],"ads":[{"provider_id":531}],"free":[{"provider_id":38}]}}}""");
        var subscriptions = TmdbProviderSource.Parse(json.RootElement);
        assert(subscriptions.Flatrate.SequenceEqual(new[] { 8, 337 }) && subscriptions.Ads.SequenceEqual(new[] { 531 }) && subscriptions.Free.SequenceEqual(new[] { 38 }), "Provider cache separates GB subscription and ad tiers, excluding foreign, rental and purchase offers");
        assert(subscriptions.Includes([531], ["ads"]) && !subscriptions.Includes([531], ["flatrate"])
            && subscriptions.Includes([38], ["free"]) && !subscriptions.Includes([9, 350], ["flatrate", "free", "ads"]),
            "Selected offer categories include free/ad-supported services without turning a store or ad-only tier into a subscription");
        assert(TmdbProviderSource.Includes("now", "Movie", [591]) && !TmdbProviderSource.Includes("now", "Series", [591])
            && TmdbProviderSource.Includes("now", "Series", [39]) && !TmdbProviderSource.Includes("now", "Movie", [39]),
            "NOW respects separate movie and TV availability IDs");
        assert(TmdbProviderSource.Includes("netflix", "Movie", [1796]) && TmdbProviderSource.Includes("prime", "Movie", [2100])
            && TmdbProviderSource.Includes("paramount", "Series", [2304])
            && !TmdbProviderSource.Includes("paramount", "Movie", [582]) && !TmdbProviderSource.Includes("apple", "Movie", [2]),
            "Provider subscription variants match without treating add-on channels or storefronts as the main subscription");
        assert(TmdbProviderSource.Parse(JsonDocument.Parse("{\"results\":{}}").RootElement).Flatrate.Length == 0,
            "An authoritative absent GB offer is a successful empty membership");
        foreach (var invalid in new[] { "{}", "{\"results\":null}", "{\"results\":{\"GB\":{\"flatrate\":null}}}", "{\"results\":{\"GB\":{\"free\":null}}}", "{\"results\":{\"GB\":{\"ads\":[{\"provider_id\":0}]}}}" })
        {
            var threw = false;
            try { TmdbProviderSource.Parse(JsonDocument.Parse(invalid).RootElement); }
            catch (ProviderLookupException) { threw = true; }
            assert(threw, "Malformed upstream availability cannot become an authoritative empty catalogue");
        }
        await SourceChecks(assert);
        await CacheChecks(assert);
        await LegacyCacheChecks(assert);
        await ControllerChecks(assert);
        await ProviderStudioAffiliationChecks.Run(assert);
    }

    private static async Task SourceChecks(Action<bool, string> assert)
    {
        // Emulate the installed native plugin without reading or creating any real credential.
        var assembly = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("CinemaTmdbFixture"), AssemblyBuilderAccess.Run);
        var module = assembly.DefineDynamicModule("Fixture");
        var plugin = module.DefineType("MediaBrowser.Providers.Plugins.Tmdb.Plugin", TypeAttributes.Public);
        var instance = plugin.DefineField("FixtureInstance", typeof(ProviderTmdbPluginFixture), FieldAttributes.Public | FieldAttributes.Static);
        var getter = plugin.DefineMethod("get_Instance", MethodAttributes.Public | MethodAttributes.Static | MethodAttributes.SpecialName, typeof(ProviderTmdbPluginFixture), Type.EmptyTypes);
        var il = getter.GetILGenerator(); il.Emit(OpCodes.Ldsfld, instance); il.Emit(OpCodes.Ret);
        var property = plugin.DefineProperty("Instance", PropertyAttributes.None, typeof(ProviderTmdbPluginFixture), null); property.SetGetMethod(getter);
        var pluginType = plugin.CreateType()!;
        var fixture = new ProviderTmdbPluginFixture();
        pluginType.GetField("FixtureInstance")!.SetValue(null, fixture);
        var utils = module.DefineType("MediaBrowser.Providers.Plugins.Tmdb.TmdbUtils", TypeAttributes.Public);
        var fallback = utils.DefineField("ApiKey", typeof(string), FieldAttributes.Public | FieldAttributes.Static);
        var utilsType = utils.CreateType()!; utilsType.GetField("ApiKey")!.SetValue(null, "fixture-fallback");
        fixture.Configuration.TmdbApiKey = " fixture-configured ";
        assert(TmdbProviderSource.NativeApiKey() == "fixture-configured", "Provider lookup reuses the installed native TMDB plugin's configured credential");
        fixture.Configuration.TmdbApiKey = "";
        assert(TmdbProviderSource.NativeApiKey() == "fixture-fallback", "Provider lookup can use the installed TMDB integration's native fallback without copying a key");
        fixture.Configuration.TmdbApiKey = "fixture-configured";
        directorySource = await ProviderDirectoryChecks.Run(assert);
        var handler = new ProviderHttpFixture();
        using var client = new HttpClient(handler);
        var factory = InterfaceStub.Create<IHttpClientFactory>((_, _) => client);
        var source = new TmdbProviderSource(factory);
        var subscriptions = await source.FetchAsync("movie:123", default);
        assert(subscriptions.Flatrate.SequenceEqual(new[] { 8 }) && handler.Path == "/3/movie/123/watch/providers" && handler.Authenticated,
            "Actual TMDB request uses the type-specific availability endpoint and native server credential");
        handler.Status = HttpStatusCode.NotFound;
        assert((await source.FetchAsync("tv:456", default)).Flatrate.Length == 0, "Removed TMDB IDs are successful negative availability results");
        handler.Status = HttpStatusCode.ServiceUnavailable;
        var failed = false;
        try { await source.FetchAsync("movie:123", default); }
        catch (ProviderLookupException error) { failed = !error.Message.Contains("fixture-configured", StringComparison.Ordinal); }
        assert(failed, "Upstream errors are failures with credential-free error messages, never empty successes");
        using var limitedHandler = new ProviderRateLimitFixture();
        using var limitedClient = new HttpClient(limitedHandler);
        var limited = new TmdbProviderSource(InterfaceStub.Create<IHttpClientFactory>((_, _) => limitedClient));
        var firstLimit = limited.FetchAsync("movie:1", default);
        var secondLimit = limited.FetchAsync("movie:2", default);
        await limitedHandler.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        limitedHandler.First.SetResult(ProviderRateLimitFixture.Response(120));
        try { await firstLimit; } catch (ProviderLookupException) { }
        var deadlineField = typeof(TmdbProviderSource).GetField("rateLimitedUntil", BindingFlags.NonPublic | BindingFlags.Instance)!;
        var longerDeadline = (long)deadlineField.GetValue(limited)!;
        limitedHandler.Second.SetResult(ProviderRateLimitFixture.Response(30));
        try { await secondLimit; } catch (ProviderLookupException) { }
        assert((long)deadlineField.GetValue(limited)! >= longerDeadline,
            "Concurrent TMDB rate-limit responses cannot shorten another worker's longer Retry-After deadline");
        fixture.Configuration.TmdbApiKey = "";
        utilsType.GetField("ApiKey")!.SetValue(null, null);
        assert(!source.Available, "An absent native TMDB integration is detected without inventing a credential");
    }

    private static async Task WaitUntil(Func<Task<bool>> ready)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!await ready()) await Task.Delay(20, timeout.Token);
    }

    private static async Task CacheChecks(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "cinema-providers-" + Guid.NewGuid().ToString("N"));
        var path = Path.Combine(directory, "availability.json");
        var current = DateTimeOffset.Parse("2026-09-01T00:00:00Z");
        var calls = 0;
        var active = 0;
        var maximumActive = 0;
        var fail = false;
        var canFetch = true;
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cache = new ProviderAvailabilityCache(path, async (key, token) =>
        {
            Interlocked.Increment(ref calls);
            var count = Interlocked.Increment(ref active);
            maximumActive = Math.Max(maximumActive, count);
            try
            {
                await release.Task.WaitAsync(token);
                if (fail) throw new ProviderLookupException("Fixture failure", TimeSpan.FromMinutes(3));
                return key == "movie:2" ? ProviderMembership.Empty : new ProviderMembership([8], [38], [41]);
            }
            finally { Interlocked.Decrement(ref active); }
        }, () => canFetch, () => current);
        using var stop = new CancellationTokenSource();
        var running = cache.RunAsync(stop.Token);
        try
        {
            var first = await cache.ReadAsync(["movie:1", "movie:2", "movie:1", "tv:1", "../invalid"], default);
            assert(first is { Pending: 3, Total: 3, Status: "refreshing", FailedIds: 0 } && first.Memberships.Count == 0,
                "Initial availability is explicitly partial and de-duplicates requests by TMDB type/ID");
            await WaitUntil(() => Task.FromResult(Volatile.Read(ref calls) == 3));
            await cache.ReadAsync(["movie:1", "movie:2", "tv:1"], default);
            assert(calls == 3 && maximumActive <= 3, "Concurrent requests share at most three in-flight availability lookups");
            release.SetResult();
            await WaitUntil(async () => (await cache.ReadAsync(["movie:1", "movie:2", "tv:1"], default)).Status == "ready");
            var complete = await cache.ReadAsync(["movie:1", "movie:2", "tv:1"], default);
            assert(complete is { Pending: 0, Total: 3 } && complete.Memberships["movie:1"].Flatrate.SequenceEqual(new[] { 8 })
                && complete.Memberships["movie:2"].Flatrate.Length == 0 && complete.Memberships.ContainsKey("tv:1"),
                "Successful negatives are cached separately from missing data, and movie/TV IDs never collide");
            await cache.FlushAsync(default);
            var restored = new ProviderAvailabilityCache(path, (_, _) => throw new Exception("Fresh persisted cache must not refetch"), () => true, () => current);
            var persisted = await restored.ReadAsync(["movie:1", "movie:2", "tv:1"], default);
            assert(persisted.Status == "ready" && persisted.Memberships.Count == 3
                && persisted.Memberships["movie:1"].Free.SequenceEqual(new[] { 38 }) && persisted.Memberships["movie:1"].Ads.SequenceEqual(new[] { 41 }), "Successful availability survives a server restart without another lookup");
            var legacyPath = Path.Combine(directory, "old-format.json");
            await File.WriteAllTextAsync(legacyPath, JsonSerializer.Serialize(new Dictionary<string, object> { ["movie:1"] = new { Providers = new[] { 8 }, UpdatedAt = current, RetryAt = DateTimeOffset.MinValue, Failures = 0 } }));
            var oldCache = new ProviderAvailabilityCache(legacyPath, (_, _) => Task.FromResult(ProviderMembership.Empty), () => true, () => current);
            var ignored = await oldCache.ReadAsync(["movie:1"], default);
            assert(ignored is { Pending: 1, Status: "refreshing" } && ignored.Memberships.Count == 0,
                "Legacy subscription-only cache data cannot masquerade as complete free/ad-supported availability");
            current += TimeSpan.FromDays(8); fail = true;
            var stale = await cache.ReadAsync(["movie:1"], default);
            assert(stale.Status == "refreshing" && stale.Memberships["movie:1"].Flatrate.Contains(8), "Expired availability remains usable while refreshing");
            await WaitUntil(async () => (await cache.ReadAsync(["movie:1"], default)).Status == "unavailable");
            var failed = await cache.ReadAsync(["movie:1", "movie:3"], default);
            assert(failed.Memberships["movie:1"].Flatrate.Contains(8), "A failed refresh preserves the last successful provider membership");
            await WaitUntil(async () => (await cache.ReadAsync(["movie:3"], default)).Status == "unavailable");
            var failedNew = await cache.ReadAsync(["movie:3"], default);
            var afterFailure = calls;
            current += TimeSpan.FromMinutes(1);
            await cache.ReadAsync(["movie:3"], default);
            assert(failedNew is { Pending: 0, FailedIds: 1, Status: "unavailable" } && calls == afterFailure,
                "Failed unresolved IDs are not reported as empty catalogues and respect upstream Retry-After");
            canFetch = false;
            var unavailable = await cache.ReadAsync(["movie:4"], default);
            assert(unavailable is { Pending: 0, FailedIds: 1, Status: "unavailable" } && calls == afterFailure,
                "Missing TMDB integration reports unavailable without queuing pointless background work");
            assert(!Directory.GetFiles(directory, "*.tmp").Any(), "Provider cache writes publish complete files atomically");
        }
        finally { stop.Cancel(); await running; if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private static async Task LegacyCacheChecks(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "cinema-cache-migration-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var oldPath = Path.Combine(directory, "GB-v1.json"); var path = Path.Combine(directory, "GB-v2.json");
        var now = DateTimeOffset.UtcNow;
        var oldData = JsonSerializer.Serialize(new Dictionary<string, object> { ["movie:1"] = new { Providers = new[] { 8 }, UpdatedAt = now, RetryAt = DateTimeOffset.MinValue, Failures = 0 } });
        await File.WriteAllTextAsync(oldPath, oldData);
        var release = new TaskCompletionSource<ProviderMembership>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cache = new ProviderAvailabilityCache(path, (_, token) => release.Task.WaitAsync(token), () => true, () => now, oldPath);
        using var stop = new CancellationTokenSource(); var running = cache.RunAsync(stop.Token);
        try
        {
            var imported = await cache.ReadAsync(["movie:1"], default);
            assert(imported.Status == "refreshing" && imported.Memberships["movie:1"].Flatrate.SequenceEqual(new[] { 8 }),
                "Upgrade preserves freshly cached subscription memberships while queuing unknown offer categories");
            await cache.FlushAsync(default);
            var offline = new ProviderAvailabilityCache(path, (_, _) => throw new Exception("No fetch without native integration"), () => false, () => now, oldPath);
            var incomplete = await offline.ReadAsync(["movie:1"], default);
            assert(incomplete.Status == "unavailable" && incomplete.Memberships["movie:1"].Flatrate.SequenceEqual(new[] { 8 })
                && incomplete.Memberships["movie:1"].Free.Length == 0,
                "Persisted incomplete migration cannot report unknown broadcaster availability ready after a restart");
            release.SetResult(new([8], [38], [41]));
            await WaitUntil(async () => (await cache.ReadAsync(["movie:1"], default)).Status == "ready");
            var complete = await cache.ReadAsync(["movie:1"], default);
            assert(complete.Memberships["movie:1"].Free.SequenceEqual(new[] { 38 }) && complete.Memberships["movie:1"].Ads.SequenceEqual(new[] { 41 })
                && await File.ReadAllTextAsync(oldPath) == oldData,
                "Successful refresh completes migrated offer categories without modifying the old cache");
        }
        finally { stop.Cancel(); await running; Directory.Delete(directory, true); }
    }

    private static async Task ControllerChecks(Action<bool, string> assert)
    {
        var user = new User("provider-check", "default", "reset") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.IsDisabled, false);
        user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        user.SetPreference(PreferenceKind.BlockedTags, ["restricted"]);
        user.SetPreference(PreferenceKind.AllowedTags, ["family"]);
        var auth = new AuthorizationInfo { Token = "provider-token", DeviceId = "provider-device", User = user };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        SessionInfo? session = null;
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) => Task.FromResult(session!));
        session = new SessionInfo(sessions, NullLogger.Instance) { UserId = user.Id, DeviceId = auth.DeviceId };
        var knownUsers = new Dictionary<Guid, User> { [user.Id] = user };
        var users = InterfaceStub.Create<IUserManager>((_, args) => knownUsers[(Guid)args![0]!]);
        var allowedDevice = true;
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => allowedDevice);
        var local = true;
        var network = InterfaceStub.Create<INetworkManager>((_, _) => local);
        Movie Movie(string name, string? tmdb, int day)
        {
            var item = new Movie { Id = Guid.NewGuid(), Name = name, SortName = name, DateCreated = new DateTime(2026, 1, day) };
            if (tmdb is not null) item.ProviderIds["Tmdb"] = tmdb;
            return item;
        }
        var alpha = Movie("Alpha", "1", 1);
        var beta = Movie("Beta", "2", 3);
        var gamma = Movie("Gamma", "3", 2);
        alpha.ProductionYear = 2001; gamma.ProductionYear = 1999;
        var missing = Movie("Missing", null, 4);
        var visible = new List<BaseItem> { gamma, beta, alpha, missing };
        InternalItemsQuery? seen = null;
        var libraryCalls = 0;
        var library = InterfaceStub.Create<ILibraryManager>((method, args) =>
        {
            if (method.Name != "GetItemList" || args!.Length != 1) throw new Exception("Provider catalogue must use a native user-scoped list query");
            seen = (InternalItemsQuery)args[0]!; libraryCalls++;
            return visible;
        });
        var dtoUsers = new List<Guid>();
        var dtos = InterfaceStub.Create<IDtoService>((method, args) =>
        {
            if (method.Name != "GetBaseItemDto") throw new Exception("Unexpected provider DTO operation");
            dtoUsers.Add(((User)args![2]!).Id);
            var item = (BaseItem)args[0]!;
            return new BaseItemDto { Id = item.Id, Name = item.Name };
        });
        string[]? lookedUp = null;
        var availability = InterfaceStub.Create<IProviderAvailability>((_, args) =>
        {
            lookedUp = ((IEnumerable<string>)args![0]!).ToArray();
            return Task.FromResult(new ProviderCacheSnapshot(new Dictionary<string, ProviderMembership> { ["movie:1"] = new([8], [38], []), ["movie:2"] = new([337], [8], [41]), ["movie:3"] = new([8], [], [103]) }, 0, 0, 3, DateTimeOffset.UtcNow, "ready"));
        });
        var directory = Path.Combine(Path.GetTempPath(), "cinema-catalogue-check-" + Guid.NewGuid().ToString("N"));
        var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath" ? directory : throw new Exception("Unexpected path"));
        var watchlists = new WatchlistService(InterfaceStub.Create<IPlaylistManager>((method, _) =>
            method.Name == "GetPlaylists" ? Array.Empty<Playlist>() : throw new Exception("Unexpected provider Watchlist mutation")), paths, library);
        var controller = new ProviderItemsController(authorization, sessions, users, devices, network, library, dtos, availability, paths, directorySource, watchlists)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        controller.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
        var providerDirectory = (ProviderDirectory)((OkObjectResult)await controller.GetProviderDirectory()).Value!;
        assert(providerDirectory.Region == "GB" && providerDirectory.Movies.Single().Name == "Film service"
            && providerDirectory.Shows.Single().Name == "TV service" && libraryCalls == 0,
            "Named provider directory is authenticated and keeps film/TV services separate without reading personal media");
        ProviderItemsResponse Value(IActionResult result) => (ProviderItemsResponse)((OkObjectResult)result).Value!;
        assert(typeof(ProviderItemsController).GetCustomAttribute<AuthorizeAttribute>() is not null
            && typeof(ProviderItemsController).GetCustomAttribute<ResponseCacheAttribute>()?.NoStore == true,
            "Provider library responses require authorization and cannot enter a shared HTTP cache");
        var response = Value(await controller.GetProviderItems("netflix", limit: 1));
        assert(seen is not null && ReferenceEquals(seen.User, user) && seen.Recursive && seen.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Movie })
            && seen.ItemIds.Length == 0 && seen.ParentId == Guid.Empty && seen.AncestorIds.Length == 0 && seen.TopParentIds.Length == 0
            && seen.ExcludeInheritedTags.Contains("restricted") && seen.IncludeInheritedTags.Contains("family"),
            "Native library query carries the exact user and content restrictions without bypassing permitted-root filtering");
        assert(response.TotalRecordCount == 2 && response.Items.Length == 1 && response.Items[0].Id == alpha.Id
            && response.MissingIds == 1 && response.Region == "GB" && lookedUp!.Length == 3 && dtoUsers.All(id => id == user.Id),
            "Provider filtering, paging, missing metadata and DTOs use only the current user's permitted library result");
        assert(Value(await controller.GetProviderItems("netflix", startIndex: 1, limit: 1)).Items.Single().Id == gamma.Id
            && Value(await controller.GetProviderItems("netflix", sort: "title-desc")).Items.First().Id == gamma.Id
            && Value(await controller.GetProviderItems("netflix", sort: "newest")).Items.First().Id == alpha.Id,
            "Provider catalogue supports stable pagination and requested title/release ordering");
        var unknownYear = Movie("Unknown year", "1", 5);
        visible = [gamma, alpha, unknownYear];
        assert(Value(await controller.GetProviderItems("netflix", sort: "newest")).Items.Select(item => item.Id).SequenceEqual(new[] { alpha.Id, gamma.Id, unknownYear.Id })
            && Value(await controller.GetProviderItems("netflix", sort: "oldest")).Items.Select(item => item.Id).SequenceEqual(new[] { gamma.Id, alpha.Id, unknownYear.Id }),
            "Release sorts use production year, not date added, and put unknown release years last in both directions");
        visible = [alpha];
        assert(Value(await controller.GetProviderItems("netflix")).Items.Single().Id == alpha.Id && lookedUp!.SequenceEqual(new[] { "movie:1" }),
            "Changed library permissions are applied again before every lookup and response");
        assert(await controller.GetProviderItems("unknown") is BadRequestObjectResult
            && await controller.GetProviderItems("netflix", type: "Episode") is BadRequestObjectResult
            && await controller.GetProviderItems("netflix", startIndex: -1) is BadRequestObjectResult
            && await controller.GetProviderItems("netflix", limit: 201) is BadRequestObjectResult,
            "Malformed or unbounded provider requests fail before accessing the library");
        visible = [alpha, beta, gamma];
        assert(Value(await controller.GetProviderItems("bbc")).Items.Single().Id == alpha.Id
            && Value(await controller.GetProviderItems("itvx")).Items.Single().Id == beta.Id
            && Value(await controller.GetProviderItems("channel4")).Items.Single().Id == gamma.Id,
            "Unsaved accounts immediately expose BBC iPlayer, ITVX and Channel 4 through their verified GB free/ad-supported IDs");
        JsonElement Draft(string id, int[] movieIds, int[] showIds, string[] offers, bool enabled = true) => JsonSerializer.SerializeToElement(new {
            id, name = "Fixture service", logoUrl = "", accent = "#112233", movieProviderIds = movieIds, showProviderIds = showIds, offerTypes = offers, enabled, hero = true, rows = Array.Empty<object>() });
        JsonElement Settings(params JsonElement[] providers) => JsonSerializer.SerializeToElement(new { version = 2, enabled = false, title = "Hidden shortcuts", placement = "end", tileScale = 70, showNames = false, providers });
        var settingsController = new ProviderHomesController(authorization, sessions, users, devices, network, paths) { ControllerContext = controller.ControllerContext };
        var configuredA = Settings(Draft("custom-family", [8], [337], ["flatrate"]), Draft("netflix", [337], [337], ["flatrate"]),
            Draft("custom-collection", [], [], ["flatrate"]), Draft("custom-disabled", [8], [8], ["flatrate"], false));
        var accountA = (ProviderHomesResponse)((OkObjectResult)await settingsController.PutProviderHomes(new(null, configuredA))).Value!;
        assert(Value(await controller.GetProviderItems("custom-family")).Items.Select(item => item.Id).SequenceEqual(new[] { alpha.Id, gamma.Id })
            && Value(await controller.GetProviderItems("netflix")).Items.Single().Id == beta.Id,
            "Saved custom mappings and edited built-ins control catalogue membership even when the Home shortcut row is hidden");
        var noLookup = libraryCalls;
        assert(Value(await controller.GetProviderItems("custom-collection")) is { Status: "unavailable", Total: 0, TotalRecordCount: 0 }
            && await controller.GetProviderItems("custom-disabled") is NotFoundObjectResult
            && await controller.GetProviderItems("custom-other") is NotFoundObjectResult && await controller.GetProviderItems("bbc") is NotFoundObjectResult
            && libraryCalls == noLookup,
            "Empty, disabled and omitted configurations do not fall back to another service or inspect the library");
        var draft = Draft("custom-unsaved", [41], [38], ["ads"], false);
        var preview = Value(await controller.PreviewProviderItems(draft));
        assert(preview.Items.Single().Id == beta.Id && ReferenceEquals(seen!.User, user)
            && ((ProviderHomesResponse)((OkObjectResult)await settingsController.GetProviderHomes()).Value!).Revision == accountA.Revision
            && await controller.GetProviderItems("custom-unsaved") is NotFoundObjectResult,
            "Draft preview uses its unsaved ID/offer mapping with current-user permissions without publishing settings");
        assert(await controller.PreviewProviderItems(JsonDocument.Parse("{\"id\":\"custom-bad\",\"url\":\"http://localhost\"}").RootElement) is BadRequestObjectResult
            && await controller.PreviewProviderItems(draft, mediaType: "Episode") is BadRequestObjectResult,
            "Draft preview validates the complete service schema and rejects unsupported media before lookup");
        var accountB = new User("second-provider-check", "default", "reset") { Id = Guid.NewGuid() };
        accountB.SetPermission(PermissionKind.IsDisabled, false); accountB.SetPermission(PermissionKind.EnableRemoteAccess, true);
        knownUsers.Add(accountB.Id, accountB); auth.User = accountB; session.UserId = accountB.Id;
        assert(await controller.GetProviderItems("custom-family") is NotFoundObjectResult, "A second account cannot resolve another account's private custom service definition");
        await settingsController.PutProviderHomes(new(null, Settings(Draft("custom-family", [337], [], ["flatrate"]))));
        visible = [beta];
        assert(Value(await controller.GetProviderItems("custom-family")).Items.Single().Id == beta.Id && ReferenceEquals(seen!.User, accountB)
            && dtoUsers.Last() == accountB.Id && lookedUp!.SequenceEqual(new[] { "movie:2" }),
            "Two accounts can reuse a custom service ID with distinct source mappings and distinct permitted-library queries");
        auth.User = user; session.UserId = user.Id; visible = [alpha, gamma];
        assert(Value(await controller.GetProviderItems("custom-family")).Items.Length == 2 && ReferenceEquals(seen!.User, user),
            "Switching back restores only the original account's configured source mapping");
        visible = [beta];
        await ProviderItemsHttpChecks.Run(assert, services =>
        {
            services.AddSingleton(authorization); services.AddSingleton(sessions); services.AddSingleton(users); services.AddSingleton(devices);
            services.AddSingleton(network); services.AddSingleton(library); services.AddSingleton(dtos); services.AddSingleton(availability); services.AddSingleton(paths);
            services.AddSingleton(directorySource); services.AddSingleton(watchlists);
        }, value => auth.IsApiKey = value, draft, beta.Id);
        visible = [alpha, gamma];
        var beforeUnauthorized = libraryCalls;
        auth.IsApiKey = true;
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult && await controller.PreviewProviderItems(draft) is UnauthorizedResult
            && await controller.GetProviderDirectory() is UnauthorizedResult, "API keys cannot access personal provider catalogues, directories or draft previews");
        auth.IsApiKey = false; session.DeviceId = "different";
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult && await controller.GetProviderDirectory() is UnauthorizedResult, "Provider catalogue and directory reject a mismatched authenticated device");
        session.DeviceId = auth.DeviceId; allowedDevice = false;
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult && await controller.GetProviderDirectory() is UnauthorizedResult, "Provider catalogue and directory obey revoked device access");
        allowedDevice = true; user.SetPermission(PermissionKind.IsDisabled, true);
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult && await controller.GetProviderDirectory() is UnauthorizedResult, "Provider catalogue and directory reject a disabled account");
        user.SetPermission(PermissionKind.IsDisabled, false); local = false; user.SetPermission(PermissionKind.EnableRemoteAccess, false);
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult && await controller.GetProviderDirectory() is UnauthorizedResult && libraryCalls == beforeUnauthorized,
            "Revoked remote access is rejected before any user media or public-ID lookup");
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }
}

public sealed class ProviderTmdbPluginFixture
{
    public ProviderTmdbConfigurationFixture Configuration { get; } = new();
}
public sealed class ProviderTmdbConfigurationFixture
{
    public string TmdbApiKey { get; set; } = "";
}
public sealed class ProviderHttpFixture : HttpMessageHandler
{
    public string? Path { get; private set; }
    public bool Authenticated { get; private set; }
    public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Path = request.RequestUri!.AbsolutePath;
        Authenticated = request.RequestUri.Query == "?api_key=fixture-configured";
        return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent("{\"results\":{\"GB\":{\"flatrate\":[{\"provider_id\":8}]}}}", Encoding.UTF8, "application/json") });
    }
}

public sealed class ProviderRateLimitFixture : HttpMessageHandler
{
    private int requests;
    public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource<HttpResponseMessage> First { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource<HttpResponseMessage> Second { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public static HttpResponseMessage Response(int seconds)
    {
        var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(seconds));
        return response;
    }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var count = Interlocked.Increment(ref requests);
        if (count == 2) Started.TrySetResult();
        return (count == 1 ? First.Task : Second.Task).WaitAsync(cancellationToken);
    }
}
