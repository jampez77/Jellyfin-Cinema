// FileTransformation registration adapted from InPlayerEpisodePreview-TV (MIT); see LICENSE.InPlayerEpisodePreview.md.
using System.Reflection;
using System.Runtime.Loader;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.TvItemLayout.Integration;

public sealed class StartupService(ILogger<StartupService> logger) : IScheduledTask
{
    public string Name => "Jellyfin Cinema startup";
    public string Key => "Jellyfin.Plugin.TvItemLayout.Startup";
    public string Description => "Register the Jellyfin Cinema client with File Transformation.";
    public string Category => "Startup Services";

    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Assembly? assembly = AssemblyLoadContext.All.SelectMany(context => context.Assemblies)
            .FirstOrDefault(candidate => candidate.GetName().Name == "Jellyfin.Plugin.FileTransformation");
        MethodInfo? register = assembly?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface")
            ?.GetMethod("RegisterTransformation", BindingFlags.Public | BindingFlags.Static);

        if (register is null)
        {
            LogManualSetup();
            return Task.CompletedTask;
        }

        try
        {
            JObject payload = new()
            {
                ["id"] = Plugin.PluginId,
                // File Transformation selects one path pipeline, so share the exact key
                // used by other index.html plugins to keep all callbacks in that pipeline.
                ["fileNamePattern"] = "index.html",
                ["callbackAssembly"] = typeof(StartupService).Assembly.FullName,
                ["callbackClass"] = typeof(IndexHtmlInjector).FullName,
                ["callbackMethod"] = nameof(IndexHtmlInjector.FileTransformer)
            };
            register.Invoke(null, [payload]);
            logger.LogInformation("Jellyfin Cinema registered with File Transformation (client {Version}).", ClientScriptAsset.CacheVersion);
            progress.Report(100);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Jellyfin Cinema could not register with File Transformation.");
            LogManualSetup();
        }

        return Task.CompletedTask;
    }

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        yield return new TaskTriggerInfo
        {
#if JELLYFIN_1010
            Type = TaskTriggerInfo.TriggerStartup
#else
            Type = TaskTriggerInfoType.StartupTrigger
#endif
        };
    }

    private void LogManualSetup() => logger.LogWarning(
        "Jellyfin Cinema needs a compatible File Transformation plugin to load its client automatically. " +
        "No web files were modified. Install File Transformation and restart, or manually load " +
        "<Jellyfin base URL>/TvItemLayout/ClientScript from Jellyfin Web's index.html; see docs/server.md.");
}
