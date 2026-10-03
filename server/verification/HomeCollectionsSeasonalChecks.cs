using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.TvItemLayout.Api;
using Microsoft.AspNetCore.Mvc;

public static class HomeCollectionsSeasonalChecks
{
    public static JsonElement Settings() => JsonSerializer.SerializeToElement(new
    {
        version = 1,
        rows = new object[]
        {
            new { id = "regular", kind = "items", title = "Always here", collectionIds = new[] { "regular-collection" }, ranked = false,
                placement = "end", itemSort = "newest", itemOrder = Array.Empty<string>(), shuffle = true },
            new { id = "seasonal", kind = "seasonal", title = "", collectionIds = Array.Empty<string>(), ranked = false,
                placement = "native:resume", itemSort = "collection", itemOrder = Array.Empty<string>(), children = new object[]
                {
                    new { id = "halloween", kind = "items", title = "Halloween", collectionIds = new[] { "horror" }, ranked = true,
                        placement = "start", itemSort = "custom", itemOrder = new[] { "film-b", "film-a" }, shuffle = true,
                        season = new { start = "10-01", end = "10-31" }, tabs = new[]
                        {
                            new { id = "films", label = "Films", collectionId = "horror", itemSort = "custom", itemOrder = new[] { "film-b", "film-a" } },
                            new { id = "shows", label = "TV", collectionId = "spooky-shows", itemSort = "title", itemOrder = Array.Empty<string>() }
                        } },
                    new { id = "christmas", kind = "collections", title = "Christmas", collectionIds = new[] { "festive-films", "festive-shows" }, ranked = false,
                        placement = "end", itemSort = "title-desc", itemOrder = Array.Empty<string>(), shuffle = false,
                        season = new { start = "12-01", end = "01-06" } },
                    new { id = "leap-day", kind = "watchlist", title = "Leap day watchlist", collectionIds = Array.Empty<string>(), ranked = false,
                        placement = "end", itemSort = "collection", itemOrder = Array.Empty<string>(), shuffle = true,
                        season = new { start = "02-29", end = "02-29" } }
                } }
        }
    });

