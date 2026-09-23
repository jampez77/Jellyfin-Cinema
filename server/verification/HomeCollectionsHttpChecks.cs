using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout.Api;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

public static class HomeCollectionsHttpChecks
{
    public static async Task Run(Action<bool, string> assert, Action<IServiceCollection> registerServices,
        Action<bool> setApiKey, JsonElement settings)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        registerServices(builder.Services);
        builder.Services.AddAuthorization();
        builder.Services.AddControllers().AddApplicationPart(typeof(HomeCollectionsController).Assembly)
            .AddJsonOptions(options =>
            {
                // Match AddJellyfinApi's normal application/json formatter using
                // the actual target package's options and converters, not defaults.
                // Same configuration in v10.10.7, v10.11.0 and v12.0:
                // https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs
                var native = JsonDefaults.PascalCaseOptions;
                options.JsonSerializerOptions.ReadCommentHandling = native.ReadCommentHandling;
                options.JsonSerializerOptions.WriteIndented = native.WriteIndented;
                options.JsonSerializerOptions.DefaultIgnoreCondition = native.DefaultIgnoreCondition;
                options.JsonSerializerOptions.NumberHandling = native.NumberHandling;
                options.JsonSerializerOptions.PropertyNamingPolicy = native.PropertyNamingPolicy;
                options.JsonSerializerOptions.Converters.Clear();
                foreach (var converter in native.Converters) options.JsonSerializerOptions.Converters.Add(converter);
            });
        await using var app = builder.Build();
        // Fixture identity satisfies ASP.NET authorization; the real controller
        // still checks its native session, user and device service stubs.
        app.Use(async (context, next) =>
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "http-check")], "fixture"));
            await next();
        });
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        const string endpoint = "/TvItemLayout/HomeCollections";
        async Task<JsonElement> Json(HttpResponseMessage response) => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
        Task<HttpResponseMessage> Put(string? revision, JsonElement next) => client.PutAsync(endpoint,
            new StringContent(JsonSerializer.Serialize(new HomeCollectionsRequest(revision, next)), Encoding.UTF8, "application/json"));
        try
        {
            assert(JsonDefaults.PascalCaseOptions.DefaultIgnoreCondition == JsonIgnoreCondition.WhenWritingNull,
                "HTTP regression uses Jellyfin's null-omitting serializer configuration");
            using var absent = await client.GetAsync(endpoint);
            var missing = await Json(absent);
            assert(absent.StatusCode == HttpStatusCode.OK && absent.Headers.CacheControl?.NoStore == true
                && missing.EnumerateObject().Count() == 2 && missing.TryGetProperty("Revision", out var noRevision)
                && noRevision.ValueKind == JsonValueKind.Null && missing.TryGetProperty("Settings", out var noSettings)
                && noSettings.ValueKind == JsonValueKind.Null,
                "Actual HTTP GET retains explicit null Revision and Settings for an account without saved rows");
            foreach (var options in new[] { JsonDefaults.Options, JsonDefaults.PascalCaseOptions, JsonDefaults.CamelCaseOptions })
                assert(JsonSerializer.Serialize(new HomeCollectionsResponse(null, null), options) == "{\"Revision\":null,\"Settings\":null}",
                    "Home response contract also survives the target's JSON profile options");

            using var migration = await Put(null, settings);
            var saved = await Json(migration);
            var revision = saved.GetProperty("Revision").GetString();
            assert(migration.StatusCode == HttpStatusCode.OK && migration.Headers.CacheControl?.NoStore == true
                && Guid.TryParseExact(revision, "N", out _) && saved.GetProperty("Settings").GetRawText() == settings.GetRawText(),
                "Actual HTTP PUT accepts conditional migration and serializes the complete saved settings");
            using var loaded = await client.GetAsync(endpoint);
            assert((await Json(loaded)).GetRawText() == saved.GetRawText(),
                "Actual HTTP GET reads the existing persisted settings without changing their revision or shape");
            var empty = JsonSerializer.SerializeToElement(new { version = 1, rows = Array.Empty<object>() });
            using var cleared = await Put(revision, empty);
            var deleted = await Json(cleared);
            assert(cleared.StatusCode == HttpStatusCode.OK && deleted.GetProperty("Revision").GetString() != revision
                && deleted.GetProperty("Settings").GetProperty("rows").GetArrayLength() == 0,
                "Actual HTTP delete-all remains saved empty settings instead of a missing-store response");
            using var conflict = await Put(revision, settings);
            using var afterConflict = await client.GetAsync(endpoint);
            assert(conflict.StatusCode == HttpStatusCode.Conflict && (await Json(afterConflict)).GetRawText() == deleted.GetRawText(),
                "Actual HTTP stale revision remains a conflict and cannot replace saved empty settings");
            using var malformed = await Put(deleted.GetProperty("Revision").GetString(), JsonSerializer.SerializeToElement(new { version = 2, rows = Array.Empty<object>() }));
            assert(malformed.StatusCode == HttpStatusCode.BadRequest, "Actual HTTP invalid settings still fail closed");
            setApiKey(true);
            using var unauthorizedGet = await client.GetAsync(endpoint);
            using var unauthorizedPut = await Put(null, settings);
            assert(unauthorizedGet.StatusCode == HttpStatusCode.Unauthorized && unauthorizedPut.StatusCode == HttpStatusCode.Unauthorized,
                "Actual HTTP API-key requests cannot read or modify personal Home settings");
        }
        finally { setApiKey(false); await app.StopAsync(); }
    }
}
