import "./styles.css";
import { startGameApp } from "./app/gameApp.js";
import { setupDiscordBridge } from "./discord/bridge.js";

const discord = await setupDiscordBridge();

document.body.dataset.runtime = discord.mode;
window.addEventListener("beforeunload", () => {
  discord.dispose?.();
});

startGameApp({ discord });
