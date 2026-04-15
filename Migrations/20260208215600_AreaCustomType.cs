using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cashless.Api.Migrations
{
    /// <inheritdoc />
    public partial class AreaCustomType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CustomType",
                table: "Areas",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AreaProducts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    AreaId = table.Column<int>(type: "INTEGER", nullable: false),
                    ProductId = table.Column<int>(type: "INTEGER", nullable: false),
                    PriceOverride = table.Column<decimal>(type: "TEXT", nullable: true),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AreaProducts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AreaProducts_Areas_AreaId",
                        column: x => x.AreaId,
                        principalTable: "Areas",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_AreaProducts_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OperatorAreas",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    OperatorId = table.Column<int>(type: "INTEGER", nullable: false),
                    AreaId = table.Column<int>(type: "INTEGER", nullable: false),
                    Role = table.Column<int>(type: "INTEGER", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperatorAreas", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OperatorAreas_Areas_AreaId",
                        column: x => x.AreaId,
                        principalTable: "Areas",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OperatorAreas_Operators_OperatorId",
                        column: x => x.OperatorId,
                        principalTable: "Operators",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AreaProducts_AreaId",
                table: "AreaProducts",
                column: "AreaId");

            migrationBuilder.CreateIndex(
                name: "IX_AreaProducts_ProductId",
                table: "AreaProducts",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatorAreas_AreaId",
                table: "OperatorAreas",
                column: "AreaId");

            migrationBuilder.CreateIndex(
                name: "IX_OperatorAreas_OperatorId",
                table: "OperatorAreas",
                column: "OperatorId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AreaProducts");

            migrationBuilder.DropTable(
                name: "OperatorAreas");

            migrationBuilder.DropColumn(
                name: "CustomType",
                table: "Areas");
        }
    }
}
