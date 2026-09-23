using System.Security.Cryptography;

namespace Jellyfin.Plugin.TvItemLayout;

/// <summary>One immutable copy of the embedded client, with a content-derived cache identity.</summary>
public static class ClientScriptAsset
{
    private static readonly Lazy<byte[]> Script = new(ReadScript);
    private static readonly Lazy<string> Digest = new(() => Convert.ToHexString(SHA256.HashData(Bytes)).ToLowerInvariant());

    public static byte[] Bytes => Script.Value;
    public static string ETag => $"\"{Digest.Value}\"";
    public static string CacheVersion => $"{typeof(Plugin).Assembly.GetName().Version}-{Digest.Value[..12]}";

    private static byte[] ReadScript()
    {
        using Stream stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.TvItemLayout.ClientScript.js")
            ?? throw new InvalidOperationException("TV Item Layout's client script was not embedded. Rebuild the plugin after npm run build.");
        using MemoryStream buffer = new();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
