// Adapted from InPlayerEpisodePreview-TV (MIT); see LICENSE.InPlayerEpisodePreview.md.
// This transformation only changes the response in memory. It never edits Jellyfin's web files.
using System.Net;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using MediaBrowser.Common.Net;

namespace Jellyfin.Plugin.TvItemLayout.Integration;

public sealed class PatchRequestPayload
{
    [JsonPropertyName("contents")]
    public string? Contents { get; set; }
}

public static class IndexHtmlInjector
{
    private static readonly Regex ExistingScript = new(
        "<script\\b(?=[^>]*\\bdata-tv-item-layout(?:\\s|=|>))[^>]*>[\\s\\S]*?</script\\s*>",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private static readonly Regex ClosingBody = new("</body\\s*>",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    public static string FileTransformer(PatchRequestPayload payload)
    {
        string contents = payload.Contents ?? string.Empty;
        string baseUrl = Plugin.Instance.ConfigurationManager.GetNetworkConfiguration().BaseUrl ?? string.Empty;
        return Inject(contents, baseUrl);
    }

    /// <summary>Idempotently add the versioned client to an HTML response, respecting Jellyfin's base URL.</summary>
    public static string Inject(string contents, string baseUrl)
    {
        string cleaned = ExistingScript.Replace(contents, string.Empty);
        MatchCollection bodies = ClosingBody.Matches(cleaned);
        if (bodies.Count == 0)
        {
            return contents;
        }

        string basePath = baseUrl.Trim('/');
        basePath = basePath.Length == 0 ? string.Empty : "/" + basePath;
        string source = WebUtility.HtmlEncode($"{basePath}/TvItemLayout/ClientScript?v={ClientScriptAsset.CacheVersion}");
        string script = $"<script data-tv-item-layout=\"true\" defer src=\"{source}\"></script>";
        return cleaned.Insert(bodies[^1].Index, script);
    }
}