    public static async Task Run(Action<bool, string> assert, HomeCollectionsController controller,
        HomeCollectionsController second, string revision)
    {
        HomeCollectionsResponse Value(IActionResult result) => (HomeCollectionsResponse)((OkObjectResult)result).Value!;
        var settings = Settings();
        var saved = Value(await controller.PutHomeCollections(new(revision, settings)));
        var loaded = Value(await second.GetHomeCollections());
        assert(saved.Revision != revision && loaded.Revision == saved.Revision
            && loaded.Settings!.Value.GetRawText() == settings.GetRawText(),
            "Seasonal groups persist all child dates, collection IDs, tabs, orders, ranks and shuffle settings across controller instances");
        var noRows = JsonSerializer.SerializeToElement(new { version = 1, rows = Array.Empty<object>() });
        var legacy = JsonNode.Parse(settings.GetRawText())!.AsObject();
        legacy["rows"]!.AsArray().RemoveAt(1); legacy["rows"]![0]!.AsObject().Remove("shuffle");
        assert(await controller.PutHomeCollections(new(saved.Revision, JsonSerializer.SerializeToElement(legacy))) is ConflictObjectResult
            && await controller.PutHomeCollections(new(saved.Revision, noRows)) is ConflictObjectResult,
            "Old clients cannot silently erase seasonal groups or shuffled rows even with the latest revision");
        controller.Request.Headers["X-ScreenHarbour-Home-Rows"] = "2";

        async Task Reject(string reason, Action<JsonObject> mutate)
        {
            var value = JsonNode.Parse(settings.GetRawText())!.AsObject();
            mutate(value);
            assert(await controller.PutHomeCollections(new(saved.Revision, JsonSerializer.SerializeToElement(value))) is BadRequestObjectResult,
                "Seasonal validation rejects " + reason);
        }
        static JsonObject Group(JsonObject value) => value["rows"]![1]!.AsObject();
        static JsonObject Child(JsonObject value, int index = 0) => Group(value)["children"]![index]!.AsObject();
        foreach (var date in new[] { "00-01", "13-01", "10-00", "10-32", "04-31", "02-30", "1-01", "01-1", "2026-10-01", " 1-01", "aa-01" })
        {
            await Reject("an invalid start date " + date, value => Child(value)["season"]!["start"] = date);
            await Reject("an invalid end date " + date, value => Child(value)["season"]!["end"] = date);
        }
        await Reject("a missing child season", value => Child(value).Remove("season"));
        await Reject("a missing range end", value => Child(value)["season"]!.AsObject().Remove("end"));
        await Reject("a non-string date", value => Child(value)["season"]!["start"] = 1001);
        await Reject("unknown date fields", value => Child(value)["season"]!["timezone"] = "Europe/London");
        await Reject("a season on an ordinary root row", value => value["rows"]![0]!["season"] = Child(value)["season"]!.DeepClone());
        await Reject("a season on a group", value => Group(value)["season"] = Child(value)["season"]!.DeepClone());
        await Reject("nested seasonal groups", value => Child(value)["kind"] = "seasonal");
        await Reject("children on an ordinary row", value => Child(value)["children"] = new JsonArray());
        await Reject("missing group children", value => Group(value).Remove("children"));
        await Reject("non-array group children", value => Group(value)["children"] = "Halloween");
        await Reject("a null child", value => Group(value)["children"]![0] = null);
        await Reject("more than twelve child rows", value =>
        {
            var rows = Group(value)["children"]!.AsArray();
            while (rows.Count < 13)
            {
                var extra = rows[0]!.DeepClone(); extra["id"] = "extra-" + rows.Count; rows.Add(extra);
            }
        });
        await Reject("duplicate child IDs", value => Child(value, 1)["id"] = "halloween");
        await Reject("child IDs colliding with ordinary root rows", value => Child(value)["id"] = "regular");
        await Reject("child IDs colliding with their group", value => Child(value)["id"] = "seasonal");
        await Reject("duplicate IDs in a later group", value =>
        {
            var other = Group(value).DeepClone(); other["id"] = "second-seasonal"; value["rows"]!.AsArray().Add(other);
        });
        await Reject("a named group", value => Group(value)["title"] = "Not displayed");
        await Reject("ranked group artwork", value => Group(value)["ranked"] = true);
        await Reject("group collection sources", value => Group(value)["collectionIds"] = new JsonArray("collection"));
        await Reject("group item ordering", value => Group(value)["itemOrder"] = new JsonArray("item"));
        await Reject("a group sort", value => Group(value)["itemSort"] = "title");
        await Reject("group tabs", value => Group(value)["tabs"] = new JsonArray());
        await Reject("group shuffle", value => Group(value)["shuffle"] = true);
        await Reject("non-boolean child shuffle", value => Child(value)["shuffle"] = "true");
        await Reject("non-boolean root shuffle", value => value["rows"]![0]!["shuffle"] = 1);
        await Reject("unknown child properties", value => Child(value)["enabled"] = true);
        await Reject("unknown group properties", value => Group(value)["enabled"] = true);
        await Reject("unknown tab properties", value => Child(value)["tabs"]![0]!["season"] = Child(value)["season"]!.DeepClone());
        await Reject("an invalid child placement", value => Child(value)["placement"] = "middle");
        await Reject("an invalid child sort", value => Child(value)["itemSort"] = "random");
        await Reject("too many sources on an items child", value => Child(value)["collectionIds"]!.AsArray().Add("another"));
        await Reject("watchlist child sources", value => Child(value, 2)["collectionIds"]!.AsArray().Add("another"));
        await Reject("ranked watchlist children", value => Child(value, 2)["ranked"] = true);
        await Reject("tabs on collections children", value => Child(value, 1)["tabs"] = new JsonArray());
        var duplicateDate = settings.GetRawText().Replace("\"start\":\"10-01\"", "\"start\":\"10-01\",\"start\":\"11-01\"");
        assert(await controller.PutHomeCollections(new(saved.Revision, JsonDocument.Parse(duplicateDate).RootElement)) is BadRequestObjectResult,
            "Seasonal validation rejects duplicate JSON date properties instead of choosing one");

        var huge = JsonNode.Parse(settings.GetRawText())!.AsObject();
        var children = Group(huge)["children"]!.AsArray();
        children.Clear();
        for (var index = 0; index < 12; index++)
        {
            var child = JsonNode.Parse(settings.GetRawText())!["rows"]![1]!["children"]![0]!.DeepClone();
            child["id"] = "large-child-" + index;
            child["itemOrder"] = JsonSerializer.SerializeToNode(Enumerable.Repeat(new string('a', 199), 2000).ToArray());
            children.Add(child);
        }
        assert(await controller.PutHomeCollections(new(saved.Revision, JsonSerializer.SerializeToElement(huge))) is ObjectResult { StatusCode: 413 },
            "Seasonal child item orders remain bounded by the existing total settings size limit");
        assert(Value(await second.GetHomeCollections()).Revision == saved.Revision
            && Value(await second.GetHomeCollections()).Settings!.Value.GetRawText() == settings.GetRawText(),
            "Rejected seasonal edits never discard the last saved settings or change their revision");

        var empty = JsonNode.Parse(settings.GetRawText())!.AsObject();
        Group(empty)["children"] = new JsonArray(); Group(empty)["shuffle"] = false;
        var emptySaved = Value(await controller.PutHomeCollections(new(saved.Revision, JsonSerializer.SerializeToElement(empty))));
        assert(emptySaved.Settings!.Value.GetProperty("rows")[1].GetProperty("children").GetArrayLength() == 0,
            "An empty seasonal group can be saved without losing its configured Home position");
        empty["rows"]!.AsArray().RemoveAt(1);
        var shuffledSaved = Value(await controller.PutHomeCollections(new(emptySaved.Revision, JsonSerializer.SerializeToElement(empty))));
        controller.Request.Headers.Remove("X-ScreenHarbour-Home-Rows");
        assert(await controller.PutHomeCollections(new(shuffledSaved.Revision, JsonSerializer.SerializeToElement(legacy))) is ConflictObjectResult,
            "Old clients cannot silently discard shuffle when no seasonal group remains");
        controller.Request.Headers["X-ScreenHarbour-Home-Rows"] = "2";
        var cleared = Value(await controller.PutHomeCollections(new(shuffledSaved.Revision, noRows)));
        assert(cleared.Settings!.Value.GetProperty("rows").GetArrayLength() == 0,
            "A capable client can intentionally delete all seasonal and shuffled rows");
        await HomeCollectionsAppearanceChecks.Run(assert, controller, second, cleared.Revision!);
    }
}
