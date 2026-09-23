using System.Net;
using System.Reflection;
using System.Text.Json;
#if JELLYFIN_1010
using Jellyfin.Data.Entities;
using Jellyfin.Data.Enums;
#else
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
#endif
using Jellyfin.Plugin.TvItemLayout.Api;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Devices;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

public static class ProfileSwitchChecks
{
    private const string DefaultProvider = "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider";

    public static async Task Run(Action<bool, string> assert)
    {
        var caller = Profile("caller");
        caller.SetPermission(PermissionKind.IsAdministrator, true);
        var auth = new AuthorizationInfo { Token = "test-token", DeviceId = "this-device", User = caller };
        var userList = new List<User>();
        var deniedDevices = new HashSet<Guid>();
        User? currentCaller = caller;
        SessionInfo? session = null;
        var sessionCalls = 0;
        var userCalls = 0;
        var local = true;
        IPAddress? seenNetworkIp = null;
        var authorization = InterfaceStub.Create<IAuthorizationContext>((_, _) => Task.FromResult(auth));
        var sessions = InterfaceStub.Create<ISessionManager>((method, args) =>
        {
            if (method.Name != "GetSessionByAuthenticationToken") throw new Exception("Eligibility must not authenticate or change sessions");
            sessionCalls++;
            if ((string)args![0]! != auth.Token || (string)args[1]! != auth.DeviceId || (string)args[2]! != "192.0.2.10")
                throw new Exception("Eligibility session lookup must use this request's token, device and normalized IP");
            return Task.FromResult(session!);
        });
        var users = InterfaceStub.Create<IUserManager>((method, args) =>
        {
            userCalls++;
            if (method.Name == "GetUserById")
            {
                if ((Guid)args![0]! != caller.Id) throw new Exception("Unexpected caller lookup");
                return currentCaller;
            }
#if JELLYFIN_12
            if (method.Name == "GetUsers") return userList;
#else
            if (method.Name == "get_Users") return userList;
#endif
            throw new Exception("Eligibility must not authenticate, mutate accounts or create DTOs");
        });
        var devices = InterfaceStub.Create<IDeviceManager>((method, args) =>
        {
            if (method.Name != "CanAccessDevice" || (string)args![1]! != auth.DeviceId)
                throw new Exception("Eligibility must use the native device access rule for this device");
            return !deniedDevices.Contains(((User)args[0]!).Id);
        });
        var network = InterfaceStub.Create<INetworkManager>((method, args) =>
        {
            if (method.Name != "IsInLocalNetwork" || args![0] is not IPAddress address)
                throw new Exception("Eligibility must use the native network rule");
            seenNetworkIp = address;
            return local;
        });
        var controller = new ProfileSwitchEligibilityController(authorization, sessions, users, devices, network)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        controller.HttpContext.Connection.RemoteIpAddress = IPAddress.Parse("::ffff:192.0.2.10");

        assert(typeof(ProfileSwitchEligibilityController).GetCustomAttribute<AuthorizeAttribute>() is not null,
            "Profile eligibility requires authentication");
        var method = typeof(ProfileSwitchEligibilityController).GetMethod("GetProfileSwitchEligibility")!;
        assert(method.GetCustomAttribute<HttpGetAttribute>()?.Template == "ProfileSwitchEligibility"
            && method.GetCustomAttribute<ResponseCacheAttribute>() is { NoStore: true, Location: ResponseCacheLocation.None },
            "Profile eligibility is a read-only, uncached endpoint");

        var savedToken = auth.Token;
        auth.Token = " ";
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && sessionCalls == 0 && userCalls == 0,
            "Missing token cannot inspect profile eligibility");
        auth.Token = savedToken; auth.DeviceId = " ";
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && sessionCalls == 0 && userCalls == 0,
            "Missing device cannot inspect profile eligibility");
        auth.DeviceId = "this-device"; auth.IsApiKey = true;
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && sessionCalls == 0 && userCalls == 0,
            "API keys cannot inspect profile eligibility");
        auth.IsApiKey = false; auth.User = null;
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && sessionCalls == 0 && userCalls == 0,
            "A token without a signed-in user cannot inspect eligibility");
        auth.User = caller;
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && userCalls == 0,
            "Missing or revoked sessions cannot inspect eligibility");
        session = new SessionInfo(sessions, NullLogger.Instance) { UserId = Guid.NewGuid(), DeviceId = auth.DeviceId };
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && userCalls == 0,
            "Another user's session cannot inspect eligibility");
        session.UserId = caller.Id; session.DeviceId = "other-device";
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult && userCalls == 0,
            "Another device's session cannot inspect eligibility");
        session.DeviceId = auth.DeviceId;
        currentCaller = null;
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult,
            "A deleted caller cannot inspect eligibility through stale session data");
        currentCaller = caller;
        caller.SetPermission(PermissionKind.IsDisabled, true);
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult,
            "A newly disabled caller cannot inspect eligibility through stale session data");
        caller.SetPermission(PermissionKind.IsDisabled, false);
        caller.AccessSchedules.Add(new AccessSchedule(DynamicDayOfWeek.Everyday, 24, 24, caller.Id));
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult,
            "A caller outside its parental schedule cannot inspect eligibility");
        caller.AccessSchedules.Clear();
        deniedDevices.Add(caller.Id);
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult,
            "A caller whose device access was revoked cannot inspect eligibility");
        deniedDevices.Remove(caller.Id);
        caller.SetPermission(PermissionKind.EnableRemoteAccess, false); local = false;
        assert(await controller.GetProfileSwitchEligibility() is UnauthorizedResult,
            "A remote caller whose remote access was revoked cannot inspect eligibility");
        caller.SetPermission(PermissionKind.EnableRemoteAccess, true); local = true;

        var eligible = Profile("eligible");
        eligible.AccessSchedules.Add(new AccessSchedule(DynamicDayOfWeek.Everyday, 0, 24, eligible.Id));
        var emptyPassword = Profile("empty"); emptyPassword.Password = "";
        emptyPassword.AuthenticationProviderId = DefaultProvider.ToUpperInvariant();
        var protectedUser = Profile("protected"); protectedUser.Password = "test-hash-not-a-credential";
        var whitespacePassword = Profile("whitespace"); whitespacePassword.Password = " ";
        var hidden = Profile("hidden"); hidden.SetPermission(PermissionKind.IsHidden, true);
        var disabled = Profile("disabled"); disabled.SetPermission(PermissionKind.IsDisabled, true);
        var administrator = Profile("administrator"); administrator.SetPermission(PermissionKind.IsAdministrator, true);
        var external = Profile("external"); external.AuthenticationProviderId = "Example.ExternalProvider";
        var missingProvider = Profile("missing"); missingProvider.AuthenticationProviderId = "";
        var nullProvider = Profile("null-provider"); nullProvider.AuthenticationProviderId = null!;
        var prefixProvider = Profile("prefix"); prefixProvider.AuthenticationProviderId = DefaultProvider + ".Other";
        var deviceBlocked = Profile("device"); deniedDevices.Add(deviceBlocked.Id);
        var scheduleBlocked = Profile("schedule"); scheduleBlocked.AccessSchedules.Add(new AccessSchedule(DynamicDayOfWeek.Everyday, 24, 24, scheduleBlocked.Id));
        var emptyId = Profile("empty-id"); emptyId.Id = Guid.Empty;
        userList.AddRange([caller, eligible, emptyPassword, protectedUser, whitespacePassword, hidden, disabled,
            administrator, external, missingProvider, nullProvider, prefixProvider, deviceBlocked, scheduleBlocked, emptyId, eligible]);

        var result = (OkObjectResult)await controller.GetProfileSwitchEligibility();
        var response = (ProfileSwitchEligibilityResponse)result.Value!;
        assert(response.ProfileIds.Order().SequenceEqual(new[] { eligible.Id.ToString("N"), emptyPassword.Id.ToString("N") }.Order()),
            "Only visible enabled non-admin default-provider profiles with no password and allowed device/schedule are eligible");
        assert(seenNetworkIp?.Equals(IPAddress.Parse("192.0.2.10")) == true,
            "IPv4-mapped addresses use the same normalized network check as native public users");
        using (var json = JsonDocument.Parse(JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web))))
        {
            assert(json.RootElement.EnumerateObject().Select(property => property.Name).SequenceEqual(new[] { "ProfileIds" })
                && json.RootElement.GetProperty("ProfileIds").EnumerateArray().All(id => Guid.TryParseExact(id.GetString(), "N", out _)),
                "Wire response contains only ProfileIds with normalized GUID strings, never account details or credentials");
        }
        eligible.SetPermission(PermissionKind.EnableRemoteAccess, false);
        local = false;
        response = (ProfileSwitchEligibilityResponse)((OkObjectResult)await controller.GetProfileSwitchEligibility()).Value!;
        assert(response.ProfileIds.SequenceEqual(new[] { emptyPassword.Id.ToString("N") }),
            "Remote requests exclude profiles whose native remote access is disabled");
        local = true;
        response = (ProfileSwitchEligibilityResponse)((OkObjectResult)await controller.GetProfileSwitchEligibility()).Value!;
        assert(response.ProfileIds.Contains(eligible.Id.ToString("N")),
            "A local request still permits a profile with remote access disabled");
        caller.SetPermission(PermissionKind.IsAdministrator, false);
        assert(await controller.GetProfileSwitchEligibility() is OkObjectResult,
            "A valid non-admin session can use the same public-profile eligibility check");
        caller.SetPermission(PermissionKind.IsAdministrator, true);
        eligible.Password = "new-test-hash"; emptyPassword.SetPermission(PermissionKind.IsHidden, true);
        response = (ProfileSwitchEligibilityResponse)((OkObjectResult)await controller.GetProfileSwitchEligibility()).Value!;
        assert(response.ProfileIds.Length == 0,
            "A later request sees password and visibility changes instead of cached eligibility");
        assert(protectedUser.InvalidLoginAttemptCount == 0 && eligible.InvalidLoginAttemptCount == 0,
            "Eligibility never performs login attempts or changes failure counters");
    }

    private static User Profile(string name)
    {
        var user = new User(name, DefaultProvider, "reset") { Id = Guid.NewGuid(), Password = null };
        user.SetPermission(PermissionKind.IsHidden, false);
        user.SetPermission(PermissionKind.IsDisabled, false);
        user.SetPermission(PermissionKind.IsAdministrator, false);
        user.SetPermission(PermissionKind.EnableRemoteAccess, true);
        return user;
    }
}
