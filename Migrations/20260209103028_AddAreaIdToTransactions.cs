using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cashless.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAreaIdToTransactions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AreaProducts_AreaId",
                table: "AreaProducts");

            migrationBuilder.AddColumn<int>(
                name: "AreaId",
                table: "Transactions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DonationAmount",
                table: "Transactions",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "DonationProjectId",
                table: "Transactions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OperatorId",
                table: "Transactions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SaleId",
                table: "Transactions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "TipAmount",
                table: "Transactions",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "AreaId",
                table: "Sales",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DonationAmount",
                table: "Sales",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "DonationProjectId",
                table: "Sales",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OperatorId",
                table: "Sales",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Subtotal",
                table: "Sales",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "TipAmount",
                table: "Sales",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateIndex(
                name: "IX_Transactions_SaleId",
                table: "Transactions",
                column: "SaleId");

            migrationBuilder.CreateIndex(
                name: "IX_AreaProducts_AreaId_ProductId",
                table: "AreaProducts",
                columns: new[] { "AreaId", "ProductId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Transactions_Sales_SaleId",
                table: "Transactions",
                column: "SaleId",
                principalTable: "Sales",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Transactions_Sales_SaleId",
                table: "Transactions");

            migrationBuilder.DropIndex(
                name: "IX_Transactions_SaleId",
                table: "Transactions");

            migrationBuilder.DropIndex(
                name: "IX_AreaProducts_AreaId_ProductId",
                table: "AreaProducts");

            migrationBuilder.DropColumn(
                name: "AreaId",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "DonationAmount",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "DonationProjectId",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "OperatorId",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "SaleId",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "TipAmount",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "AreaId",
                table: "Sales");

            migrationBuilder.DropColumn(
                name: "DonationAmount",
                table: "Sales");

            migrationBuilder.DropColumn(
                name: "DonationProjectId",
                table: "Sales");

            migrationBuilder.DropColumn(
                name: "OperatorId",
                table: "Sales");

            migrationBuilder.DropColumn(
                name: "Subtotal",
                table: "Sales");

            migrationBuilder.DropColumn(
                name: "TipAmount",
                table: "Sales");

            migrationBuilder.CreateIndex(
                name: "IX_AreaProducts_AreaId",
                table: "AreaProducts",
                column: "AreaId");
        }
    }
}
