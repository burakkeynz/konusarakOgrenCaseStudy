namespace Api.Dtos;

public record AliasRequest(string Alias);
public record AliasResponse(int UserId, string Alias);
