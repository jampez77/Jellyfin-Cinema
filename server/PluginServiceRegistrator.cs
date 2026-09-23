// Service registration adapted from InPlayerEpisodePreview-TV (MIT); see LICENSE.InPlayerEpisodePreview.md.
using Jellyfin.Plugin.TvItemLayout.Integration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.TvItemLayout;

public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<StartupService>();
    }
}
