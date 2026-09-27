using System.Net;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.TvItemLayout.Providers;

public static class ProviderDirectoryChecks
{
    public static async Task<TmdbProviderSource> Run(Action<bool, string> assert)
    {
        using var parsed = JsonDocument.Parse("""{"results":[{"provider_id":8,"provider_name":" Netflix ","display_priorities":{"GB":2}},{"provider_id":38,"provider_name":"BBC iPlayer","display_priorities":{"GB":1}},{"provider_id":999,"provider_name":"Foreign service","display_priorities":{"US":1}}]}""");
        var entries = TmdbProviderSource.ParseDirectory(parsed.RootElement);
        assert(entries.Select(entry => entry.Id).SequenceEqual(new[] { 38, 8 }) && entries[1].Name == "Netflix",
            "Named directory normalizes and sorts public service names while excluding foreign-only providers");
        foreach (var invalid in new[] {
            "{}", "{\"results\":null}", "{\"results\":[{\"provider_id\":0,\"provider_name\":\"Service\"}]}",
            "{\"results\":[{\"provider_id\":1000001,\"provider_name\":\"Service\"}]}",
            "{\"results\":[{\"provider_id\":8,\"provider_name\":\" \"}]}",
            "{\"results\":[{\"provider_id\":8,\"provider_name\":\"Bad\\nname\"}]}",
            "{\"results\":[{\"provider_id\":8,\"provider_name\":\"Service\"},{\"provider_id\":8,\"provider_name\":\"Other\"}]}",
            JsonSerializer.Serialize(new { results = new[] { new { provider_id = 8, provider_name = new string('a', 121) } } }),
            JsonSerializer.Serialize(new { results = Enumerable.Range(1, 2001).Select(id => new { provider_id = id, provider_name = "Service" }) })
        })
        {
            var failed = false;
            try { TmdbProviderSource.ParseDirectory(JsonDocument.Parse(invalid).RootElement); }
            catch (ProviderLookupException) { failed = true; }
            assert(failed, "Named directory rejects malformed, duplicate and unbounded names or identifiers");
        }

        var clock = new ProviderDirectoryClock();
        var handler = new ProviderDirectoryHttpFixture();
        var client = new HttpClient(handler);
        var source = new TmdbProviderSource(InterfaceStub.Create<IHttpClientFactory>((_, _) => client), clock);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        handler.Gate = release.Task;
        var first = source.DirectoryAsync(default);
        var second = source.DirectoryAsync(default);
        await handler.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        assert(handler.Calls == 2, "Concurrent directory requests share one pair of regional upstream lookups");
        release.SetResult();
        var initial = await first;
        assert(ReferenceEquals(initial, await second) && initial.Region == "GB" && initial.Movies.Single().Id == 591 && initial.Shows.Single().Id == 39
            && handler.ValidRequests, "Directory uses native credentials and separate official GB film/TV endpoints");
        clock.Current = clock.Current.AddHours(23);
        assert(ReferenceEquals(initial, await source.DirectoryAsync(default)) && handler.Calls == 2,
            "A complete named directory is reused for 24 hours");
        clock.Current = clock.Current.AddHours(2); handler.Status = HttpStatusCode.ServiceUnavailable;
        assert(ReferenceEquals(initial, await source.DirectoryAsync(default)) && handler.Calls == 4,
            "Transient upstream failures retain the last complete directory rather than erasing selections");
        await source.DirectoryAsync(default);
        assert(handler.Calls == 4, "Directory failure cooldown prevents repeated upstream requests");
        clock.Current = clock.Current.AddMinutes(6); handler.Status = HttpStatusCode.OK; handler.InvalidShows = true;
        assert(ReferenceEquals(initial, await source.DirectoryAsync(default)), "An invalid TV list cannot partially replace a valid film/TV directory");
        clock.Current = clock.Current.AddMinutes(6); handler.InvalidShows = false;
        assert(!ReferenceEquals(initial, await source.DirectoryAsync(default)), "A recovered source replaces the stale directory with one complete fresh result");

        var brokenHandler = new ProviderDirectoryHttpFixture { NetworkFailure = true };
        using var brokenClient = new HttpClient(brokenHandler);
        var broken = new TmdbProviderSource(InterfaceStub.Create<IHttpClientFactory>((_, _) => brokenClient), clock);
        var safeFailure = false;
        try { await broken.DirectoryAsync(default); }
        catch (ProviderLookupException error) { safeFailure = !error.Message.Contains("fixture-configured") && !error.Message.Contains("https://"); }
        assert(safeFailure, "Directory network errors never expose request URLs or server credentials");
        var failedCalls = brokenHandler.Calls;
        try { await broken.DirectoryAsync(default); } catch (ProviderLookupException) { }
        assert(brokenHandler.Calls == failedCalls, "Cold directory failures also respect the retry cooldown");

        var cancelledHandler = new ProviderDirectoryHttpFixture { Gate = new TaskCompletionSource().Task };
        using var cancelledClient = new HttpClient(cancelledHandler);
        var cancelled = new TmdbProviderSource(InterfaceStub.Create<IHttpClientFactory>((_, _) => cancelledClient), clock);
        using var cancellation = new CancellationTokenSource();
        var pending = cancelled.DirectoryAsync(cancellation.Token);
        await cancelledHandler.Started.Task.WaitAsync(TimeSpan.FromSeconds(5)); cancellation.Cancel();
        var cancelledCorrectly = false;
        try { await pending; } catch (OperationCanceledException) { cancelledCorrectly = true; }
        cancelledHandler.Gate = Task.CompletedTask;
        assert(cancelledCorrectly && (await cancelled.DirectoryAsync(default)).Movies.Length == 1,
            "Cancelled directory requests release their lock and permit a subsequent successful read");
        // Keep this public-metadata cache available for the authenticated controller checks.
        return source;
    }
}

public sealed class ProviderDirectoryClock : TimeProvider
{
    public DateTimeOffset Current { get; set; } = DateTimeOffset.Parse("2026-09-27T12:00:00Z");
    public override DateTimeOffset GetUtcNow() => Current;
}

public sealed class ProviderDirectoryHttpFixture : HttpMessageHandler
{
    private int calls;
    public int Calls => Volatile.Read(ref calls);
    public bool ValidRequests { get; private set; } = true;
    public bool InvalidShows { get; set; }
    public bool NetworkFailure { get; set; }
    public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
    public Task Gate { get; set; } = Task.CompletedTask;
    public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Interlocked.Increment(ref calls) == 2) Started.TrySetResult();
        var uri = request.RequestUri!;
        var movie = uri.AbsolutePath == "/3/watch/providers/movie";
        ValidRequests &= (movie || uri.AbsolutePath == "/3/watch/providers/tv")
            && uri.Query == "?watch_region=GB&language=en-GB&api_key=fixture-configured";
        await Gate.WaitAsync(cancellationToken);
        if (NetworkFailure) throw new HttpRequestException("https://fixture.invalid/?api_key=fixture-configured");
        var json = !movie && InvalidShows ? "{}" : JsonSerializer.Serialize(new {
            results = new[] { new { provider_id = movie ? 591 : 39, provider_name = movie ? "Film service" : "TV service", display_priorities = new { GB = 1 } } }
        });
        return new HttpResponseMessage(Status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    }
}
