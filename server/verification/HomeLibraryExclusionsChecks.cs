using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Data.Enums;
#endif
using Jellyfin.Plugin.TvItemLayout.Api;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class HomeLibraryExclusionsChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        User Profile(string name)
        {
            var result = new User(name, "default", "reset") { Id = Guid.NewGuid() };
            result.SetPermission(PermissionKind.IsDisabled, false);
            result.SetPermission(PermissionKind.EnableRemoteAccess, true);
            return result;
        }
        var caller = Profile("home-library-check");
        var other = Profile("other-profile");
        var auth = new AuthorizationInfo { Token = "library-test-token", DeviceId = "library-test-device", User = caller };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        SessionInfo? session = null;
        var sessionCalls = 0;
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) =>
        {
            if (method.Name != "GetSessionByAuthenticationToken" || (string)args![0]! != auth.Token || (string)args[1]! != auth.DeviceId)
                throw new Exception("Unexpected Home library session lookup");
            sessionCalls++; return Task.FromResult(session!);
        });
        session = new SessionInfo(sessions, NullLogger.Instance) { UserId = caller.Id, DeviceId = auth.DeviceId };
        var userCalls = 0;
        var missingUser = false;
        var users = InterfaceStub.Create<IUserManager>((method, args) =>
        {
            if (method.Name != "GetUserById" || (Guid)args![0]! != auth.UserId)
                throw new Exception("Home library exclusions must only inspect the authenticated account");
            userCalls++; return missingUser ? null : auth.User;
        });
        var allowedDevice = true;
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => allowedDevice);
        var local = true;
        var network = InterfaceStub.Create<INetworkManager>((_, _) => local);
        var physicalPlaylists = Guid.Parse("1071671e7bffa0532e930debee501d2e");
        var wrongParent = Guid.NewGuid();
        var playlistView = new UserView { Id = Guid.Parse("03e69facd973b23e36355c45ba598e6b"), Name = "Any library name",
            DisplayParentId = physicalPlaylists, ParentId = wrongParent, UserId = caller.Id };
        var unrelated = new UserView { Id = Guid.NewGuid(), Name = playlistView.Name, DisplayParentId = Guid.NewGuid(), UserId = caller.Id };
        var parentless = new UserView { Id = Guid.NewGuid(), Name = "Parentless view", DisplayParentId = Guid.Empty, ParentId = wrongParent, UserId = caller.Id };
        var ordinary = new Folder { Id = Guid.NewGuid(), Name = "Ordinary library", ParentId = wrongParent };
        var music = Guid.Parse("7e64e319657a9516ec78490da03edccb");
        var otherView = new UserView { Id = Guid.NewGuid(), Name = playlistView.Name, DisplayParentId = Guid.NewGuid(), UserId = other.Id };
        var viewCalls = 0;
        var views = InterfaceStub.Create<IUserViewManager>((method, args) =>
        {
            if (method.Name != "GetUserViews" || args![0] is not UserViewQuery query
                || !query.IncludeHidden || !ReferenceEquals(query.User, auth.User))
                throw new Exception("Home library mappings require the caller's native views, including hidden views");
            viewCalls++;
            return ReferenceEquals(query.User, caller) ? new Folder[] { playlistView, unrelated, parentless, ordinary } : new Folder[] { otherView };
        });
        HomeLibraryExclusionsController Controller()
        {
            var result = new HomeLibraryExclusionsController(authorization, sessions, users, devices, network, views)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            result.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
            return result;
        }
        var controller = Controller();
        HomeLibraryExclusionsResponse Value(IActionResult result) => (HomeLibraryExclusionsResponse)((OkObjectResult)result).Value!;
        HashSet<string> Ids(IActionResult result) => Value(result).ExcludedLibraryIds.ToHashSet(StringComparer.Ordinal);
        string[] latest = [music.ToString("D").ToUpperInvariant(), playlistView.Id.ToString("N"), Guid.Empty.ToString("N")];
        string[] media = [playlistView.Id.ToString("D"), parentless.Id.ToString("N"), ordinary.Id.ToString("N")];
        caller.SetPreference(PreferenceKind.LatestItemExcludes, latest);
        caller.SetPreference(PreferenceKind.MyMediaExcludes, media);
        assert(typeof(HomeLibraryExclusionsController).GetCustomAttribute<AuthorizeAttribute>() is not null
            && typeof(HomeLibraryExclusionsController).GetCustomAttribute<ResponseCacheAttribute>() is { NoStore: true, Location: ResponseCacheLocation.None }
            && typeof(HomeLibraryExclusionsController).GetMethod(nameof(controller.GetHomeLibraryExclusions))!.GetParameters().Length == 0,
            "Home library exclusions require authentication, prohibit shared caches and accept no target user");
        var result = Value(await controller.GetHomeLibraryExclusions());
        assert(result.UserId == caller.Id.ToString("N") && result.ExcludedLibraryIds.ToHashSet().SetEquals(new[] {
            music, playlistView.Id, physicalPlaylists, parentless.Id, ordinary.Id }.Select(id => id.ToString("N")))
            && result.ExcludedLibraryIds.Length == 5,
            "Home exclusions retain and deduplicate both native preference sets and resolve the excluded per-user playlist view to its exact physical folder");
        assert(!result.ExcludedLibraryIds.Contains(wrongParent.ToString("N")) && !result.ExcludedLibraryIds.Contains(unrelated.DisplayParentId.ToString("N"))
            && !result.ExcludedLibraryIds.Contains(Guid.Empty.ToString("N")),
            "Mappings ignore base ParentId, unrelated same-name views and empty parent IDs");
        playlistView.Name = "Renamed again";
        assert(Ids(await Controller().GetHomeLibraryExclusions()).SetEquals(result.ExcludedLibraryIds),
            "Home library visibility uses stable native IDs across library renames and separate requests");
        assert(caller.GetPreferenceValues<string>(PreferenceKind.LatestItemExcludes).SequenceEqual(latest)
            && caller.GetPreferenceValues<string>(PreferenceKind.MyMediaExcludes).SequenceEqual(media)
            && playlistView.DisplayParentId == physicalPlaylists && playlistView.ParentId == wrongParent,
            "Resolving Home visibility never rewrites native preferences or the backing view");
        caller.SetPreference(PreferenceKind.LatestItemExcludes, [music.ToString("N")]);
        caller.SetPreference(PreferenceKind.MyMediaExcludes, []);
        assert(Ids(await controller.GetHomeLibraryExclusions()).SetEquals([music.ToString("N")]),
            "Re-enabling a synthetic library removes its physical alias immediately while retaining other exclusions");
        caller.SetPreference(PreferenceKind.LatestItemExcludes, []);
        var beforeViews = viewCalls;
        assert(Value(await controller.GetHomeLibraryExclusions()).ExcludedLibraryIds.Length == 0 && viewCalls == beforeViews,
            "Empty Home exclusions remain explicit and need no view-mapping query");
        other.SetPreference(PreferenceKind.MyMediaExcludes, [otherView.Id.ToString("N")]);
        auth.User = other; session.UserId = other.Id;
        result = Value(await controller.GetHomeLibraryExclusions());
        assert(result.UserId == other.Id.ToString("N") && result.ExcludedLibraryIds.ToHashSet().SetEquals([
            otherView.Id.ToString("N"), otherView.DisplayParentId.ToString("N")]),
            "Switching profiles resolves only that profile's excluded view and physical library");
        auth.User = caller; session.UserId = caller.Id;
        var beforeSessions = sessionCalls; var beforeUsers = userCalls; beforeViews = viewCalls;
        auth.Token = " ";
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Missing tokens cannot inspect Home library exclusions");
        auth.Token = "library-test-token"; auth.DeviceId = " ";
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Missing device identity cannot inspect Home library exclusions");
        auth.DeviceId = "library-test-device"; auth.IsApiKey = true;
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "API keys cannot read personal Home library exclusions");
        auth.IsApiKey = false; auth.User = null;
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult && sessionCalls == beforeSessions && userCalls == beforeUsers,
            "Unsigned callers are rejected before querying sessions or users");
        auth.User = caller; var savedSession = session; session = null;
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Revoked sessions cannot read Home library exclusions");
        session = savedSession; session.UserId = other.Id;
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "A session for another user cannot read Home library exclusions");
        session.UserId = caller.Id; session.DeviceId = "other-device";
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "A mismatched device session cannot read Home library exclusions");
        session.DeviceId = auth.DeviceId; missingUser = true;
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Deleted accounts cannot read Home library exclusions");
        missingUser = false; caller.SetPermission(PermissionKind.IsDisabled, true);
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Disabled accounts cannot read Home library exclusions");
        caller.SetPermission(PermissionKind.IsDisabled, false);
        caller.AccessSchedules.Add(new AccessSchedule(DynamicDayOfWeek.Everyday, 24, 24, caller.Id));
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Parental access schedules apply to Home library exclusions");
        caller.AccessSchedules.Clear(); allowedDevice = false;
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult, "Revoked device access prevents Home library reads");
        allowedDevice = true; local = false; caller.SetPermission(PermissionKind.EnableRemoteAccess, false);
        assert(await controller.GetHomeLibraryExclusions() is UnauthorizedResult && viewCalls == beforeViews,
            "Remote restrictions apply before any hidden library views are enumerated");
        local = true;

        // Exercise actual routing/serialization/cache headers as well as the
        // controller methods. The response contract stays exact under web JSON.
        caller.SetPreference(PreferenceKind.MyMediaExcludes, [playlistView.Id.ToString("N")]);
        var builder = WebApplication.CreateBuilder();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSingleton(authorization); builder.Services.AddSingleton(sessions); builder.Services.AddSingleton(users);
        builder.Services.AddSingleton(devices); builder.Services.AddSingleton(network); builder.Services.AddSingleton(views);
        builder.Services.AddAuthorization();
        builder.Services.AddControllers().AddApplicationPart(typeof(HomeLibraryExclusionsController).Assembly);
        await using var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, caller.Id.ToString("N"))], "fixture"));
            await next();
        });
        app.UseAuthorization(); app.MapControllers(); await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        try
        {
            using var response = await client.GetAsync("/TvItemLayout/HomeLibraryExclusions?userId=" + other.Id.ToString("N"));
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var json = body.RootElement;
            assert(response.StatusCode == HttpStatusCode.OK && response.Headers.CacheControl?.NoStore == true
                && json.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(new[] { "ExcludedLibraryIds", "UserId" })
                && json.GetProperty("UserId").GetString() == caller.Id.ToString("N")
                && json.GetProperty("ExcludedLibraryIds").EnumerateArray().Select(value => value.GetString()).ToHashSet().SetEquals([
                    playlistView.Id.ToString("N"), physicalPlaylists.ToString("N")]),
                "Home exclusion HTTP response is uncached, has exact explicit JSON fields and cannot target a different account through a query string");
            auth.IsApiKey = true;
            using var denied = await client.GetAsync("/TvItemLayout/HomeLibraryExclusions");
            assert(denied.StatusCode == HttpStatusCode.Unauthorized, "Home exclusion HTTP route rejects API-key impersonation");
            auth.IsApiKey = false; caller.SetPreference(PreferenceKind.MyMediaExcludes, []);
            using var enabled = await client.GetAsync("/TvItemLayout/HomeLibraryExclusions");
            using var empty = JsonDocument.Parse(await enabled.Content.ReadAsStringAsync());
            assert(empty.RootElement.GetProperty("ExcludedLibraryIds").GetArrayLength() == 0,
                "Home exclusion HTTP response includes an empty array after all libraries are re-enabled");
        }
        finally { await app.StopAsync(); }
    }
}
