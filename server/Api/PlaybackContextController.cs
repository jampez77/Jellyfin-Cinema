// Playback identity/queue resolution adapted from InPlayerEpisodePreview-TV (MIT).
// See LICENSE.InPlayerEpisodePreview.md. Never selects another user's/device's session.
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TvItemLayout.Api;

[ApiController]
[Route("TvItemLayout")]
[Authorize]
public sealed class PlaybackContextController(
    IAuthorizationContext authorizationContext,
    ISessionManager sessionManager) : ControllerBase
{
    [HttpGet("PlaybackContext")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> GetPlaybackContext()
    {
        var authorization = await authorizationContext.GetAuthorizationInfo(HttpContext);
        if (string.IsNullOrEmpty(authorization.Token) || string.IsNullOrEmpty(authorization.DeviceId)
            || authorization.UserId == Guid.Empty || authorization.IsApiKey)
            return Unauthorized();

        var session = await sessionManager.GetSessionByAuthenticationToken(authorization.Token,
            authorization.DeviceId, HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty);
        if (session is null || session.UserId != authorization.UserId
            || !string.Equals(session.DeviceId, authorization.DeviceId, StringComparison.Ordinal))
            return Unauthorized();

        var item = session.NowPlayingItem;
        if (item is null || item.Id == Guid.Empty) return new JsonResult(null);
        return Ok(new
        {
            PlayingItemId = item.Id,
            PlayingItemType = item.Type,
            PlayingItemExtraType = item.ExtraType,
            session.PlaylistItemId,
            Queue = session.NowPlayingQueue.Select(entry => new { entry.Id, entry.PlaylistItemId }).ToArray()
        });
    }
}
