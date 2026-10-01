using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout.Api;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Logging.Abstractions;

public static class LoadingScreenHttpChecks
{
    private const string Endpoint = "/TvItemLayout/LoadingScreen";

    public static async Task Run(Action<bool, string> assert)
    {
        var directory = Path.Combine(Path.GetTempPath(), "screenharbour-loading-http-" + Guid.NewGuid().ToString("N"));
        var account = Guid.NewGuid(); var otherAccount = Guid.NewGuid();
        var settings = LoadingScreenChecks.Settings("clapperboard", "Our family cinema", "Getting your films ready…");
        var path = Path.Combine(directory, "jellyfin-cinema", "loading-screen", account.ToString("N") + ".json");
        JsonElement saved;
        byte[] bytes;
        try
        {
            await using (var initial = await Host.Start(directory, account))
            {
                using var get = await initial.Client.GetAsync(Endpoint);
                var absent = await Json(get);
                assert(get.StatusCode == HttpStatusCode.OK && get.Headers.CacheControl?.NoStore == true
                    && absent.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(new[] { "Revision", "Settings" })
                    && absent.GetProperty("Revision").ValueKind == JsonValueKind.Null && absent.GetProperty("Settings").ValueKind == JsonValueKind.Null
                    && !Directory.Exists(directory), "Loading screen HTTP first use keeps both explicit null fields under Jellyfin's serializer without writing defaults");
                assert(new[] { JsonDefaults.Options, JsonDefaults.PascalCaseOptions, JsonDefaults.CamelCaseOptions }.All(options =>
                    JsonSerializer.Serialize(new LoadingScreenResponse(null, null), options) == "{\"Revision\":null,\"Settings\":null}"),
                    "Loading screen null and casing contract survives every native Jellyfin JSON profile");
                using var put = await initial.Put(null, settings);
                saved = await Json(put);
                var revision = saved.GetProperty("Revision").GetString();
                assert(put.StatusCode == HttpStatusCode.OK && put.Headers.CacheControl?.NoStore == true
                    && Guid.TryParseExact(revision, "N", out _)
                    && JsonNode.DeepEquals(JsonNode.Parse(saved.GetProperty("Settings").GetRawText()), JsonNode.Parse(settings.GetRawText())),
                    "Loading screen HTTP save returns its complete customization and new revision without caching");
                bytes = await File.ReadAllBytesAsync(path);
                using var loaded = await initial.Client.GetAsync(Endpoint + "?userId=" + otherAccount.ToString("N"));
                assert((await Json(loaded)).GetRawText() == saved.GetRawText(), "Loading screen HTTP reads cannot select another account through a query string");
                using var stale = await initial.Put(null, LoadingScreenChecks.Settings());
                assert(stale.StatusCode == HttpStatusCode.Conflict && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Loading screen HTTP conditional saves reject stale first-use clients without changing the saved file");
                using var invalidSettings = await initial.Put(revision, JsonSerializer.SerializeToElement(new { version = 2, animation = "projector", brandText = "", message = "" }));
                using var unknownEnvelope = await initial.PutRaw(JsonSerializer.Serialize(new { Revision = revision, Settings = settings, UserId = otherAccount }));
                using var missingSettings = await initial.PutRaw(JsonSerializer.Serialize(new { Revision = revision }));
                assert(invalidSettings.StatusCode == HttpStatusCode.BadRequest && unknownEnvelope.StatusCode == HttpStatusCode.BadRequest
                    && missingSettings.StatusCode == HttpStatusCode.BadRequest && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Loading screen HTTP validation rejects unsupported settings, extra envelope fields and absent settings");
                using var oversized = await initial.PutRaw(new string(' ', LoadingScreenController.MaximumBytes) + JsonSerializer.Serialize(new LoadingScreenRequest(revision, settings)));
                assert(oversized.StatusCode == HttpStatusCode.RequestEntityTooLarge && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Loading screen HTTP request-size limit rejects oversized bodies before saving");
                initial.Authorization.IsApiKey = true;
                using var deniedRead = await initial.Client.GetAsync(Endpoint);
                using var deniedWrite = await initial.Put(revision, LoadingScreenChecks.Settings());
                assert(deniedRead.StatusCode == HttpStatusCode.Unauthorized && deniedWrite.StatusCode == HttpStatusCode.Unauthorized
                    && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes), "Loading screen HTTP API-key requests cannot read or modify account preferences");
            }
            await using (var restarted = await Host.Start(directory, account))
            {
                using var get = await restarted.Client.GetAsync(Endpoint);
                assert((await Json(get)).GetRawText() == saved.GetRawText() && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "Loading screen customization survives a recreated server host and new device session without rewriting its revision");
                using var update = await restarted.Put(saved.GetProperty("Revision").GetString(), LoadingScreenChecks.Settings("jellyfin", "", ""));
                var updated = await Json(update);
                assert(update.StatusCode == HttpStatusCode.OK && updated.GetProperty("Revision").GetString() != saved.GetProperty("Revision").GetString()
                    && updated.GetProperty("Settings").GetProperty("brandText").GetString() == ""
                    && updated.GetProperty("Settings").GetProperty("message").GetString() == "",
                    "Loading screen HTTP preserves intentional empty text and the native Jellyfin animation choice");
                using var conflict = await restarted.Put(saved.GetProperty("Revision").GetString(), settings);
                assert(conflict.StatusCode == HttpStatusCode.Conflict, "Another device's stale loading screen revision cannot restore an older animation");
                saved = updated; bytes = await File.ReadAllBytesAsync(path);
            }
            await using (var other = await Host.Start(directory, otherAccount))
            {
                using var get = await other.Client.GetAsync(Endpoint);
                var absent = await Json(get);
                using var put = await other.Put(null, LoadingScreenChecks.Settings("spotlights", "Another profile", ""));
                assert(absent.GetProperty("Revision").ValueKind == JsonValueKind.Null && absent.GetProperty("Settings").ValueKind == JsonValueKind.Null
                    && put.StatusCode == HttpStatusCode.OK && (await File.ReadAllBytesAsync(path)).SequenceEqual(bytes),
                    "A second profile saves independent loading screen preferences without changing the first profile");
            }
            await using (var returned = await Host.Start(directory, account))
            {
                using var get = await returned.Client.GetAsync(Endpoint);
                assert((await Json(get)).GetRawText() == saved.GetRawText(), "Returning to the original profile after a server restart preserves the chosen loading screen");
            }
            File.Move(path, path + ".saved"); Directory.CreateDirectory(path);
            await using (var broken = await Host.Start(directory, account))
            {
                using var get = await broken.Client.GetAsync(Endpoint);
                using var put = await broken.Put(saved.GetProperty("Revision").GetString(), settings);
                assert(get.StatusCode == HttpStatusCode.InternalServerError && put.StatusCode == HttpStatusCode.InternalServerError
                    && (await File.ReadAllBytesAsync(path + ".saved")).SequenceEqual(bytes),
                    "An inaccessible loading screen settings path reports failure and cannot masquerade as missing defaults");
                Directory.Delete(path); File.Move(path + ".saved", path);
                using var recovered = await broken.Client.GetAsync(Endpoint);
                assert(recovered.StatusCode == HttpStatusCode.OK && (await Json(recovered)).GetRawText() == saved.GetRawText()
                    && !Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories).Any(),
                    "Loading screen storage recovery restores the complete customization with no locked store or temporary files");
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private sealed class Host(WebApplication app, HttpClient client, AuthorizationInfo authorization) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;
        public AuthorizationInfo Authorization { get; } = authorization;
        public Task<HttpResponseMessage> Put(string? revision, JsonElement settings) => PutRaw(JsonSerializer.Serialize(new LoadingScreenRequest(revision, settings)));
        public Task<HttpResponseMessage> PutRaw(string body) => Client.PutAsync(Endpoint, new StringContent(body, Encoding.UTF8, "application/json"));

        public static async Task<Host> Start(string directory, Guid account)
        {
            var user = new User("loading-http", "default", "reset") { Id = account };
            user.SetPermission(PermissionKind.IsDisabled, false); user.SetPermission(PermissionKind.EnableRemoteAccess, true);
            var auth = new AuthorizationInfo { Token = Guid.NewGuid().ToString("N"), DeviceId = Guid.NewGuid().ToString("N"), User = user };
            var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
            SessionInfo? session = null;
            var sessions = InterfaceStub.Create<ISessionManager>((method, args) => method.Name == "GetSessionByAuthenticationToken"
                && (string)args![0]! == auth.Token && (string)args[1]! == auth.DeviceId ? Task.FromResult(session!) : throw new Exception("Unexpected loading screen HTTP session lookup"));
            session = new SessionInfo(sessions, NullLogger.Instance) { UserId = account, DeviceId = auth.DeviceId };
            var users = InterfaceStub.Create<IUserManager>((method, args) => method.Name == "GetUserById" && (Guid)args![0]! == account
                ? user : throw new Exception("Loading screen HTTP cannot inspect another account"));
            var paths = InterfaceStub.Create<IApplicationPaths>((method, _) => method.Name == "get_DataPath" ? directory : throw new Exception("Loading screen store must use the stable server data path"));
            var builder = WebApplication.CreateBuilder();
            builder.Logging.SetMinimumLevel(LogLevel.Warning); builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Services.AddSingleton(authorization); builder.Services.AddSingleton(sessions); builder.Services.AddSingleton(users); builder.Services.AddSingleton(paths);
            builder.Services.AddSingleton(InterfaceStub.Create<IDeviceManager>((_, _) => true));
            builder.Services.AddSingleton(InterfaceStub.Create<INetworkManager>((_, _) => true));
            builder.Services.AddAuthorization();
            builder.Services.AddControllers().AddApplicationPart(typeof(LoadingScreenController).Assembly).AddJsonOptions(options =>
            {
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
            app.Use(async (context, next) =>
            {
                context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, account.ToString("N"))], "fixture"));
                await next();
            });
            app.UseAuthorization(); app.MapControllers(); await app.StartAsync();
            var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            return new(app, new HttpClient { BaseAddress = new Uri(address) }, auth);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose(); await app.StopAsync(); await app.DisposeAsync();
        }
    }
}
