using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Jellyfin.Extensions.Json;
using Jellyfin.Plugin.TvItemLayout.Api;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

public static class ProviderItemsHttpChecks
{
    public static async Task Run(Action<bool, string> assert, Action<IServiceCollection> registerServices,
        Action<bool> setApiKey, JsonElement draft, Guid expectedItem)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        registerServices(builder.Services);
        builder.Services.AddAuthorization();
        builder.Services.AddControllers().AddApplicationPart(typeof(ProviderItemsController).Assembly).AddJsonOptions(options =>
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
        await using var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "http-provider-check")], "fixture"));
            await next();
        });
        app.UseAuthorization(); app.MapControllers(); await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        Task<HttpResponseMessage> Preview(string body, string query = "mediaType=Movie&startIndex=0&limit=1&sort=title")
            => client.PostAsync("/TvItemLayout/Providers/Preview?" + query, new StringContent(body, Encoding.UTF8, "application/json"));
        try
        {
            var settingsBefore = await client.GetStringAsync("/TvItemLayout/ProviderHomes");
            using var response = await Preview(draft.GetRawText());
            var data = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            assert(response.StatusCode == HttpStatusCode.OK && response.Headers.CacheControl?.NoStore == true
                && data.TryGetProperty("Items", out var items) && items.GetArrayLength() == 1
                && items[0].GetProperty("Id").GetString()!.Replace("-", "") == expectedItem.ToString("N")
                && data.GetProperty("Region").GetString() == "GB" && data.GetProperty("TotalRecordCount").GetInt32() == 1,
                "Actual authenticated HTTP draft preview binds its mapping and query and retains native DTO/response casing");
            assert(await client.GetStringAsync("/TvItemLayout/ProviderHomes") == settingsBefore,
                "Actual draft preview cannot persist or revise the account's saved services");
            using var unsupported = await Preview(draft.GetRawText(), "mediaType=Episode");
            using var duplicate = await Preview(draft.GetRawText().Replace("\"name\":", "\"name\":\"duplicate\",\"name\":"));
            using var oversize = await Preview(new string(' ', ProviderHomesController.MaximumBytes + 1) + draft.GetRawText());
            assert(unsupported.StatusCode == HttpStatusCode.BadRequest && duplicate.StatusCode == HttpStatusCode.BadRequest
                && oversize.StatusCode == HttpStatusCode.RequestEntityTooLarge,
                "HTTP preview rejects unsupported media, duplicate schema fields and oversized requests");
            setApiKey(true);
            using var deniedPreview = await Preview(draft.GetRawText());
            using var deniedCatalogue = await client.GetAsync("/TvItemLayout/Providers/netflix/Items");
            assert(deniedPreview.StatusCode == HttpStatusCode.Unauthorized && deniedCatalogue.StatusCode == HttpStatusCode.Unauthorized,
                "Actual preview and catalogue HTTP routes both reject API-key impersonation");
        }
        finally { setApiKey(false); await app.StopAsync(); }
    }
}
