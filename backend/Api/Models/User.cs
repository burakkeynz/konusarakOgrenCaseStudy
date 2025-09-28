namespace Api.Models;

public class User
{
    public int      Id        { get; set; }
    public string   Alias     { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
