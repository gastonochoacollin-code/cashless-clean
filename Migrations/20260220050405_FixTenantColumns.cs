using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cashless.Api.Migrations
{
    /// <inheritdoc />
    public partial class FixTenantColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Transactions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Sales",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "SaleItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Products",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Operators",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "OperatorAreas",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Cards",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "Areas",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "AreaProducts",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_Users_TenantId",
                table: "Users",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Transactions_TenantId",
                table: "Transactions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Sales_TenantId",
                table: "Sales",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_SaleItems_TenantId",
                table: "SaleItems",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_TenantId",
                table: "Products",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Operators_TenantId",
                table: "Operators",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatorAreas_TenantId",
                table: "OperatorAreas",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Cards_TenantId",
                table: "Cards",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Areas_TenantId",
                table: "Areas",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_AreaProducts_TenantId",
                table: "AreaProducts",
                column: "TenantId");

            migrationBuilder.AddForeignKey(
                name: "FK_AreaProducts_Tenants_TenantId",
                table: "AreaProducts",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Areas_Tenants_TenantId",
                table: "Areas",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Cards_Tenants_TenantId",
                table: "Cards",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_OperatorAreas_Tenants_TenantId",
                table: "OperatorAreas",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Operators_Tenants_TenantId",
                table: "Operators",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Products_Tenants_TenantId",
                table: "Products",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_SaleItems_Tenants_TenantId",
                table: "SaleItems",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Sales_Tenants_TenantId",
                table: "Sales",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Transactions_Tenants_TenantId",
                table: "Transactions",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Tenants_TenantId",
                table: "Users",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AreaProducts_Tenants_TenantId",
                table: "AreaProducts");

            migrationBuilder.DropForeignKey(
                name: "FK_Areas_Tenants_TenantId",
                table: "Areas");

            migrationBuilder.DropForeignKey(
                name: "FK_Cards_Tenants_TenantId",
                table: "Cards");

            migrationBuilder.DropForeignKey(
                name: "FK_OperatorAreas_Tenants_TenantId",
                table: "OperatorAreas");

            migrationBuilder.DropForeignKey(
                name: "FK_Operators_Tenants_TenantId",
                table: "Operators");

            migrationBuilder.DropForeignKey(
                name: "FK_Products_Tenants_TenantId",
                table: "Products");

            migrationBuilder.DropForeignKey(
                name: "FK_SaleItems_Tenants_TenantId",
                table: "SaleItems");

            migrationBuilder.DropForeignKey(
                name: "FK_Sales_Tenants_TenantId",
                table: "Sales");

            migrationBuilder.DropForeignKey(
                name: "FK_Transactions_Tenants_TenantId",
                table: "Transactions");

            migrationBuilder.DropForeignKey(
                name: "FK_Users_Tenants_TenantId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Users_TenantId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Transactions_TenantId",
                table: "Transactions");

            migrationBuilder.DropIndex(
                name: "IX_Sales_TenantId",
                table: "Sales");

            migrationBuilder.DropIndex(
                name: "IX_SaleItems_TenantId",
                table: "SaleItems");

            migrationBuilder.DropIndex(
                name: "IX_Products_TenantId",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_Operators_TenantId",
                table: "Operators");

            migrationBuilder.DropIndex(
                name: "IX_OperatorAreas_TenantId",
                table: "OperatorAreas");

            migrationBuilder.DropIndex(
                name: "IX_Cards_TenantId",
                table: "Cards");

            migrationBuilder.DropIndex(
                name: "IX_Areas_TenantId",
                table: "Areas");

            migrationBuilder.DropIndex(
                name: "IX_AreaProducts_TenantId",
                table: "AreaProducts");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Sales");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "SaleItems");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Operators");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "OperatorAreas");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Cards");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Areas");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "AreaProducts");
        }
    }
}
