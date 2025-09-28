using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReceiverIdToMessage_v3 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.AddColumn<int>(
        name: "ReceiverId",
        table: "Messages",
        type: "INTEGER",
        nullable: true);

    migrationBuilder.Sql(@"UPDATE ""Messages"" SET ""ReceiverId"" = ""UserId"" WHERE ""ReceiverId"" IS NULL;");

    migrationBuilder.AlterColumn<int>(
        name: "ReceiverId",
        table: "Messages",
        type: "INTEGER",
        nullable: false,
        oldClrType: typeof(int),
        oldType: "INTEGER",
        oldNullable: true);

    migrationBuilder.CreateIndex(
        name: "IX_Messages_ReceiverId",
        table: "Messages",
        column: "ReceiverId");

    migrationBuilder.AddForeignKey(
        name: "FK_Messages_Users_ReceiverId",
        table: "Messages",
        column: "ReceiverId",
        principalTable: "Users",
        principalColumn: "Id",
        onDelete: ReferentialAction.Restrict);
}


        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Messages_Users_ReceiverId",
                table: "Messages");

            migrationBuilder.DropIndex(
                name: "IX_Messages_ReceiverId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "ReceiverId",
                table: "Messages");
        }
    }
}
