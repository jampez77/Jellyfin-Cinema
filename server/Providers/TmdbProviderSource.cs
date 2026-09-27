using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.TvItemLayout.Providers;

/// <summary>Subscription availability is supplied by TMDB/JustWatch, not studio or network names.</summary>
public sealed class TmdbProviderSource(IHttpClientFactory clients)
{
    public const string Region = "GB";
    private long rateLimitedUntil;
    public static bool ValidProvider(string id) => id is "netflix" or "prime" or "disney" or "apple" or "now" or "paramount";
    public static bool Includes(string provider, string type, IEnumerable<int> ids)
    {
        int[] subscriptionIds = provider switch
        {
            "netflix" => [8, 175, 1796], "prime" => [9, 2100], "disney" => [337],
            "apple" => [350], "now" => type == "Movie" ? [591] : [39], "paramount" => [531, 2303, 2304], _ => []
        };
        return ids.Any(subscriptionIds.Contains);
    }

    // Reuse Jellyfin's installed TMDB integration. Reflection keeps this plugin compatible
    // with all supported servers without bundling a second TMDB plugin or copying its key.
    public static string? NativeApiKey()
    {
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            var plugin = assembly.GetType("MediaBrowser.Providers.Plugins.Tmdb.Plugin", false);
            try
            {
                var instance = plugin?.GetProperty("Instance", BindingFlags.Static | BindingFlags.Public)?.GetValue(null);
                var configuration = instance?.GetType().GetProperty("Configuration")?.GetValue(instance);
                var configured = configuration?.GetType().GetProperty("TmdbApiKey")?.GetValue(configuration) as string;
                if (!string.IsNullOrWhiteSpace(configured)) return configured.Trim();
                var utils = assembly.GetType("MediaBrowser.Providers.Plugins.Tmdb.TmdbUtils", false);
                var fallback = utils?.GetField("ApiKey", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)?.GetValue(null) as string;
                if (!string.IsNullOrWhiteSpace(fallback)) return fallback.Trim();
            }
            catch (Exception exception) when (exception is TargetInvocationException or MemberAccessException or ArgumentException) { }
        }
        return null;
    }

    public bool Available => NativeApiKey() is not null;
    public async Task<int[]> FetchAsync(string key, CancellationToken cancellationToken)
    {
        if (!Regex.IsMatch(key, "^(movie|tv):[1-9][0-9]{0,9}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("Invalid provider lookup key.", nameof(key));
        var apiKey = NativeApiKey() ?? throw new ProviderLookupException("TMDB is unavailable.");
        while (true)
        {
            var remaining = new DateTimeOffset(Interlocked.Read(ref rateLimitedUntil), TimeSpan.Zero) - DateTimeOffset.UtcNow;
            if (remaining <= TimeSpan.Zero) break;
            await Task.Delay(remaining, cancellationToken);
            // Another in-flight response can extend the cooldown while this worker waits.
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        var requestToken = timeout.Token;
        var pieces = key.Split(':');
        // Never log this URI, exception text from HttpClient, or any credential.
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://api.themoviedb.org/3/{pieces[0]}/{pieces[1]}/watch/providers?api_key={Uri.EscapeDataString(apiKey)}");
        using var response = await clients.CreateClient("JellyfinCinemaProviders").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, requestToken);
        if (!response.IsSuccessStatusCode)
        {
            // Deleted TMDB IDs are an authoritative negative, but transient failures must not erase cached availability.
            if (response.StatusCode == HttpStatusCode.NotFound) return [];
            var delay = response.Headers.RetryAfter?.Delta ?? (response.Headers.RetryAfter?.Date - DateTimeOffset.UtcNow);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                var pause = delay is { } retry && retry > TimeSpan.FromSeconds(30) ? retry : TimeSpan.FromSeconds(30);
                if (pause > TimeSpan.FromHours(6)) pause = TimeSpan.FromHours(6);
                // A server-wide rate limit must also pause the other workers, not just this title.
                ExtendCooldown((DateTimeOffset.UtcNow + pause).Ticks);
            }
            throw new ProviderLookupException("TMDB availability request failed.", delay);
        }
        await using var stream = await response.Content.ReadAsStreamAsync(requestToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: requestToken);
        return Parse(document.RootElement);
    }

    private void ExtendCooldown(long deadline)
    {
        var observed = Interlocked.Read(ref rateLimitedUntil);
        while (deadline > observed)
        {
            var current = Interlocked.CompareExchange(ref rateLimitedUntil, deadline, observed);
            if (current == observed) return;
            observed = current;
        }
    }

    public static int[] Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Object)
            throw new ProviderLookupException("TMDB returned invalid availability data.");
        if (!results.TryGetProperty(Region, out var country)) return [];
        if (country.ValueKind != JsonValueKind.Object) throw new ProviderLookupException("TMDB returned invalid regional availability.");
        if (!country.TryGetProperty("flatrate", out var rates)) return [];
        if (rates.ValueKind != JsonValueKind.Array) throw new ProviderLookupException("TMDB returned invalid subscription availability.");
        var ids = new HashSet<int>();
        foreach (var rate in rates.EnumerateArray())
        {
            if (rate.ValueKind != JsonValueKind.Object || !rate.TryGetProperty("provider_id", out var id)
                || id.ValueKind != JsonValueKind.Number || !id.TryGetInt32(out var number) || number <= 0)
                throw new ProviderLookupException("TMDB returned invalid subscription provider.");
            ids.Add(number);
        }
        return ids.Order().ToArray();
    }
}

public sealed class ProviderLookupException(string message, TimeSpan? retryAfter = null) : Exception(message)
{
    public TimeSpan? RetryAfter { get; } = retryAfter;
}
