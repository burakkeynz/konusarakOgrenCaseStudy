using Microsoft.EntityFrameworkCore;
using Api.Models;

namespace Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> opts) : DbContext(opts)
{
    public DbSet<User>    Users    => Set<User>();
    public DbSet<Message> Messages => Set<Message>();

protected override void OnModelCreating(ModelBuilder b)
{
    b.Entity<User>()
     .HasIndex(u => u.Alias)
     .IsUnique();

    b.Entity<Message>()
     .HasOne(m => m.User)
     .WithMany()
     .HasForeignKey(m => m.UserId)
     .OnDelete(DeleteBehavior.Cascade);

    b.Entity<Message>()
     .HasOne(m => m.Receiver)
     .WithMany()
     .HasForeignKey(m => m.ReceiverId)
     .OnDelete(DeleteBehavior.Restrict);

    b.Entity<Message>()
     .HasIndex(m => new { m.ReceiverId, m.IsRead });

    b.Entity<Message>()
     .Property(m => m.Status)
     .HasConversion<string>();
}




}
