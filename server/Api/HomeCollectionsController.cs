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
[Route("TvItemLayout/HomeCollections")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class HomeCollectionsController(
    IAuthorizationContext authorizationContext,
    ISessionManager sessionManager,
    IUserManager userManager,
    IDeviceManager deviceManager,
    INetworkManager networkManager,
    IApplicationPaths paths) : ControllerBase
{
    public const int MaximumBytes = 512 * 1024;
    // Shared by every controller instance, including competing first-use migrations.
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

    private string StorePath(Guid user) => Path.Combine(paths.DataPath, "jellyfin-cinema", "home-collections", user.ToString("N") + ".json");

    private static async Task<HomeCollectionsResponse> Read(string path, CancellationToken cancellationToken)
    {
        if (!System.IO.File.Exists(path)) return new(null, null);
        if (new FileInfo(path).Length > MaximumBytes + 1024) throw new InvalidDataException("Saved Home rows exceed the size limit.");
        var data = await System.IO.File.ReadAllTextAsync(path, cancellationToken);
        var saved = JsonSerializer.Deserialize<HomeCollectionsResponse>(data);
        if (saved?.Revision is null || !Guid.TryParseExact(saved.Revision, "N", out _)
            || saved.Settings is not JsonElement settings || !ValidSettings(settings))
            throw new InvalidDataException("Saved Home rows are invalid.");
        return saved;
    }

    [HttpGet]
    public async Task<IActionResult> GetHomeCollections(CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        await StoreLock.WaitAsync(cancellationToken);
        try { return Ok(await Read(StorePath(user.Value), cancellationToken)); }
        finally { StoreLock.Release(); }
    }

    [HttpPut]
    [RequestSizeLimit(MaximumBytes)]
    public async Task<IActionResult> PutHomeCollections([FromBody] HomeCollectionsRequest request, CancellationToken cancellationToken = default)
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if ((request.Revision is not null && !Guid.TryParseExact(request.Revision, "N", out _)) || !ValidSettings(request.Settings))
            return BadRequest("Invalid Home collection settings.");
        if (Encoding.UTF8.GetByteCount(request.Settings.GetRawText()) > MaximumBytes - 1024)
            return StatusCode(413, "Home collection settings are too large.");
        await StoreLock.WaitAsync(cancellationToken);
        try
        {
            var path = StorePath(user.Value);
            var current = await Read(path, cancellationToken);
            if (!string.Equals(request.Revision, current.Revision, StringComparison.Ordinal))
                return Conflict("Home rows changed on another device. Reload them before saving.");
            var saved = new HomeCollectionsResponse(Guid.NewGuid().ToString("N"), request.Settings.Clone());
            var serialized = JsonSerializer.Serialize(saved);
            if (Encoding.UTF8.GetByteCount(serialized) > MaximumBytes)
                return StatusCode(413, "Home collection settings are too large.");
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
    private static bool Strings(JsonElement value, string key, int maximum) => value.TryGetProperty(key, out var array)
        && array.ValueKind == JsonValueKind.Array && array.GetArrayLength() <= maximum
        && array.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String && item.GetString()!.Length is > 0 and < 200);
    private static bool Sort(JsonElement value) => value.TryGetProperty("itemSort", out var sort) && sort.ValueKind == JsonValueKind.String
        && new[] { "collection", "title", "title-desc", "newest", "oldest", "custom" }.Contains(sort.GetString());
    private static bool ValidSettings(JsonElement settings)
    {
        if (!Properties(settings, "version", "rows") || !settings.TryGetProperty("version", out var version)
            || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1 || !settings.TryGetProperty("rows", out var rows)
            || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 12) return false;
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows.EnumerateArray())
        {
            if (!Properties(row, "id", "kind", "title", "collectionIds", "ranked", "placement", "itemSort", "itemOrder", "tabs")
                || !Text(row, "id", 100, false) || !ids.Add(row.GetProperty("id").GetString()!) || !Text(row, "title", 80)
                || !row.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String
                || kind.GetString() is not ("collections" or "items")
                || !Strings(row, "collectionIds", kind.GetString() == "items" ? 1 : 40)
                || !row.TryGetProperty("ranked", out var ranked) || ranked.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || !Text(row, "placement", 240, false) || !Sort(row) || !Strings(row, "itemOrder", 2000)) return false;
            var placement = row.GetProperty("placement").GetString()!;
            if (placement is not ("start" or "end") && !placement.StartsWith("native:", StringComparison.Ordinal)) return false;
            if (!row.TryGetProperty("tabs", out var tabs)) continue;
            if (kind.GetString() != "items" || tabs.ValueKind != JsonValueKind.Array || tabs.GetArrayLength() > 6) return false;
            var tabIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tab in tabs.EnumerateArray())
                if (!Properties(tab, "id", "label", "collectionId", "itemSort", "itemOrder") || !Text(tab, "id", 100, false)
                    || !tabIds.Add(tab.GetProperty("id").GetString()!) || !Text(tab, "label", 40)
                    || !Text(tab, "collectionId", 199) || !Sort(tab) || !Strings(tab, "itemOrder", 2000)) return false;
        }
        return true;
    }
}

public sealed record HomeCollectionsRequest(
    [property: JsonPropertyName("Revision")] string? Revision,
    [property: JsonPropertyName("Settings")] JsonElement Settings);
public sealed record HomeCollectionsResponse(
    // Jellyfin globally omits null JSON properties. Missing settings must keep
    // both fields so clients can distinguish first use from a malformed reply.
    [property: JsonPropertyName("Revision"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Revision,
    [property: JsonPropertyName("Settings"), JsonIgnore(Condition = JsonIgnoreCondition.Never)] JsonElement? Settings);
