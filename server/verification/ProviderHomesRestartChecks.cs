using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout.Api;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Logging.Abstractions;

public static class ProviderHomesRestartChecks
{
    private const string Endpoint = "/TvItemLayout/ProviderHomes";

    public static async Task Run(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "cinema-provider-restart-" + Guid.NewGuid().ToString("N"));
        var account = Guid.NewGuid();
        var path = Path.Combine(directory, "jellyfin-cinema", "provider-homes", account.ToString("N") + ".json");
        var settings = JsonSerializer.SerializeToElement(new {
            version = 2, enabled = true, title = "Family services", placement = "end", tileScale = 120, showNames = false,
            providers = new[] { new {
                id = "netflix", name = "Netflix", logoUrl = "", accent = "#E50914", movieProviderIds = new[] { 8 }, showProviderIds = new[] { 8 },
                offerTypes = new[] { "flatrate" }, enabled = true, hero = true, rows = new[] {
                    new { id = "films", title = "Trending films", source = "trending-movies", collectionId = "selected-film-collection", enabled = true, ranked = true, itemSort = "collection" },
                    new { id = "shows", title = "Trending TV", source = "trending-shows", collectionId = "selected-tv-collection", enabled = true, ranked = true, itemSort = "collection" },
                    new { id = "weekend", title = "Weekend choices", source = "collection", collectionId = "selected-weekend-collection", enabled = false, ranked = false, itemSort = "newest" }
                }
            } }
        });
        try
        {
            JsonElement saved;
            await using (var first = await Host.Start(directory, account))
            {
                using var write = await first.Put(null, settings);
                assert(write.StatusCode == HttpStatusCode.OK, "Provider collection selections save through the real HTTP controller");
                saved = await Json(write);
                assert(saved.GetProperty("Settings").GetRawText() == settings.GetRawText(),
                    "Schema2 save confirms exact trending and custom collection selections, including disabled rows");
            }
            var bytes = await File.ReadAllBytesAsync(path);
            using (var persisted = JsonDocument.Parse(bytes))
                assert(persisted.RootElement.GetRawText() == saved.GetRawText(),
                    "Complete collection selections and revision are persisted outside the plugin installation directory");

            // Dispose the first HTTP host, services and client completely. The
            // replacement has a fresh user object, token and device session;
            // only the account ID and server data directory survive restart.
            await using (var restarted = await Host.Start(directory, account))
            {
                using var read = await restarted.Client.GetAsync(Endpoint);
                assert(read.StatusCode == HttpStatusCode.OK && (await Json(read)).GetRawText() == saved.GetRawText(),
                    "A restarted server with a fresh login restores every collection binding and the original revision");
                assert((await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Restart and settings reads cannot rewrite saved selections or replace them with defaults");
                using var staleSave = await restarted.Put(null, settings);
                assert(staleSave.StatusCode == HttpStatusCode.Conflict && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "A newly opened client cannot overwrite persisted selections using an empty pre-restart revision");
            }
            await using (var differentAccount = await Host.Start(directory, Guid.NewGuid()))
            {
                using var read = await differentAccount.Client.GetAsync(Endpoint);
                var absent = await Json(read);
                assert(read.StatusCode == HttpStatusCode.OK && absent.GetProperty("Revision").ValueKind == JsonValueKind.Null
                    && absent.GetProperty("Settings").ValueKind == JsonValueKind.Null && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Another account starts independently without clearing the original account's selections");
            }
            await using (var returned = await Host.Start(directory, account))
            {
                using var read = await returned.Client.GetAsync(Endpoint);
                assert((await Json(read)).GetRawText() == saved.GetRawText(),
                    "Returning to the original account after another restart keeps its chosen collections");
            }
            // File.Exists also returns false when a settings path is a
            // directory or cannot be accessed. Neither means first use.
            File.Move(path, path + ".saved");
            Directory.CreateDirectory(path);
            await using (var inaccessible = await Host.Start(directory, account))
            {
                using var read = await inaccessible.Client.GetAsync(Endpoint);
                assert(read.StatusCode == HttpStatusCode.InternalServerError,
                    "An unreadable provider settings path reports failure instead of a successful empty snapshot");
                Directory.Delete(path);
                File.Move(path + ".saved", path);
                using var recovered = await inaccessible.Client.GetAsync(Endpoint);
                assert(recovered.StatusCode == HttpStatusCode.OK && (await Json(recovered)).GetRawText() == saved.GetRawText()
                    && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Recovering storage access restores the saved selections without a write or a locked settings store");
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private sealed class Host(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;
        public Task<HttpResponseMessage> Put(string? revision, JsonElement settings) => Client.PutAsync(Endpoint,
            new StringContent(JsonSerializer.Serialize(new ProviderHomesRequest(revision, settings)), Encoding.UTF8, "application/json"));

        public static async Task<Host> Start(string directory, Guid account)
        {
            var user = new User("provider-restart", "default", "reset") { Id = account };
            user.SetPermission(PermissionKind.IsDisabled, false);
            user.SetPermission(PermissionKind.EnableRemoteAccess, true);
            var auth = new AuthorizationInfo { Token = Guid.NewGuid().ToString("N"), DeviceId = Guid.NewGuid().ToString("N"), User = user };
            var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
            SessionInfo? session = null;
            var sessions = InterfaceStub.Create<ISessionManager>((method, args) => {
                if (method.Name != "GetSessionByAuthenticationToken" || (string)args![0]! != auth.Token || (string)args[1]! != auth.DeviceId)
                    throw new Exception("Unexpected restart-test session lookup");
                return Task.FromResult(session!);
            });
            session = new SessionInfo(sessions, NullLogger.Instance) { UserId = account, DeviceId = auth.DeviceId };
            var users = InterfaceStub.Create<IUserManager>((method, args) => method.Name == "GetUserById" && (Guid)args![0]! == account
                ? user : throw new Exception("Restart cannot inspect another account"));
            var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath"
                ? directory : throw new Exception("Provider settings must not depend on plugin-version or cache paths"));
            var builder = WebApplication.CreateBuilder();
            builder.Logging.SetMinimumLevel(LogLevel.Warning);
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Services.AddSingleton(authorization); builder.Services.AddSingleton(sessions); builder.Services.AddSingleton(users);
            builder.Services.AddSingleton(paths);
            builder.Services.AddSingleton(InterfaceStub.Create<IDeviceManager>((_, _) => true));
            builder.Services.AddSingleton(InterfaceStub.Create<INetworkManager>((_, _) => true));
            builder.Services.AddAuthorization();
            builder.Services.AddControllers().AddApplicationPart(typeof(ProviderHomesController).Assembly).AddJsonOptions(options => {
                var native = JsonDefaults.PascalCaseOptions;
                options.JsonSerializerOptions.ReadCommentHandling = native.ReadCommentHandling;
                options.JsonSerializerOptions.WriteIndented = native.WriteIndented;
                options.JsonSerializerOptions.DefaultIgnoreCondition = native.DefaultIgnoreCondition;
                options.JsonSerializerOptions.NumberHandling = native.NumberHandling;
                options.JsonSerializerOptions.PropertyNamingPolicy = native.PropertyNamingPolicy;
                options.JsonSerializerOptions.Converters.Clear();
                foreach (var converter in native.Converters) options.JsonSerializerOptions.Converters.Add(converter);
            });
            var app = builder.Build();
            app.Use(async (context, next) => {
                context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, account.ToString("N"))], "fixture"));
                await next();
            });
            app.UseAuthorization(); app.MapControllers();
            await app.StartAsync();
            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            return new(app, new HttpClient { BaseAddress = new Uri(address) });
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
