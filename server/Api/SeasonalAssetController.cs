using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.TvItemLayout.Api;

[ApiController]
[Route("TvItemLayout/SeasonalAsset")]
public sealed class SeasonalAssetController : ControllerBase
{
    private const string Prefix = "Jellyfin.Plugin.TvItemLayout.SeasonalAssets.";
    private static readonly HashSet<string> Names = typeof(Plugin).Assembly.GetManifestResourceNames()
        .Where(name => name.StartsWith(Prefix, StringComparison.Ordinal) && name.EndsWith(".webp", StringComparison.Ordinal))
        .Select(name => name[Prefix.Length..]).ToHashSet(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, Lazy<(byte[] Bytes, string ETag)>> Cache = new(StringComparer.Ordinal);

    /// <summary>Bundled decorative artwork only; never reads media, user files or remote URLs.</summary>
    [HttpGet("{name}")]
    [AllowAnonymous]
    public IActionResult GetSeasonalAsset(string name, [FromQuery] string? v = null)
    {
        if (!Names.Contains(name)) return NotFound();
        var asset = Cache.GetOrAdd(name, key => new(() => {
            using var input = typeof(Plugin).Assembly.GetManifestResourceStream(Prefix + key)!;
            using var buffer = new MemoryStream(); input.CopyTo(buffer);
            var bytes = buffer.ToArray();
            return (bytes, $"\"{Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()}\"");
        })).Value;
        Response.Headers.CacheControl = v == ClientScriptAsset.CacheVersion ? "public, max-age=31536000, immutable" : "public, no-cache";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return new FileContentResult(asset.Bytes, "image/webp") { EntityTag = new EntityTagHeaderValue(asset.ETag) };
    }
}
