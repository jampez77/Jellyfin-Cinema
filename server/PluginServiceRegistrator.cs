// Service registration adapted from InPlayerEpisodePreview-TV (MIT); see LICENSE.InPlayerEpisodePreview.md.
using Jellyfin.Plugin.TvItemLayout.Integration;
using Jellyfin.Plugin.TvItemLayout.Providers;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.TvItemLayout;

public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<StartupService>();
        serviceCollection.AddHttpClient("JellyfinCinemaProviders", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(15);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("ScreenHarbour/1.0");
        }).RemoveAllLoggers(); // The TMDB query string contains its configured API key.
        serviceCollection.AddSingleton<TmdbProviderSource>();
        serviceCollection.AddSingleton<ProviderAvailabilityService>();
        serviceCollection.AddSingleton<IProviderAvailability>(services => services.GetRequiredService<ProviderAvailabilityService>());
        serviceCollection.AddHostedService(services => services.GetRequiredService<ProviderAvailabilityService>());
    }
}
