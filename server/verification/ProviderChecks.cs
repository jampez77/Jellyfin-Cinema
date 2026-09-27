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
    public static async Task Run(Action<bool, string> assert)
    {
        using var json = JsonDocument.Parse("""{"results":{"US":{"flatrate":[{"provider_id":350}]},"GB":{"flatrate":[{"provider_id":8},{"provider_id":337}],"buy":[{"provider_id":9}],"rent":[{"provider_id":350}],"ads":[{"provider_id":531}]}}}""");
        var subscriptions = TmdbProviderSource.Parse(json.RootElement);
        assert(subscriptions.SequenceEqual(new[] { 8, 337 }), "Provider catalogue accepts only GB subscriptions, excluding foreign, rental, purchase and ad tiers");
        assert(TmdbProviderSource.Includes("now", "Movie", [591]) && !TmdbProviderSource.Includes("now", "Series", [591])
            && TmdbProviderSource.Includes("now", "Series", [39]) && !TmdbProviderSource.Includes("now", "Movie", [39]),
            "NOW respects separate movie and TV availability IDs");
        assert(TmdbProviderSource.Includes("netflix", "Movie", [1796]) && TmdbProviderSource.Includes("prime", "Movie", [2100])
            && TmdbProviderSource.Includes("paramount", "Series", [2304])
            && !TmdbProviderSource.Includes("paramount", "Movie", [582]) && !TmdbProviderSource.Includes("apple", "Movie", [2]),
            "Provider subscription variants match without treating add-on channels or storefronts as the main subscription");
        assert(TmdbProviderSource.Parse(JsonDocument.Parse("{\"results\":{}}").RootElement).Length == 0,
            "An authoritative absent GB offer is a successful empty membership");
        foreach (var invalid in new[] { "{}", "{\"results\":null}", "{\"results\":{\"GB\":{\"flatrate\":null}}}" })
        {
            var threw = false;
            try { TmdbProviderSource.Parse(JsonDocument.Parse(invalid).RootElement); }
            catch (ProviderLookupException) { threw = true; }
            assert(threw, "Malformed upstream availability cannot become an authoritative empty catalogue");
        }
        await SourceChecks(assert);
        await CacheChecks(assert);
        await ControllerChecks(assert);
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
        var handler = new ProviderHttpFixture();
        using var client = new HttpClient(handler);
        var factory = InterfaceStub.Create<IHttpClientFactory>((_, _) => client);
        var source = new TmdbProviderSource(factory);
        var subscriptions = await source.FetchAsync("movie:123", default);
        assert(subscriptions.SequenceEqual(new[] { 8 }) && handler.Path == "/3/movie/123/watch/providers" && handler.Authenticated,
            "Actual TMDB request uses the type-specific availability endpoint and native server credential");
        handler.Status = HttpStatusCode.NotFound;
        assert((await source.FetchAsync("tv:456", default)).Length == 0, "Removed TMDB IDs are successful negative availability results");
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
                return key == "movie:2" ? [] : [8];
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
            assert(complete is { Pending: 0, Total: 3 } && complete.Memberships["movie:1"].SequenceEqual(new[] { 8 })
                && complete.Memberships["movie:2"].Length == 0 && complete.Memberships.ContainsKey("tv:1"),
                "Successful negatives are cached separately from missing data, and movie/TV IDs never collide");
            await cache.FlushAsync(default);
            var restored = new ProviderAvailabilityCache(path, (_, _) => throw new Exception("Fresh persisted cache must not refetch"), () => true, () => current);
            var persisted = await restored.ReadAsync(["movie:1", "movie:2", "tv:1"], default);
            assert(persisted.Status == "ready" && persisted.Memberships.Count == 3, "Successful availability survives a server restart without another lookup");
            current += TimeSpan.FromDays(8); fail = true;
            var stale = await cache.ReadAsync(["movie:1"], default);
            assert(stale.Status == "refreshing" && stale.Memberships["movie:1"].Contains(8), "Expired availability remains usable while refreshing");
            await WaitUntil(async () => (await cache.ReadAsync(["movie:1"], default)).Status == "unavailable");
            var failed = await cache.ReadAsync(["movie:1", "movie:3"], default);
            assert(failed.Memberships["movie:1"].Contains(8), "A failed refresh preserves the last successful provider membership");
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
        var users = InterfaceStub.Create<IUserManager>((_, args) => (Guid)args![0]! == user.Id ? user : throw new Exception("No other user may be queried"));
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
            return Task.FromResult(new ProviderCacheSnapshot(new Dictionary<string, int[]> { ["movie:1"] = [8], ["movie:2"] = [337], ["movie:3"] = [8] }, 0, 0, 3, DateTimeOffset.UtcNow, "ready"));
        });
        var controller = new ProviderItemsController(authorization, sessions, users, devices, network, library, dtos, availability)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        controller.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
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
        var beforeUnauthorized = libraryCalls;
        auth.IsApiKey = true;
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult, "API keys cannot access personal provider catalogues");
        auth.IsApiKey = false; session.DeviceId = "different";
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult, "Provider catalogue rejects a mismatched authenticated device");
        session.DeviceId = auth.DeviceId; allowedDevice = false;
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult, "Provider catalogue obeys revoked device access");
        allowedDevice = true; user.SetPermission(PermissionKind.IsDisabled, true);
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult, "Provider catalogue rejects a disabled account");
        user.SetPermission(PermissionKind.IsDisabled, false); local = false; user.SetPermission(PermissionKind.EnableRemoteAccess, false);
        assert(await controller.GetProviderItems("netflix") is UnauthorizedResult && libraryCalls == beforeUnauthorized,
            "Revoked remote access is rejected before any user media or public-ID lookup");
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
