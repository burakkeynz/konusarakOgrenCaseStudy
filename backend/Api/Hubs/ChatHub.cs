using Microsoft.AspNetCore.SignalR;

namespace Api.Hubs
{
    public class ChatHub : Hub
    {
        public static string ThreadKey(int a, int b) => a < b ? $"t:{a}:{b}" : $"t:{b}:{a}";
        public static string UserKey(int userId)     => $"u:{userId}";

        public Task JoinUser(int userId)
            => Groups.AddToGroupAsync(Context.ConnectionId, UserKey(userId));

        public Task LeaveUser(int userId)
            => Groups.RemoveFromGroupAsync(Context.ConnectionId, UserKey(userId));

        public Task JoinThread(int me, int peer)
            => Groups.AddToGroupAsync(Context.ConnectionId, ThreadKey(me, peer));

        public Task LeaveThread(int me, int peer)
            => Groups.RemoveFromGroupAsync(Context.ConnectionId, ThreadKey(me, peer));

        public Task Typing(int me, int peer)
            => Clients.Group(ThreadKey(me, peer)).SendAsync("typing", new { from = me, to = peer });
    }
}
