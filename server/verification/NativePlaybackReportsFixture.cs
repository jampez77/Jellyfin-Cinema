using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Mvc;

public sealed class NativePlaybackReportsFixture
{
    public SessionInfo Session { get; set; } = null!;
    public bool Reject { get; set; }
    public TaskCompletionSource? StartEntered { get; set; }
    public TaskCompletionSource? FinishStart { get; set; }
}

// Match the actual native controller's descriptor and model binding. The
// lifecycle below reproduces official Jellyfin v12.0 SessionManager at 6c073e19:
// UpdateNowPlayingItem updates identity but ignores NowPlayingQueue; only Stop
// copies the queue. Do not seed it in Start: that hid the first-trailer bug.
namespace Jellyfin.Api.Controllers
{
    [ApiController]
    [Route("Sessions/Playing")]
    public sealed class PlaystateController(NativePlaybackReportsFixture fixture) : ControllerBase
    {
        [HttpPost]
        public async Task<IActionResult> ReportPlaybackStart([FromBody] PlaybackStartInfo report)
        {
            var result = Progress(report);
            fixture.StartEntered?.TrySetResult();
            if (fixture.FinishStart is not null) await fixture.FinishStart.Task;
            return result;
        }

        [HttpPost("Progress")]
        public IActionResult ReportPlaybackProgress([FromBody] PlaybackProgressInfo report) => Progress(report);

        private IActionResult Progress(PlaybackProgressInfo report)
        {
            if (fixture.Reject) return BadRequest();
            var session = fixture.Session;
            report.SessionId = session.Id;
            session.NowPlayingItem = new BaseItemDto { Id = report.ItemId, Type = Jellyfin.Data.Enums.BaseItemKind.Trailer };
            session.PlaylistItemId = report.PlaylistItemId;
            session.PlayState.IsPaused = report.IsPaused;
            return NoContent();
        }

        [HttpPost("Stopped")]
        public IActionResult ReportPlaybackStopped([FromBody] PlaybackStopInfo report)
        {
            if (fixture.Reject) return BadRequest();
            var session = fixture.Session;
            report.SessionId = session.Id;
            if (report.NowPlayingQueue is not null) session.NowPlayingQueue = report.NowPlayingQueue;
            session.PlaylistItemId = report.PlaylistItemId;
            session.NowPlayingItem = null;
            return NoContent();
        }
    }
}
