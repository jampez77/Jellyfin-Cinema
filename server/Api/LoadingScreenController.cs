using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
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
[Route("TvItemLayout/LoadingScreen")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LoadingScreenController(IAuthorizationContext authorizationContext,
    ISessionManager sessionManager, IUserManager userManager, IDeviceManager deviceManager,
    INetworkManager networkManager, IApplicationPaths paths) : ControllerBase
{
    public const int MaximumBytes = 8 * 1024;
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

    private string StorePath(Guid user) => Path.Combine(paths.DataPath, "jellyfin-cinema", "loading-screen", user.ToString("N") + ".json");

    private static bool Text(JsonElement value, string key, int maximum) => value.TryGetProperty(key, out var field)
        && field.ValueKind == JsonValueKind.String && field.GetString() is string text
        && text.Length <= maximum && !text.Any(char.IsControl);

    private static bool ValidSettings(JsonElement value) => value.ValueKind == JsonValueKind.Object
        && value.EnumerateObject().All(property => property.Name is "version" or "animation" or "brandText" or "message")
        && value.EnumerateObject().Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() == value.EnumerateObject().Count()
        && value.TryGetProperty("version", out var version) && version.ValueKind == JsonValueKind.Number && version.TryGetInt32(out var number) && number == 1
        && value.TryGetProperty("animation", out var animation) && animation.ValueKind == JsonValueKind.String
        && animation.GetString() is "projector" or "clapperboard" or "film-reel" or "countdown" or "spotlights" or "jellyfin"
        && Text(value, "brandText", 60) && Text(value, "message", 120);

    private static async Task<LoadingScreenResponse> Read(string path, CancellationToken cancellationToken)
    {
        // Only genuinely absent files mean first use. Access errors and damaged
        // stores must not replace the client's confirmed settings with defaults.
        FileStream stream;
        try { stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan); }
        catch (FileNotFoundException) { return new(null, null); }
        catch (DirectoryNotFoundException) { return new(null, null); }
        await using var file = stream;
        if (file.Length > MaximumBytes) throw new InvalidDataException("Saved loading screen settings exceed the size limit.");
        using var reader = new StreamReader(file);
        var saved = JsonSerializer.Deserialize<LoadingScreenResponse>(await reader.ReadToEndAsync(cancellationToken));
        if (saved?.Revision is null || !Guid.TryParseExact(saved.Revision, "N", out _)
            || saved.Settings is not JsonElement settings || !ValidSettings(settings))
            throw new InvalidDataException("Saved loading screen settings are invalid.");
        return saved;
    }

    [HttpGet]
    public async Task<IActionResult> GetLoadingScreen(CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        await StoreLock.WaitAsync(cancellationToken);
        try { return Ok(await Read(StorePath(user.Value), cancellationToken)); }
        finally { StoreLock.Release(); }
    }

    [HttpPut]
    [RequestSizeLimit(MaximumBytes)]
    public async Task<IActionResult> PutLoadingScreen([FromBody] LoadingScreenRequest request, CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if (request is null || request.Revision is not null && !Guid.TryParseExact(request.Revision, "N", out _)
            || !ValidSettings(request.Settings)) return BadRequest("Invalid loading screen settings.");
        if (Encoding.UTF8.GetByteCount(request.Settings.GetRawText()) > MaximumBytes - 1024)
            return StatusCode(413, "Loading screen settings are too large.");
        await StoreLock.WaitAsync(cancellationToken);
        try
        {
            var path = StorePath(user.Value);
            var current = await Read(path, cancellationToken);
            if (!string.Equals(request.Revision, current.Revision, StringComparison.Ordinal))
                return Conflict("Loading screen settings changed on another device. Reload them before saving.");
            var saved = new LoadingScreenResponse(Guid.NewGuid().ToString("N"), request.Settings.Clone());
            var serialized = JsonSerializer.Serialize(saved);
            if (Encoding.UTF8.GetByteCount(serialized) > MaximumBytes)
                return StatusCode(413, "Loading screen settings are too large.");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await System.IO.File.WriteAllTextAsync(temporary, serialized, cancellationToken);
                System.IO.File.Move(temporary, path, true);
            }
            finally { if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary); }
            return Ok(saved);
        }
        finally { StoreLock.Release(); }
    }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LoadingScreenRequest(
    [property: JsonPropertyName("Revision")] string? Revision,
    [property: JsonPropertyName("Settings")] JsonElement Settings);

public sealed record LoadingScreenResponse(
    [property: JsonPropertyName("Revision"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Revision,
    [property: JsonPropertyName("Settings"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] JsonElement? Settings);
