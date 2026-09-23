using System.Reflection;
using Jellyfin.Plugin.TvItemLayout.Api;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Newtonsoft.Json.Linq;
#if JELLYFIN_1010
using ServerUser = Jellyfin.Data.Entities.User;
#else
using ServerUser = Jellyfin.Database.Implementations.Entities.User;
#endif

public static class PlaybackChecks
{
    public static async Task Run(Action<bool, string> assert)
    {
        var auth = new AuthorizationInfo { Token = "test-token", DeviceId = "this-device", User = new ServerUser("test-user", "provider", "reset") { Id = Guid.NewGuid() } };
        SessionInfo? session = null;
        var calls = 0;
        var authorization = InterfaceStub.Create<IAuthorizationContext>((method, args) => Task.FromResult(auth));
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) =>
        {
            if (method.Name != "GetSessionByAuthenticationToken") throw new Exception("Unexpected session lookup");
            calls++;
            assert((string)args![0]! == auth.Token && (string)args[1]! == auth.DeviceId,
                "Playback context resolves only the authenticated token and device");
            return Task.FromResult(session!);
        });
        var controller = new PlaybackContextController(authorization, sessions)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        assert(typeof(PlaybackContextController).GetCustomAttribute<AuthorizeAttribute>() is not null,
            "Playback context endpoint requires authentication");
        assert(typeof(PlaybackContextController).GetMethod("GetPlaybackContext")!
            .GetCustomAttribute<ResponseCacheAttribute>()?.NoStore == true, "Playback context is never cached");

        var token = auth.Token;
        auth.Token = "";
        assert(await controller.GetPlaybackContext() is UnauthorizedResult && calls == 0, "Missing token cannot query playback sessions");
        auth.Token = token; auth.DeviceId = "";
        assert(await controller.GetPlaybackContext() is UnauthorizedResult && calls == 0, "Missing device cannot query playback sessions");
        auth.DeviceId = "this-device"; auth.IsApiKey = true;
        assert(await controller.GetPlaybackContext() is UnauthorizedResult && calls == 0, "API keys cannot query a user's playback context");
        auth.IsApiKey = false;
        session = new SessionInfo(sessions, NullLogger.Instance) { UserId = Guid.NewGuid(), DeviceId = auth.DeviceId };
        assert(await controller.GetPlaybackContext() is UnauthorizedResult, "Another user's session is rejected");
        session.UserId = auth.UserId; session.DeviceId = "other-device";
        assert(await controller.GetPlaybackContext() is UnauthorizedResult, "Another device's session is rejected");
        session.DeviceId = auth.DeviceId;
        assert(await controller.GetPlaybackContext() is JsonResult { Value: null }, "No playing item returns empty playback context");
        var itemId = Guid.NewGuid();
        session.NowPlayingItem = new BaseItemDto { Id = itemId, Name = "Playing item" };
        var result = await controller.GetPlaybackContext() as OkObjectResult;
        var value = JObject.FromObject(result!.Value!);
        assert(value["PlayingItemId"]!.Value<Guid>() == itemId && value["Queue"] is JArray,
            "Current device receives playing identity and queue");
        assert(value.Properties().Select(property => property.Name).Order()
            .SequenceEqual(new[] { "PlayingItemExtraType", "PlayingItemId", "PlayingItemType", "PlaylistItemId", "Queue" }.Order()),
            "Playback context excludes tokens and unrelated session data");
    }
}

public class InterfaceStub : DispatchProxy
{
    private Func<MethodInfo, object?[]?, object?> callback = null!;
    public static T Create<T>(Func<MethodInfo, object?[]?, object?> callback) where T : class
    {
        var proxy = Create<T, InterfaceStub>();
        ((InterfaceStub)(object)proxy).callback = callback;
        return proxy;
    }
    protected override object? Invoke(MethodInfo? method, object?[]? args) => callback(method!, args);
}
