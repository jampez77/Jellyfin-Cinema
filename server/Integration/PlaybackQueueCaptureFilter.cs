using MediaBrowser.Common.Extensions;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TvItemLayout.Integration;

/// <summary>Reads model-bound native playback reports after their authorized action succeeds.</summary>
public sealed class PlaybackQueueCaptureFilter(PlaybackQueueStore queues, IAuthorizationContext authorization,
    ISessionManager sessions, ILogger<PlaybackQueueCaptureFilter> logger) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.ActionDescriptor is not ControllerActionDescriptor action
            || action.ControllerTypeInfo.FullName != "Jellyfin.Api.Controllers.PlaystateController"
            || action.ActionName is not ("ReportPlaybackStart" or "ReportPlaybackProgress" or "ReportPlaybackStopped"))
        { await next(); return; }
        var progress = context.ActionArguments.Values.OfType<PlaybackProgressInfo>().SingleOrDefault();
        var stop = context.ActionArguments.Values.OfType<PlaybackStopInfo>().SingleOrDefault();
        var order = queues.NextSequence();
        var executed = await next();
        if (executed.Canceled || executed.Exception is not null
            || ((executed.Result as IStatusCodeActionResult)?.StatusCode ?? context.HttpContext.Response.StatusCode) >= 400) return;
        try
        {
            var auth = await authorization.GetAuthorizationInfo(context.HttpContext);
            if (auth.IsApiKey || auth.UserId == Guid.Empty || string.IsNullOrWhiteSpace(auth.Token)
                || string.IsNullOrWhiteSpace(auth.DeviceId)) return;
            var session = await sessions.GetSessionByAuthenticationToken(auth.Token, auth.DeviceId,
                context.HttpContext.GetNormalizedRemoteIP().ToString());
            var reportSession = progress?.SessionId ?? stop?.SessionId;
            if (session is null || session.UserId != auth.UserId || session.DeviceId != auth.DeviceId
                || string.IsNullOrWhiteSpace(session.Id) || session.Id != reportSession) return;
            if (action.ActionName == "ReportPlaybackStopped" && stop is not null) queues.Stop(session, stop, order);
            else if (progress is not null && progress.ItemId != Guid.Empty)
                queues.Record(session, progress, action.ActionName == "ReportPlaybackStart", order);
        }
        catch (Exception)
        {
            // An optional UI enhancement must not fail a native playback report.
            logger.LogDebug("Unable to retain the current playback queue.");
        }
    }
}
