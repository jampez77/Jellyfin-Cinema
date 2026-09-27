using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.TvItemLayout.Providers;
#if JELLYFIN_1010
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
#endif
using MediaBrowser.Common.Configuration;
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
[Route("TvItemLayout/ProviderHomes")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ProviderHomesController(
    IAuthorizationContext authorizationContext,
    ISessionManager sessionManager,
    IUserManager userManager,
    IDeviceManager deviceManager,
    INetworkManager networkManager,
    IApplicationPaths paths) : ControllerBase
{
    public const int MaximumBytes = 128 * 1024;
    // Shared by every controller instance, including competing first-use saves.
    private static readonly SemaphoreSlim StoreLock = new(1, 1);

    private async Task<Guid?> CurrentUser()
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
        return caller.Id;
    }

    private static string StorePath(IApplicationPaths paths, Guid user) => Path.Combine(paths.DataPath, "jellyfin-cinema", "provider-homes", user.ToString("N") + ".json");

    private static async Task<ProviderHomesResponse> Read(string path, CancellationToken cancellationToken)
    {
        // File.Exists also returns false for access errors. Report only actual
        // missing files as first use, so a storage failure cannot erase the
        // client's last confirmed settings by masquerading as an empty store.
        FileStream stream;
        try { stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan); }
        catch (FileNotFoundException) { return new(null, null); }
        catch (DirectoryNotFoundException) { return new(null, null); }
        await using var file = stream;
        if (file.Length > MaximumBytes + 1024) throw new InvalidDataException("Saved Provider Homes exceed the size limit.");
        using var reader = new StreamReader(file);
        var data = await reader.ReadToEndAsync(cancellationToken);
        var saved = JsonSerializer.Deserialize<ProviderHomesResponse>(data);
        if (saved?.Revision is null || !Guid.TryParseExact(saved.Revision, "N", out _)
            || saved.Settings is not JsonElement settings || !ProviderHomesSchema.ValidSettings(settings))
            throw new InvalidDataException("Saved Provider Homes are invalid.");
        return saved;
    }

    internal static async Task<ProviderHomesResponse> ReadForUser(IApplicationPaths paths, Guid user, CancellationToken cancellationToken)
    {
        await StoreLock.WaitAsync(cancellationToken);
        try { return await Read(StorePath(paths, user), cancellationToken); }
        finally { StoreLock.Release(); }
    }

    [HttpGet]
    public async Task<IActionResult> GetProviderHomes(CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        await StoreLock.WaitAsync(cancellationToken);
        try { return Ok(await Read(StorePath(paths, user.Value), cancellationToken)); }
        finally { StoreLock.Release(); }
    }

    [HttpPut]
    [RequestSizeLimit(MaximumBytes)]
    public async Task<IActionResult> PutProviderHomes([FromBody] ProviderHomesRequest request, CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if ((request.Revision is not null && !Guid.TryParseExact(request.Revision, "N", out _)) || !ProviderHomesSchema.ValidSettings(request.Settings))
            return BadRequest("Invalid Provider Home settings.");
        if (Encoding.UTF8.GetByteCount(request.Settings.GetRawText()) > MaximumBytes - 1024)
            return StatusCode(413, "Provider Home settings are too large.");
        await StoreLock.WaitAsync(cancellationToken);
        try
        {
            var path = StorePath(paths, user.Value);
            var current = await Read(path, cancellationToken);
            if (!string.Equals(request.Revision, current.Revision, StringComparison.Ordinal))
                return Conflict("Provider Homes changed on another device. Reload them before saving.");
            if (current.Settings is JsonElement existing && existing.GetProperty("version").GetInt32() == 2
                && request.Settings.GetProperty("version").GetInt32() == 1)
                return Conflict("These services were configured with a newer ScreenHarbour client. Reload the updated client before saving.");
            var saved = new ProviderHomesResponse(Guid.NewGuid().ToString("N"), request.Settings.Clone());
            var serialized = JsonSerializer.Serialize(saved);
            if (Encoding.UTF8.GetByteCount(serialized) > MaximumBytes)
                return StatusCode(413, "Provider Home settings are too large.");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await System.IO.File.WriteAllTextAsync(temporary, serialized, cancellationToken);
                // Publish only complete files; a failed write never discards the previous revision.
                System.IO.File.Move(temporary, path, true);
            }
            finally { if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary); }
            return Ok(saved);
        }
        finally { StoreLock.Release(); }
    }


}

public sealed record ProviderHomesRequest(
    [property: JsonPropertyName("Revision")] string? Revision,
    [property: JsonPropertyName("Settings")] JsonElement Settings);
public sealed record ProviderHomesResponse(
    // Jellyfin globally omits null JSON properties. Missing settings must keep
    // both fields so clients can distinguish first use from a malformed reply.
    [property: JsonPropertyName("Revision"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Revision,
    [property: JsonPropertyName("Settings"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] JsonElement? Settings);
