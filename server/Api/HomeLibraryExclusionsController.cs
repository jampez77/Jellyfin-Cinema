using System.Text.Json.Serialization;
#if JELLYFIN_1010
using Jellyfin.Data.Enums;
using User = Jellyfin.Data.Entities.User;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using User = Jellyfin.Database.Implementations.Entities.User;
#endif
using MediaBrowser.Common.Extensions;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TvItemLayout.Api;

[ApiController]
[Route("TvItemLayout/HomeLibraryExclusions")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class HomeLibraryExclusionsController(IAuthorizationContext authorizationContext,
    ISessionManager sessionManager, IUserManager userManager, IDeviceManager deviceManager,
    INetworkManager networkManager, IUserViewManager userViewManager) : ControllerBase
{
    private async Task<User?> CurrentUser()
    {
        var authorization = await authorizationContext.GetAuthorizationInfo(HttpContext);
        if (string.IsNullOrWhiteSpace(authorization.Token) || string.IsNullOrWhiteSpace(authorization.DeviceId)
            || authorization.UserId == Guid.Empty || authorization.IsApiKey) return null;
        var remoteIp = HttpContext.GetNormalizedRemoteIP();
        var session = await sessionManager.GetSessionByAuthenticationToken(authorization.Token,
            authorization.DeviceId, remoteIp.ToString());
        if (session is null || session.UserId != authorization.UserId
            || !string.Equals(session.DeviceId, authorization.DeviceId, StringComparison.Ordinal)) return null;
        var caller = userManager.GetUserById(authorization.UserId);
        if (caller is null || caller.HasPermission(PermissionKind.IsDisabled) || !caller.IsParentalScheduleAllowed()
            || !deviceManager.CanAccessDevice(caller, authorization.DeviceId)
            || (!networkManager.IsInLocalNetwork(remoteIp) && !caller.HasPermission(PermissionKind.EnableRemoteAccess))) return null;
        return caller;
    }

    [HttpGet]
    public async Task<IActionResult> GetHomeLibraryExclusions()
    {
        var caller = await CurrentUser();
        if (caller is null) return Unauthorized();
        var preferences = caller.GetPreferenceValues<Guid>(PreferenceKind.LatestItemExcludes)
            .Concat(caller.GetPreferenceValues<Guid>(PreferenceKind.MyMediaExcludes))
            .Where(id => id != Guid.Empty).ToHashSet();
        var exclusions = new HashSet<Guid>(preferences);
        if (preferences.Count > 0)
        {
            // Native Home settings can identify a per-user view rather than the
            // physical library used by Home Screen Sections. Ask Jellyfin for
            // this caller's views, including the ones their settings hide, and
            // follow its exact backing-folder ID. Names and collection types
            // cannot distinguish multiple libraries or profiles reliably.
            var views = userViewManager.GetUserViews(new UserViewQuery { User = caller, IncludeHidden = true });
            foreach (var view in views)
            {
                if (preferences.Contains(view.Id) && view is UserView { DisplayParentId: var parentId } && parentId != Guid.Empty)
                    exclusions.Add(parentId);
            }
        }
        return Ok(new HomeLibraryExclusionsResponse(caller.Id.ToString("N"),
            exclusions.Select(id => id.ToString("N")).Order(StringComparer.Ordinal).ToArray()));
    }
}

public sealed record HomeLibraryExclusionsResponse(
    [property: JsonPropertyName("UserId")] string UserId,
    [property: JsonPropertyName("ExcludedLibraryIds")] string[] ExcludedLibraryIds);
