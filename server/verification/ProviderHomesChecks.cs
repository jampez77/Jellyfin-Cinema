using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.TvItemLayout.Providers;
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

public static class ProviderHomesChecks
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
            if (method.Name != "GetSessionByAuthenticationToken" || (string)args![0]! != "test-token" || (string)args[1]! != "test-device") throw new Exception("Unexpected Provider session lookup");
            return Task.FromResult(session!);
        });
        session = new SessionInfo(sessions, NullLogger.Instance) { UserId = user.Id, DeviceId = auth.DeviceId };
        var users = InterfaceStub.Create<IUserManager>((method, args) => method.Name == "GetUserById" && (Guid)args![0]! == user.Id ? user : throw new Exception("Provider Homes cannot inspect other accounts"));
        var allowedDevice = true;
        var devices = InterfaceStub.Create<IDeviceManager>((_, _) => allowedDevice);
        var local = true;
        var network = InterfaceStub.Create<INetworkManager>((_, _) => local);
        var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath" ? directory : throw new Exception("Unexpected storage path"));
        ProviderHomesController Controller() {
            var controller = new ProviderHomesController(authorization, sessions, users, devices, network, paths)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            controller.HttpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
            return controller;
        }
        // A second controller emulates another device/request hitting the same server.
        var controller = Controller();
        var second = Controller();
        var settings = JsonSerializer.SerializeToElement(new { version = 1, enabled = true, title = "Streaming", placement = "start", providers = new[] { new {
            id = "netflix", enabled = true, hero = true, rows = new[] { new { id = "movies", title = "Films", source = "movies", collectionId = "", enabled = true, ranked = false, itemSort = "title" } }
        } } });
        var empty = JsonSerializer.SerializeToElement(new { version = 1, enabled = false, title = "", placement = "end", providers = Array.Empty<object>() });
        ProviderHomesResponse Value(IActionResult result) => (ProviderHomesResponse)((OkObjectResult)result).Value!;
        try
        {
            assert(typeof(ProviderHomesController).GetCustomAttribute<AuthorizeAttribute>() is not null
                && typeof(ProviderHomesController).GetCustomAttribute<ResponseCacheAttribute>()?.NoStore == true,
                "Provider Homes require authentication and never use shared HTTP caches");
            assert(Value(await controller.GetProviderHomes()) is { Revision: null, Settings: null }, "Missing Provider settings are distinct from explicitly empty rows");
            var request = new ProviderHomesRequest(null, settings);
            var race = await Task.WhenAll(controller.PutProviderHomes(request), second.PutProviderHomes(request));
            assert(race.Count(result => result is OkObjectResult) == 1 && race.Count(result => result is ConflictObjectResult) == 1,
                "Competing first-device migrations have exactly one winner");
            var saved = Value(await second.GetProviderHomes());
            assert(saved.Revision is not null && saved.Settings!.Value.GetProperty("providers")[0].GetProperty("rows")[0].GetProperty("title").GetString() == "Films",
                "Another device reads the saved per-user row and revision");
            var cleared = Value(await controller.PutProviderHomes(new(saved.Revision, empty)));
            assert(cleared.Revision != saved.Revision && cleared.Settings!.Value.GetProperty("providers").GetArrayLength() == 0,
                "Delete-all remains a saved authoritative revision");
            assert(await second.PutProviderHomes(new(saved.Revision, settings)) is ConflictObjectResult
                && await second.PutProviderHomes(new(null, settings)) is ConflictObjectResult,
                "Stale edits and late migration cannot resurrect removed Provider Homes");
            var firstUser = user.Id;
            user.Id = Guid.NewGuid(); session.UserId = user.Id;
            assert(Value(await second.GetProviderHomes()).Revision is null, "Another account has independent Provider settings");
            user.Id = firstUser; session.UserId = user.Id;
            assert(Value(await second.GetProviderHomes()).Revision == cleared.Revision, "Switching back preserves the original account settings");
            foreach (var invalid in new[] { "null", "{}", "{\"version\":\"1\",\"rows\":[]}", "{\"version\":1,\"rows\":[],\"UserId\":\"other\"}", "{\"version\":1,\"rows\":[null]}" })
                assert(await controller.PutProviderHomes(new(cleared.Revision, JsonDocument.Parse(invalid).RootElement)) is BadRequestObjectResult,
                    "Malformed or unexpected Provider schema is rejected: " + invalid);
            foreach (var change in new[] {
                settings.GetRawText().Replace("\"netflix\"", "\"unknown\""),
                settings.GetRawText().Replace("\"source\":\"movies\"", "\"source\":\"studio\""),
                settings.GetRawText().Replace("\"itemSort\":\"title\"", "\"itemSort\":\"custom\""),
                settings.GetRawText().Replace("\"placement\":\"start\"", "\"placement\":\"native:\""),
                settings.GetRawText().Replace("\"collectionId\":\"\"", "\"collectionId\":\"\",\"itemOrder\":[]"),
                settings.GetRawText().Replace("\"title\":\"Streaming\"", "\"title\":\"" + new string('x', 81) + "\"") })
                assert(await controller.PutProviderHomes(new(cleared.Revision, JsonDocument.Parse(change).RootElement)) is BadRequestObjectResult,
                    "Provider Homes reject unsupported or out-of-bounds settings");
            var duplicateProviders = JsonSerializer.SerializeToElement(new { version = 1, enabled = true, title = "", placement = "start", providers = new[] { settings.GetProperty("providers")[0], settings.GetProperty("providers")[0] } });
            assert(await controller.PutProviderHomes(new(cleared.Revision, duplicateProviders)) is BadRequestObjectResult,
                "Duplicate provider IDs cannot introduce conflicting provider Home definitions");
            var tooManyRows = JsonSerializer.SerializeToElement(new { version = 1, enabled = true, title = "", placement = "start", providers = new[] { new {
                id = "netflix", enabled = true, hero = true, rows = Enumerable.Range(0, 13).Select(i => new { id = "row" + i, title = "", source = "movies", collectionId = "", enabled = true, ranked = false, itemSort = "title" }).ToArray()
            } } });
            assert(await controller.PutProviderHomes(new(cleared.Revision, tooManyRows)) is BadRequestObjectResult,
                "Provider Homes enforce the maximum rows per provider");
            var unicodeSettings = JsonSerializer.SerializeToElement(new { version = 1, enabled = true, title = "", placement = "start",
                providers = new[] { "netflix", "prime", "disney", "apple", "now", "paramount" }.Select(id => new { id, enabled = true, hero = true,
                    rows = Enumerable.Range(0, 12).Select(i => new { id = new string('中', 96) + i, title = new string('中', 80), source = "collection", collectionId = new string('中', 199), enabled = true, ranked = false, itemSort = "title" }).ToArray() }).ToArray() });
            assert(await controller.PutProviderHomes(new(cleared.Revision, unicodeSettings)) is ObjectResult { StatusCode: 413 }
                && Value(await controller.GetProviderHomes()).Revision == cleared.Revision,
                "Oversized valid provider settings cannot replace a readable saved revision");
            var customized = JsonSerializer.SerializeToElement(new { version = 2, enabled = false, title = "My services", placement = "end", tileScale = 125, showNames = false,
                providers = new[] { new { id = "custom-family", name = "Family streaming", logoUrl = "https://example.com/logo.png", accent = "#AABBCC", movieProviderIds = new[] { 8, 1000000 }, showProviderIds = Array.Empty<int>(), offerTypes = new[] { "free", "ads" }, enabled = true, hero = false, rows = Array.Empty<object>() } } });
            var upgraded = Value(await controller.PutProviderHomes(new(cleared.Revision, customized)));
            assert(upgraded.Settings!.Value.GetRawText() == customized.GetRawText(), "Schema2 appearance, custom service identity and availability mappings persist exactly");
            assert(await controller.PutProviderHomes(new(upgraded.Revision, settings)) is ConflictObjectResult
                && Value(await controller.GetProviderHomes()).Revision == upgraded.Revision,
                "An older schema1 client cannot overwrite schema2 even with the current revision");
            cleared = upgraded;
            var invalidEdits = new Action<JsonNode>[] {
                node => node["tileScale"] = 69, node => node["tileScale"] = 151, node => node["tileScale"] = 100.5,
                node => node["showNames"] = "false", node => node["providers"]![0]!["id"] = "custom-UPPER", node => node["providers"]![0]!["id"] = "custom-line\n",
                node => node["providers"]![0]!["id"] = "custom-" + new string('a', 58),
                node => node["providers"]![0]!["name"] = "", node => node["providers"]![0]!["name"] = new string('a', 81),
                node => node["providers"]![0]!["logoUrl"] = "file:///etc/passwd", node => node["providers"]![0]!["logoUrl"] = "https://user:secret@example.com/logo.png",
                node => node["providers"]![0]!["logoUrl"] = new string('a', 2049), node => node["providers"]![0]!["accent"] = "#FFF",
                node => node["providers"]![0]!["movieProviderIds"] = new JsonArray(8, 8), node => node["providers"]![0]!["movieProviderIds"] = new JsonArray(0),
                node => node["providers"]![0]!["movieProviderIds"] = new JsonArray(1000001), node => node["providers"]![0]!["movieProviderIds"] = new JsonArray(1.5),
                node => node["providers"]![0]!["movieProviderIds"] = JsonSerializer.SerializeToNode(Enumerable.Range(1, 21).ToArray()),
                node => node["providers"]![0]!["offerTypes"] = new JsonArray(), node => node["providers"]![0]!["offerTypes"] = new JsonArray("rent"),
                node => node["providers"]![0]!["offerTypes"] = new JsonArray("ads", "ads"), node => node["providers"]![0]!["unexpected"] = true
            };
            foreach (var edit in invalidEdits)
            {
                var node = JsonNode.Parse(customized.GetRawText())!; edit(node);
                assert(await controller.PutProviderHomes(new(cleared.Revision, JsonSerializer.SerializeToElement(node))) is BadRequestObjectResult,
                    "Schema2 rejects invalid appearance, URL, IDs, offer categories or extra fields without changing saved preferences");
            }
            var many = JsonNode.Parse(customized.GetRawText())!;
            many["providers"] = new JsonArray(Enumerable.Range(0, 24).Select(i => { var item = JsonNode.Parse(customized.GetProperty("providers")[0].GetRawText())!; item["id"] = "custom-" + i; return item; }).ToArray());
            assert(ProviderHomesSchema.ValidSettings(JsonSerializer.SerializeToElement(many)), "Schema2 accepts all 24 unique configured providers");
            var overflow = JsonNode.Parse(customized.GetProperty("providers")[0].GetRawText())!;
            ((JsonArray)many["providers"]!).Add(overflow);
            assert(!ProviderHomesSchema.ValidSettings(JsonSerializer.SerializeToElement(many)), "Schema2 rejects more than 24 providers");
            var legacyNetflix = ProviderHomesSchema.Resolve(settings, "netflix");
            assert(legacyNetflix is not null && legacyNetflix.MovieProviderIds.SequenceEqual(new[] { 8, 175, 1796 }) && legacyNetflix.OfferTypes.SequenceEqual(new[] { "flatrate" })
                && ProviderHomesSchema.Resolve(settings, "bbc")!.MovieProviderIds.SequenceEqual(new[] { 38 })
                && ProviderHomesSchema.Resolve(settings, "itvx")!.OfferTypes.SequenceEqual(new[] { "free", "ads" })
                && ProviderHomesSchema.Resolve(empty, "bbc") is null && ProviderHomesSchema.Resolve(empty, "netflix") is null,
                "Catalogue migration appends verified broadcasters to populated legacy settings while preserving an explicitly empty account");
            auth.IsApiKey = true;
            assert(await controller.GetProviderHomes() is UnauthorizedResult && await controller.PutProviderHomes(request) is UnauthorizedResult, "API keys cannot read or modify personal Provider Homes");
            auth.IsApiKey = false; session.DeviceId = "other-device";
            assert(await controller.GetProviderHomes() is UnauthorizedResult, "A mismatched device session cannot read Provider Homes");
            session.DeviceId = auth.DeviceId; allowedDevice = false;
            assert(await controller.PutProviderHomes(request) is UnauthorizedResult, "Revoked device access cannot modify Provider Homes");
            allowedDevice = true; user.SetPermission(PermissionKind.IsDisabled, true);
            assert(await controller.GetProviderHomes() is UnauthorizedResult, "Disabled users cannot read saved Provider Homes");
            user.SetPermission(PermissionKind.IsDisabled, false); local = false; user.SetPermission(PermissionKind.EnableRemoteAccess, false);
            assert(await controller.PutProviderHomes(request) is UnauthorizedResult, "Revoked remote access cannot modify Provider Homes");
            local = true;
            assert(Value(await controller.GetProviderHomes()).Revision == cleared.Revision, "Rejected writes leave the last saved revision intact");
            assert(!Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories).Any(), "Atomic Provider writes leave no temporary files");
            user.Id = Guid.NewGuid(); session.UserId = user.Id;
            await ProviderHomesHttpChecks.Run(assert, services =>
            {
                services.AddSingleton(authorization);
                services.AddSingleton(sessions);
                services.AddSingleton(users);
                services.AddSingleton(devices);
                services.AddSingleton(network);
                services.AddSingleton(paths);
            }, value => auth.IsApiKey = value, settings);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
