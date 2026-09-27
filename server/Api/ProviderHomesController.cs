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

    private string StorePath(Guid user) => Path.Combine(paths.DataPath, "jellyfin-cinema", "provider-homes", user.ToString("N") + ".json");

    private static async Task<ProviderHomesResponse> Read(string path, CancellationToken cancellationToken)
    {
        if (!System.IO.File.Exists(path)) return new(null, null);
        if (new FileInfo(path).Length > MaximumBytes + 1024) throw new InvalidDataException("Saved Provider Homes exceed the size limit.");
        var data = await System.IO.File.ReadAllTextAsync(path, cancellationToken);
        var saved = JsonSerializer.Deserialize<ProviderHomesResponse>(data);
        if (saved?.Revision is null || !Guid.TryParseExact(saved.Revision, "N", out _)
            || saved.Settings is not JsonElement settings || !ValidSettings(settings))
            throw new InvalidDataException("Saved Provider Homes are invalid.");
        return saved;
    }

    [HttpGet]
    public async Task<IActionResult> GetProviderHomes(CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        await StoreLock.WaitAsync(cancellationToken);
        try { return Ok(await Read(StorePath(user.Value), cancellationToken)); }
        finally { StoreLock.Release(); }
    }

    [HttpPut]
    [RequestSizeLimit(MaximumBytes)]
    public async Task<IActionResult> PutProviderHomes([FromBody] ProviderHomesRequest request, CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if ((request.Revision is not null && !Guid.TryParseExact(request.Revision, "N", out _)) || !ValidSettings(request.Settings))
            return BadRequest("Invalid Provider Home settings.");
        if (Encoding.UTF8.GetByteCount(request.Settings.GetRawText()) > MaximumBytes - 1024)
            return StatusCode(413, "Provider Home settings are too large.");
        await StoreLock.WaitAsync(cancellationToken);
        try
        {
            var path = StorePath(user.Value);
            var current = await Read(path, cancellationToken);
            if (!string.Equals(request.Revision, current.Revision, StringComparison.Ordinal))
                return Conflict("Provider Homes changed on another device. Reload them before saving.");
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

    private static bool Properties(JsonElement value, params string[] allowed) => value.ValueKind == JsonValueKind.Object
        && value.EnumerateObject().All(property => allowed.Contains(property.Name, StringComparer.Ordinal))
        && value.EnumerateObject().Select(property => property.Name).Distinct().Count() == value.EnumerateObject().Count();
    private static bool Text(JsonElement value, string key, int maximum, bool empty = true) => value.TryGetProperty(key, out var text)
        && text.ValueKind == JsonValueKind.String && text.GetString()!.Length <= maximum && (empty || text.GetString()!.Length > 0);
    private static bool Boolean(JsonElement value, string key) => value.TryGetProperty(key, out var boolean)
        && boolean.ValueKind is JsonValueKind.True or JsonValueKind.False;
    private static bool Choice(JsonElement value, string key, params string[] choices) => value.TryGetProperty(key, out var choice)
        && choice.ValueKind == JsonValueKind.String && choices.Contains(choice.GetString(), StringComparer.Ordinal);
    private static bool ValidSettings(JsonElement settings)
    {
        if (!Properties(settings, "version", "enabled", "title", "placement", "providers")
            || !settings.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var number) || number != 1 || !Boolean(settings, "enabled")
            || !Text(settings, "title", 80) || !Text(settings, "placement", 240, false)
            || !settings.TryGetProperty("providers", out var providers) || providers.ValueKind != JsonValueKind.Array
            || providers.GetArrayLength() > 6) return false;
        var placement = settings.GetProperty("placement").GetString()!;
        if (placement is not ("start" or "end") && (!placement.StartsWith("native:", StringComparison.Ordinal) || placement.Length == 7)) return false;
        var providerIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var provider in providers.EnumerateArray())
        {
            if (!Properties(provider, "id", "enabled", "hero", "rows")
                || !Choice(provider, "id", "netflix", "prime", "disney", "apple", "now", "paramount")
                || !providerIds.Add(provider.GetProperty("id").GetString()!) || !Boolean(provider, "enabled") || !Boolean(provider, "hero")
                || !provider.TryGetProperty("rows", out var rows) || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 12) return false;
            var rowIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in rows.EnumerateArray())
                if (!Properties(row, "id", "title", "source", "collectionId", "enabled", "ranked", "itemSort")
                    || !Text(row, "id", 100, false) || !rowIds.Add(row.GetProperty("id").GetString()!) || !Text(row, "title", 80)
                    || !Choice(row, "source", "movies", "shows", "trending-movies", "trending-shows", "collection")
                    || !Text(row, "collectionId", 199) || !Boolean(row, "enabled") || !Boolean(row, "ranked")
                    || !Choice(row, "itemSort", "collection", "title", "title-desc", "newest", "oldest")) return false;
        }
        return true;
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
