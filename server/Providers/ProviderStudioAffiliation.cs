using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;

namespace Jellyfin.Plugin.TvItemLayout.Providers;

/// <summary>Library studio affiliations supplement, but do not rewrite, streaming availability.</summary>
public static class ProviderStudioAffiliation
{
    private const int DisneyPlusProviderId = 337;
    // Disney's studio/television brands: https://www.disneystudios.com/ and
    // https://thewaltdisneycompany.com/about/. Historical production names remain
    // in library metadata. Match whole names, never title text or a bare ABC/Fox network.
    private static readonly HashSet<string> DisneyStudios = new[]
    {
        "Walt Disney Pictures", "Walt Disney Productions", "Walt Disney Animation Studios",
        "Walt Disney Feature Animation", "DisneyToon Studios", "Disneynature",
        "Pixar", "Pixar Animation Studios",
        "Marvel Studios", "Marvel Television", "Marvel Animation", "Marvel Studios Animation", "Marvel Studios Television",
        "Lucasfilm", "Lucasfilm Ltd", "Lucasfilm Ltd LLC", "Lucasfilm Animation",
        "20th Century Studios", "Twentieth Century Studios", "20th Century Fox", "Twentieth Century Fox",
        "20th Century Fox Film Corporation", "Twentieth Century Fox Film Corporation",
        "20th Century Animation", "20th Century Fox Animation", "Twentieth Century Fox Animation",
        "Searchlight Pictures", "Fox Searchlight Pictures", "Blue Sky Studios", "Fox 2000 Pictures",
        "Touchstone Pictures", "Hollywood Pictures",
        "Disney Television Studios", "Walt Disney Television", "Disney Television Animation", "Walt Disney Television Animation",
        "Disney Branded Television", "ABC Studios", "ABC Signature", "ABC Signature Studios", "Touchstone Television",
        "20th Television", "Twentieth Television", "20th Television Animation",
        "20th Century Fox Television", "Twentieth Century Fox Television", "Fox Television Studios", "Fox 21 Television Studios",
        "FX Productions", "Searchlight Television"
    }.Select(Normalize).ToHashSet(StringComparer.Ordinal);

    // Punctuation, whitespace and case are presentation differences; added words
    // still change the complete name and cannot turn an unrelated studio into a match.
    private static string Normalize(string value) => new(value.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    public static bool Includes(BaseItem item, ConfiguredProvider provider)
    {
        var ids = item is Series ? provider.ShowProviderIds : provider.MovieProviderIds;
        return ids.Contains(DisneyPlusProviderId) && item.Studios.Any(studio => !string.IsNullOrWhiteSpace(studio) && DisneyStudios.Contains(Normalize(studio)));
    }
}
