namespace Cashless.Api.Dtos.Admin;

public sealed class CreateUserRequest
{
    // Cliente (Usuarios)
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }

    // Operador (login)
    public string? Username { get; set; }
    public string? DisplayName { get; set; }
    public string? Pin { get; set; }
    public string? Role { get; set; }
    public bool? IsActive { get; set; }
}
