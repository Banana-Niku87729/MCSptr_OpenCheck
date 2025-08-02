const { Rcon } = require("rcon-client");
const fs = require("fs");

const filePath = "public/open.json"; // Renderのpublicフォルダに置く

async function checkWorldStatus() {
  let result = { status: "未開放" };

  try {
    const rcon = await Rcon.connect({
      host: "127.0.0.1",
      port: 19132,
      password: "your_rcon_password"
    });

    try {
      await rcon.send("scoreboard players test Bananakundao mente 1");
      result.status = "メンテ中";
    } catch {
      try {
        await rcon.send("scoreboard players test Bananakundao mente 0");
        result.status = "開放中";
      } catch {
        result.status = "未開放";
      }
    }

    await rcon.end();
  } catch (err) {
    console.error("RCON接続失敗:", err);
  }

  fs.writeFileSync(filePath, JSON.stringify(result));
}

setInterval(checkWorldStatus, 5000); // 5秒ごとにチェック
