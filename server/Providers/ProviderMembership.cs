namespace Jellyfin.Plugin.TvItemLayout.Providers;

/// <summary>Keep offer categories distinct; a free tier must never be mistaken for a paid subscription.</summary>
public sealed record ProviderMembership(int[] Flatrate, int[] Free, int[] Ads)
{
    public static ProviderMembership Empty => new([], [], []);
    private static bool ValidIds(int[]? ids) => ids is { Length: <= 1000 } && ids.All(id => id > 0) && ids.Distinct().Count() == ids.Length;
    [System.Text.Json.Serialization.JsonIgnore]
    public bool Valid => ValidIds(Flatrate) && ValidIds(Free) && ValidIds(Ads);
    public bool Includes(IEnumerable<int> providerIds, IEnumerable<string> offerTypes)
    {
        var accepted = providerIds.ToHashSet();
        return offerTypes.Any(offer => (offer switch { "flatrate" => Flatrate, "free" => Free, "ads" => Ads, _ => [] }).Any(accepted.Contains));
    }
}
