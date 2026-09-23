// Script delivery adapted from InPlayerEpisodePreview-TV (MIT); see LICENSE.InPlayerEpisodePreview.md.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.TvItemLayout.Api;

[ApiController]
[Route("TvItemLayout")]
public sealed class ClientScriptController : ControllerBase
{
    /// <summary>Public static JavaScript only; media and user data use Jellyfin's authenticated APIs.</summary>
    [HttpGet("ClientScript")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public IActionResult GetClientScript([FromQuery] string? v = null)
    {
        Response.Headers.CacheControl = string.Equals(v, ClientScriptAsset.CacheVersion, StringComparison.Ordinal)
            ? "public, max-age=31536000, immutable"
            : "public, no-cache";
        Response.Headers["X-Content-Type-Options"] = "nosniff";

        return new FileContentResult(ClientScriptAsset.Bytes, "application/javascript; charset=utf-8")
        {
            EntityTag = new EntityTagHeaderValue(ClientScriptAsset.ETag)
        };
    }
}
