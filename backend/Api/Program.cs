using Api.Data;
using Api.Dtos;
using Api.Hubs;
using Api.Models;
using Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var aiBaseUrl = builder.Configuration["AI:BaseUrl"] ?? "http://127.0.0.1:7860";
var cs = builder.Configuration.GetConnectionString("DefaultConnection")
         ?? "Data Source=AppData/app.db";

var aiFromEnv = Environment.GetEnvironmentVariable("AI_BASE_URL");
if (!string.IsNullOrWhiteSpace(aiFromEnv))
    aiBaseUrl = aiFromEnv;

string[] allowed = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
var corsFromEnv = Environment.GetEnvironmentVariable("CORS_ORIGINS");
if (!string.IsNullOrWhiteSpace(corsFromEnv))
    allowed = corsFromEnv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

// DI
builder.Services.AddDbContext<AppDbContext>(opt => opt.UseSqlite(cs));
builder.Services.AddHttpClient<SentimentClient>(c =>
{
    c.Timeout = TimeSpan.FromSeconds(25);
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSignalR();

// CORS
builder.Services.AddCors(opt =>
{
    opt.AddPolicy("app", p => p
        .SetIsOriginAllowed(origin =>
            origin.StartsWith("http://localhost") ||
            origin.StartsWith("https://localhost") ||
            origin.EndsWith(".vercel.app"))  //vercelin alternatif URL'lerini de kabul etmek için böyle bir şey ekledim
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});


var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    Directory.CreateDirectory("AppData");
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

app.UseSwagger();
app.UseSwaggerUI();
app.UseCors("app");

// Hubs
app.MapHub<ChatHub>("/hubs/chat");

// Health check kısmı, her appte oluştururum ilk endpoint olarak
app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));

// alias oluşturma kısmı, takma ad girerekten giriş yapma, yoksa oluşturma 
app.MapPost("/auth/alias", async (AliasRequest req, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(req.Alias))
        return Results.BadRequest("Alias required");

    var name = req.Alias.Trim();
    var existing = await db.Users.FirstOrDefaultAsync(x => x.Alias == name);
    if (existing is not null)
        return Results.Ok(new AliasResponse(existing.Id, existing.Alias));

    var u = new User { Alias = name, CreatedAt = DateTime.UtcNow };
    db.Users.Add(u);
    await db.SaveChangesAsync();
    return Results.Ok(new AliasResponse(u.Id, u.Alias));
});

// kişileri listelemek için yapıyorum sohbete
app.MapGet("/users", async (AppDbContext db) =>
{
    var list = await db.Users
        .OrderBy(u => u.Id)
        .Select(u => new { u.Id, u.Alias })
        .ToListAsync();
    return Results.Ok(list);
});

// tüm mesajları silme tuşu
app.MapDelete("/admin/messages", async (AppDbContext db) =>
{
    await db.Messages.ExecuteDeleteAsync();
    return Results.Ok(new { ok = true });
});

// mesaj oluşturma + publish (thread + mesaj grupları)
app.MapPost("/messages", async (
    CreateMessageRequest req,
    AppDbContext db,
    SentimentClient ai,
    IHubContext<ChatHub> hub,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.Text))
        return Results.BadRequest("text required");

    var sender = await db.Users.FindAsync(req.UserId);
    if (sender is null) return Results.NotFound("sender not found");

    var receiver = await db.Users.FindAsync(req.ReceiverId);
    if (receiver is null) return Results.NotFound("receiver not found");

    (string label, double score) result;
    try
    {
        result = await ai.AnalyzeAsync(aiBaseUrl, req.Text, ct);
    }
    catch (Exception ex)
    {
        //burda 502 çokça yaşadım, çözmek için ufak delay ekledim, queue değiştirmeyi denedim vs HF içinde çözdüm sonra
        return Results.Problem(
            title: "Sentiment service failed",
            detail: ex.Message,
            statusCode: StatusCodes.Status502BadGateway);
    }

    var now = DateTime.UtcNow;

    var m = new Message
    {
        UserId         = req.UserId,
        ReceiverId     = req.ReceiverId,
        Text           = req.Text.Trim(),
        SentimentLabel = result.label,
        SentimentScore = result.score,
        CreatedAt      = now,
        UpdatedAt      = now,
        Status         = MessageStatus.READY,
        IsRead         = false,
        ReadAt         = null
    };

    db.Messages.Add(m);
    await db.SaveChangesAsync(ct);

    var dto = new MessageResponse(
        m.Id,
        m.UserId,
        m.ReceiverId,
        m.Text,
        m.SentimentLabel ?? "NEUTRAL",
        m.SentimentScore ?? 0.0,
        m.CreatedAt,
        sender.Alias,          
        receiver.Alias         
    );

    await hub.Clients
             .Group(ChatHub.ThreadKey(m.UserId, m.ReceiverId))
             .SendAsync("message", dto, ct);

    await hub.Clients
             .Group(ChatHub.UserKey(m.ReceiverId))
             .SendAsync("inbox:new", new { message = dto }, ct);

    await hub.Clients
             .Group(ChatHub.UserKey(m.UserId))
             .SendAsync("inbox:new", new { message = dto }, ct);

    return Results.Ok(dto);
});

