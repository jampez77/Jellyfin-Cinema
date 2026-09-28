using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout.Api;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

public static class TrailerActionsHttpChecks
{
    public static async Task Run(Action<bool, string> assert, Action<IServiceCollection> registerServices,
        Guid trailerId, Guid movieId, Guid featureId, Action<bool> setOwner, Action<bool> setPlaying, Action<bool> setApiKey)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        registerServices(builder.Services);
        builder.Services.AddAuthorization();
        builder.Services.AddControllers().AddApplicationPart(typeof(TrailerActionsController).Assembly)
            .AddJsonOptions(options =>
            {
                var native = JsonDefaults.PascalCaseOptions;
                options.JsonSerializerOptions.DefaultIgnoreCondition = native.DefaultIgnoreCondition;
                options.JsonSerializerOptions.PropertyNamingPolicy = native.PropertyNamingPolicy;
                options.JsonSerializerOptions.Converters.Clear();
                foreach (var converter in native.Converters) options.JsonSerializerOptions.Converters.Add(converter);
            });
        await using var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "trailer-http-check")], "fixture"));
            await next();
        });
        app.UseAuthorization(); app.MapControllers();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        var endpoint = $"/TvItemLayout/TrailerActions?playingItemId={trailerId}&playlistItemId=trailer-entry";
        Task<HttpResponseMessage> Post(string body) => client.PostAsync("/TvItemLayout/TrailerActions/Watchlist", new StringContent(body, Encoding.UTF8, "application/json"));
        try
        {
            using var get = await client.GetAsync(endpoint);
            using var model = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
            assert(get.StatusCode == HttpStatusCode.OK && get.Headers.CacheControl?.NoStore == true
                && Guid.Parse(model.RootElement.GetProperty("PlayingItemId").GetString()!) == trailerId
                && Guid.Parse(model.RootElement.GetProperty("Movie").GetProperty("Id").GetString()!) == movieId,
                "Trailer HTTP response retains exact identity and advertised movie using Jellyfin's JSON formatter");
            setOwner(false);
            using var missing = await client.GetAsync(endpoint);
            using var unavailable = JsonDocument.Parse(await missing.Content.ReadAsStringAsync());
            assert(missing.StatusCode == HttpStatusCode.OK && unavailable.RootElement.GetProperty("Movie").ValueKind == JsonValueKind.Null,
                "Ownerless trailer HTTP response retains explicit Movie:null with native null-omitting serialization");
            setOwner(true); setPlaying(false);
            using var stopped = await client.GetAsync(endpoint);
            assert(stopped.StatusCode == HttpStatusCode.OK && (await stopped.Content.ReadAsStringAsync()).Trim() == "null",
                "No matching trailer is an explicit JSON null response, never an empty 204");
            setPlaying(true);
            using var forged = await Post(JsonSerializer.Serialize(new { PlayingItemId = trailerId, PlaylistItemId = "trailer-entry",
                MovieId = featureId, UserId = Guid.NewGuid() }));
            using var added = JsonDocument.Parse(await forged.Content.ReadAsStringAsync());
            assert(forged.StatusCode == HttpStatusCode.OK && Guid.Parse(added.RootElement.GetProperty("Movie").GetProperty("Id").GetString()!) == movieId
                && added.RootElement.GetProperty("InWatchlist").GetBoolean(),
                "Forged movie/user fields cannot redirect HTTP Watchlist writes away from the authenticated trailer owner");
            using var invalid = await client.GetAsync("/TvItemLayout/TrailerActions?playingItemId=not-a-guid");
            assert(invalid.StatusCode == HttpStatusCode.BadRequest, "HTTP model binding refuses malformed trailer identifiers");
            setApiKey(true);
            using var denied = await Post(JsonSerializer.Serialize(new TrailerActionRequest(trailerId, "trailer-entry")));
            assert(denied.StatusCode == HttpStatusCode.Unauthorized, "Trailer HTTP mutation refuses API-key impersonation");
        }
        finally { setOwner(true); setPlaying(true); setApiKey(false); await app.StopAsync(); }
    }
}
