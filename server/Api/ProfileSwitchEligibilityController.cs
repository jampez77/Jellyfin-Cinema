using System.Text.Json.Serialization;
#if JELLYFIN_1010
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
#endif
using MediaBrowser.Common.Extensions;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.TvItemLayout.Api;

[ApiController]
[Route("TvItemLayout")]
[Authorize]
public sealed class ProfileSwitchEligibilityController(
    IAuthorizationContext authorizationContext,
    ISessionManager sessionManager,
    IUserManager userManager,
    IDeviceManager deviceManager,
    INetworkManager networkManager) : ControllerBase
{
    // A missing or different provider cannot be assumed to support blank login.
    private const string DefaultProvider = "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider";

    [HttpGet("ProfileSwitchEligibility")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> GetProfileSwitchEligibility()
    {
        var authorization = await authorizationContext.GetAuthorizationInfo(HttpContext);
        if (string.IsNullOrWhiteSpace(authorization.Token) || string.IsNullOrWhiteSpace(authorization.DeviceId)
            || authorization.UserId == Guid.Empty || authorization.IsApiKey)
            return Unauthorized();

        var remoteIp = HttpContext.GetNormalizedRemoteIP();
        var session = await sessionManager.GetSessionByAuthenticationToken(authorization.Token,
            authorization.DeviceId, remoteIp.ToString());
        if (session is null || session.UserId != authorization.UserId
            || !string.Equals(session.DeviceId, authorization.DeviceId, StringComparison.Ordinal))
            return Unauthorized();

        var caller = userManager.GetUserById(authorization.UserId);
        if (caller is null || caller.HasPermission(PermissionKind.IsDisabled)
            || !caller.IsParentalScheduleAllowed()) return Unauthorized();

        var isLocal = networkManager.IsInLocalNetwork(remoteIp);
        if (!deviceManager.CanAccessDevice(caller, authorization.DeviceId)
            || (!isLocal && !caller.HasPermission(PermissionKind.EnableRemoteAccess))) return Unauthorized();
#if JELLYFIN_12
        var users = userManager.GetUsers();
#else
        var users = userManager.Users;
#endif
        // Match the public login list's visibility, device and network filters.
        // This is only a UI hint: the later native login still enforces all policy.
        var profileIds = users.Where(user => user.Id != Guid.Empty
                && !user.HasPermission(PermissionKind.IsHidden)
                && !user.HasPermission(PermissionKind.IsDisabled)
                && !user.HasPermission(PermissionKind.IsAdministrator)
                && user.IsParentalScheduleAllowed()
                && string.Equals(user.AuthenticationProviderId, DefaultProvider, StringComparison.OrdinalIgnoreCase)
                && string.IsNullOrEmpty(user.Password)
                && deviceManager.CanAccessDevice(user, authorization.DeviceId)
                && (isLocal || user.HasPermission(PermissionKind.EnableRemoteAccess)))
            .Select(user => user.Id.ToString("N"))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        // Never serialize a User entity or any password, provider, policy or token.
        return Ok(new ProfileSwitchEligibilityResponse(profileIds));
    }
}

public sealed record ProfileSwitchEligibilityResponse(
    [property: JsonPropertyName("ProfileIds")] string[] ProfileIds);
