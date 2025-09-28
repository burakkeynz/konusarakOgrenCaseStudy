namespace Api.Dtos;

public record CreateMessageRequest(int UserId, int ReceiverId, string Text);

public record MessageResponse(
    int      Id,
    int      UserId,
    int      ReceiverId,
    string   Text,
    string   SentimentLabel,
    double   SentimentScore,
    DateTime CreatedAt
);
