namespace Api.Models;
public class Message
{
    public int      Id        { get; set; }

    public int      UserId    { get; set; }     
    public User?    User      { get; set; }
    public int      ReceiverId{ get; set; }      
    public User?    Receiver  { get; set; }     

    public string   Text { get; set; } = null!;
    public string?  SentimentLabel { get; set; }
    public double?  SentimentScore { get; set; }

    public MessageStatus Status { get; set; } = MessageStatus.PENDING;
    public string?  Error { get; set; }

    public bool     IsRead    { get; set; } = false;
    public DateTime? ReadAt   { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
