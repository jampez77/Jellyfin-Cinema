using System.Net;
using System.Reflection;
using System.Text.Json;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif
using Jellyfin.Plugin.TvItemLayout.Api;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class HomeCollectionsChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "cinema-home-check-" + Guid.NewGuid().ToString("N"));
        var user = new User("home-check", "default", "reset") { Id = Guid.NewGuid() };
        user.SetPermission(PermissionKind.IsDisabled, false);
        user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        var auth = new AuthorizationInfo { Token = "test-token", DeviceId = "test-device", User = user };
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        SessionInfo? session = null;
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) => {
            if (method.Name != "GetSessionByAuthenticationToken" || (string)args![0]! != "test-token" || (string)args[1]! != "test-device") throw new Exception("Unexpected Home session lookup");
            return Task.FromResult(session!);
        });
        session = new SessionInfo(sessions, NullLogger.Instance) { UserId = user.Id, DeviceId = auth.DeviceId };
        var users = InterfaceStub.Create<IUserManager>((method, args) => method.Name == "GetUserById" && (Guid)args![0]! == user.Id ? user : throw new Exception("Home rows cannot inspect other accounts"));
        var allowedDevice = true;
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => allowedDevice);
        var local = true;
        var network = InterfaceStub.Create<INetworkManager>((_, _) => local);
        var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath" ? directory : throw new Exception("Unexpected storage path"));
        HomeCollectionsController Controller() {
            var controller = new HomeCollectionsController(authorization, sessions, users, devices, network, paths)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            controller.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
            return controller;
        }
        // A second controller emulates another device/request hitting the same server.
        var controller = Controller();
        var second = Controller();
        var settings = JsonSerializer.SerializeToElement(new { version = 1, rows = new[] { new {
            id = "row", kind = "items", title = "Trending", collectionIds = new[] { "collection" }, ranked = true,
            placement = "start", itemSort = "collection", itemOrder = Array.Empty<string>() } } });
        var empty = JsonSerializer.SerializeToElement(new { version = 1, rows = Array.Empty<object>() });
        HomeCollectionsResponse Value(IActionResult result) => (HomeCollectionsResponse)((OkObjectResult)result).Value!;
        try
        {
            assert(typeof(HomeCollectionsController).GetCustomAttribute<AuthorizeAttribute>() is not null
                && typeof(HomeCollectionsController).GetCustomAttribute<ResponseCacheAttribute>()?.NoStore == true,
                "Home rows require authentication and never use shared HTTP caches");
            assert(Value(await controller.GetHomeCollections()) is { Revision: null, Settings: null }, "Missing Home settings are distinct from explicitly empty rows");
            var request = new HomeCollectionsRequest(null, settings);
            var race = await Task.WhenAll(controller.PutHomeCollections(request), second.PutHomeCollections(request));
            assert(race.Count(result => result is OkObjectResult) == 1 && race.Count(result => result is ConflictObjectResult) == 1,
                "Competing first-device migrations have exactly one winner");
            var saved = Value(await second.GetHomeCollections());
            assert(saved.Revision is not null && saved.Settings!.Value.GetProperty("rows")[0].GetProperty("title").GetString() == "Trending",
                "Another device reads the saved per-user row and revision");
            var cleared = Value(await controller.PutHomeCollections(new(saved.Revision, empty)));
            assert(cleared.Revision != saved.Revision && cleared.Settings!.Value.GetProperty("rows").GetArrayLength() == 0,
                "Delete-all remains a saved authoritative revision");
            assert(await second.PutHomeCollections(new(saved.Revision, settings)) is ConflictObjectResult
                && await second.PutHomeCollections(new(null, settings)) is ConflictObjectResult,
                "Stale edits and late migration cannot resurrect removed Home rows");
            var firstUser = user.Id;
            user.Id = Guid.NewGuid(); session.UserId = user.Id;
            assert(Value(await second.GetHomeCollections()).Revision is null, "Another account has independent Home settings");
            user.Id = firstUser; session.UserId = user.Id;
            assert(Value(await second.GetHomeCollections()).Revision == cleared.Revision, "Switching back preserves the original account settings");
            foreach (var invalid in new[] { "null", "{}", "{\"version\":\"1\",\"rows\":[]}", "{\"version\":1,\"rows\":[],\"UserId\":\"other\"}", "{\"version\":1,\"rows\":[null]}" })
                assert(await controller.PutHomeCollections(new(cleared.Revision, JsonDocument.Parse(invalid).RootElement)) is BadRequestObjectResult,
                    "Malformed or unexpected Home schema is rejected: " + invalid);
            var hugeRows = Enumerable.Range(0, 12).Select(i => new { id = "row" + i, kind = "items", title = "Title", collectionIds = new[] { "id" }, ranked = false, placement = "end", itemSort = "custom", itemOrder = Enumerable.Repeat(new string('a', 199), 2000).ToArray() }).ToArray();
            assert(await controller.PutHomeCollections(new(cleared.Revision, JsonSerializer.SerializeToElement(new { version = 1, rows = hugeRows }))) is ObjectResult { StatusCode: 413 }, "Oversized valid-shaped Home settings cannot fill server storage");
            var unicodeRows = Enumerable.Range(0, 12).Select(i => new { id = "row" + i, kind = "items", title = new string('中', 80), collectionIds = new[] { "id" }, ranked = false, placement = "end", itemSort = "custom", itemOrder = Enumerable.Range(0, 1233).Select(n => n.ToString("x32")).ToArray() }).ToArray();
            var unicodeJson = JsonSerializer.Serialize(new { version = 1, rows = unicodeRows }, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            assert(System.Text.Encoding.UTF8.GetByteCount(unicodeJson) < HomeCollectionsController.MaximumBytes - 1024,
                "Unicode regression input fits the incoming settings limit");
            assert(await controller.PutHomeCollections(new(cleared.Revision, JsonDocument.Parse(unicodeJson).RootElement)) is ObjectResult { StatusCode: 413 }
                && Value(await controller.GetHomeCollections()).Revision == cleared.Revision,
                "Escaping expansion cannot publish a saved file too large to read back");
            auth.IsApiKey = true;
            assert(await controller.GetHomeCollections() is UnauthorizedResult && await controller.PutHomeCollections(request) is UnauthorizedResult, "API keys cannot read or modify personal Home rows");
            auth.IsApiKey = false; session.DeviceId = "other-device";
            assert(await controller.GetHomeCollections() is UnauthorizedResult, "A mismatched device session cannot read Home rows");
            session.DeviceId = auth.DeviceId; allowedDevice = false;
            assert(await controller.PutHomeCollections(request) is UnauthorizedResult, "Revoked device access cannot modify Home rows");
            allowedDevice = true; user.SetPermission(PermissionKind.IsDisabled, true);
            assert(await controller.GetHomeCollections() is UnauthorizedResult, "Disabled users cannot read saved Home rows");
            user.SetPermission(PermissionKind.IsDisabled, false); local = false; user.SetPermission(PermissionKind.EnableRemoteAccess, false);
            assert(await controller.PutHomeCollections(request) is UnauthorizedResult, "Revoked remote access cannot modify Home rows");
            local = true;
            assert(Value(await controller.GetHomeCollections()).Revision == cleared.Revision, "Rejected writes leave the last saved revision intact");
            assert(!Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories).Any(), "Atomic Home writes leave no temporary files");
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