//tek kullanıcının mesajlar
app.MapGet("/messages", async (string? alias, int? userId, int? limit, AppDbContext db) =>
{
    var take = Math.Clamp(limit ?? 50, 1, 200);

    int? uid = userId;
    if (!uid.HasValue && !string.IsNullOrWhiteSpace(alias))
    {
        var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Alias == alias!.Trim());
        if (u is null) return Results.Ok(Array.Empty<MessageResponse>());
        uid = u.Id;
    }

    var q = db.Messages.AsNoTracking().AsQueryable();
    if (uid.HasValue)
        q = q.Where(m => m.UserId == uid.Value || m.ReceiverId == uid.Value);

    var list = await q
        .OrderByDescending(m => m.Id)
        .Take(take)
        .Select(m => new MessageResponse(
        m.Id,
        m.UserId,
        m.ReceiverId,
        m.Text,
        m.SentimentLabel ?? "NEUTRAL",
        m.SentimentScore ?? 0.0,
        m.CreatedAt,
        db.Users.Where(u => u.Id == m.UserId).Select(u => u.Alias).FirstOrDefault() ?? $"#{m.UserId}",
        db.Users.Where(u => u.Id == m.ReceiverId).Select(u => u.Alias).FirstOrDefault() ?? $"#{m.ReceiverId}"
    ))

        .ToListAsync();

    return Results.Ok(list);
});

//iki kullanıcı mesajları
app.MapGet("/messages/thread", async (int userA, int userB, int? limit, AppDbContext db) =>
{
    if (userA <= 0 || userB <= 0) return Results.BadRequest("userA,userB required");
    var take = Math.Clamp(limit ?? 200, 1, 500);

    var list = await db.Messages.AsNoTracking()
        .Where(m =>
            (m.UserId == userA && m.ReceiverId == userB) ||
            (m.UserId == userB && m.ReceiverId == userA))
        .OrderBy(m => m.Id)
        .Take(take)
        .Select(m => new MessageResponse(
            m.Id,
            m.UserId,
            m.ReceiverId,
            m.Text,
            m.SentimentLabel ?? "NEUTRAL",
            m.SentimentScore ?? 0.0,
            m.CreatedAt,
            db.Users.Where(u => u.Id == m.UserId).Select(u => u.Alias).FirstOrDefault() ?? $"#{m.UserId}",
            db.Users.Where(u => u.Id == m.ReceiverId).Select(u => u.Alias).FirstOrDefault() ?? $"#{m.ReceiverId}"
            ))
        .ToListAsync();

    return Results.Ok(list);
});

// gelen okunmamışları sayma
app.MapGet("/inbox/unread", async (int me, AppDbContext db) =>
{
    var rows = await db.Messages
        .Where(x => x.ReceiverId == me && !x.IsRead)
        .GroupBy(x => x.UserId)
        .Select(g => new { peerId = g.Key, count = g.Count() })
        .ToListAsync();

    return Results.Ok(rows);
});

//okundu işaretleme kısmı, badge düşürmek için
app.MapPost("/messages/mark-read", async (int me, int peer, AppDbContext db, IHubContext<ChatHub> hub) =>
{
    var now = DateTime.UtcNow;
    var updated = await db.Messages
        .Where(m => m.ReceiverId == me && m.UserId == peer && !m.IsRead)
        .ExecuteUpdateAsync(s => s.SetProperty(m => m.IsRead, true)
                                  .SetProperty(m => m.ReadAt, now));

    var unreadTotal = await db.Messages.CountAsync(x => x.ReceiverId == me && !x.IsRead);
    await hub.Clients.Group(ChatHub.UserKey(me))
                     .SendAsync("inbox:unread", new { total = unreadTotal, from = peer });

    return Results.Ok(new { updated });
});

app.Run();
