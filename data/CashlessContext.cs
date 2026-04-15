using Microsoft.EntityFrameworkCore;
using Cashless.Api.Models;

namespace Cashless.Api.Data;

public class CashlessContext : DbContext
{
    public CashlessContext(DbContextOptions<CashlessContext> options)
        : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Card> Cards => Set<Card>();
    public DbSet<Transaction> Transactions => Set<Transaction>();

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Festival> Festivals => Set<Festival>();

    public DbSet<Area> Areas => Set<Area>();
    public DbSet<Operator> Operators => Set<Operator>();
    public DbSet<OperatorArea> OperatorAreas => Set<OperatorArea>();

    public DbSet<Product> Products => Set<Product>();
    public DbSet<AreaProduct> AreaProducts => Set<AreaProduct>();

    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleItem> SaleItems => Set<SaleItem>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<CardAudit> CardAudits => Set<CardAudit>();
    public DbSet<Recharge> Recharges => Set<Recharge>();
    public DbSet<InventoryMovement> InventoryMovements => Set<InventoryMovement>();
    public DbSet<BalanceTransfer> BalanceTransfers => Set<BalanceTransfer>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Tenant>()
            .HasIndex(t => t.Name);

        // Area -> Operators
        modelBuilder.Entity<Area>()
            .HasMany(a => a.Operators)
            .WithOne(o => o.Area)
            .HasForeignKey(o => o.AreaId)
            .OnDelete(DeleteBehavior.SetNull);

        // UID único
        modelBuilder.Entity<Card>()
            .HasIndex(c => c.Uid)
            .IsUnique();

        // User -> Cards
        modelBuilder.Entity<User>()
            .HasMany(u => u.Cards)
            .WithOne(c => c.User)
            .HasForeignKey(c => c.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // User -> Transactions
        modelBuilder.Entity<User>()
            .HasMany(u => u.Transactions)
            .WithOne(t => t.User)
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Products: index por nombre
        modelBuilder.Entity<Product>()
            .HasIndex(p => p.Name);

        // AreaProduct: evita duplicados (AreaId + ProductId)
        modelBuilder.Entity<AreaProduct>()
            .HasIndex(ap => new { ap.AreaId, ap.ProductId })
            .IsUnique();

        // AreaProduct relations
        modelBuilder.Entity<AreaProduct>()
            .HasOne(ap => ap.Area)
            .WithMany()
            .HasForeignKey(ap => ap.AreaId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<AreaProduct>()
            .HasOne(ap => ap.Product)
            .WithMany()
            .HasForeignKey(ap => ap.ProductId)
            .OnDelete(DeleteBehavior.Cascade);

        // Sales
        modelBuilder.Entity<User>()
            .HasMany<Sale>()
            .WithOne(s => s.User)
            .HasForeignKey(s => s.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Sale>()
            .HasMany(s => s.Items)
            .WithOne(i => i.Sale)
            .HasForeignKey(i => i.SaleId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Shift>()
            .HasIndex(s => new { s.TenantId, s.CashierId, s.Status });

        modelBuilder.Entity<CardAudit>()
            .HasIndex(a => new { a.TenantId, a.ClientId, a.CreatedAt });

        modelBuilder.Entity<Recharge>()
            .Property(r => r.Amount)
            .HasPrecision(18, 2);

        modelBuilder.Entity<Recharge>()
            .Property(r => r.CardUid)
            .HasMaxLength(100)
            .IsRequired();

        modelBuilder.Entity<Recharge>()
            .Property(r => r.ReaderId)
            .HasMaxLength(100);

        modelBuilder.Entity<Recharge>()
            .Property(r => r.ClientId)
            .HasMaxLength(100);

        modelBuilder.Entity<Recharge>()
            .Property(r => r.PaymentMethod)
            .HasMaxLength(50)
            .IsRequired();

        modelBuilder.Entity<Recharge>()
            .Property(r => r.PaymentDetail)
            .HasMaxLength(200);

        modelBuilder.Entity<Recharge>()
            .Property(r => r.Comment)
            .HasMaxLength(500);

        modelBuilder.Entity<Recharge>()
            .HasIndex(r => new { r.TenantId, r.CashierId, r.ShiftId, r.CreatedAt });

        modelBuilder.Entity<Recharge>()
            .HasIndex(r => new { r.TenantId, r.CardUid, r.CreatedAt });

        modelBuilder.Entity<InventoryMovement>()
            .Property(r => r.Qty)
            .HasPrecision(18, 2);

        modelBuilder.Entity<InventoryMovement>()
            .Property(r => r.Direction)
            .HasMaxLength(50)
            .IsRequired();

        modelBuilder.Entity<InventoryMovement>()
            .Property(r => r.Comment)
            .HasMaxLength(500);

        modelBuilder.Entity<InventoryMovement>()
            .HasIndex(r => new { r.TenantId, r.AreaId, r.ProductId, r.CreatedAt });

        modelBuilder.Entity<BalanceTransfer>()
            .Property(r => r.Amount)
            .HasPrecision(18, 2);

        modelBuilder.Entity<BalanceTransfer>()
            .Property(r => r.Comment)
            .HasMaxLength(500);

        modelBuilder.Entity<BalanceTransfer>()
            .HasOne(r => r.FromUser)
            .WithMany()
            .HasForeignKey(r => r.FromUserId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<BalanceTransfer>()
            .HasOne(r => r.ToUser)
            .WithMany()
            .HasForeignKey(r => r.ToUserId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<BalanceTransfer>()
            .HasOne(r => r.Operator)
            .WithMany()
            .HasForeignKey(r => r.OperatorId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<BalanceTransfer>()
            .HasIndex(r => new { r.TenantId, r.FromUserId, r.ToUserId, r.CreatedAt });

        modelBuilder.Entity<AuditLog>()
            .Property(a => a.Action)
            .HasMaxLength(100)
            .IsRequired();

        modelBuilder.Entity<AuditLog>()
            .Property(a => a.Note)
            .HasMaxLength(1000);

        modelBuilder.Entity<AuditLog>()
            .Property(a => a.PreviousValue)
            .HasPrecision(18, 2);

        modelBuilder.Entity<AuditLog>()
            .Property(a => a.NewValue)
            .HasPrecision(18, 2);

        modelBuilder.Entity<AuditLog>()
            .HasIndex(a => new { a.TenantId, a.Action, a.CreatedAt });

        modelBuilder.Entity<AuditLog>()
            .HasIndex(a => new { a.TenantId, a.UserId, a.CreatedAt });
    }
}
