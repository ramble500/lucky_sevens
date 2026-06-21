import "./styles.css";
import { startGameApp } from "./app/gameApp.js";
import { setupDiscordBridge } from "./discord/bridge.js";

function syncViewportMetrics() {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || window.innerWidth);
  const height = Math.round(viewport?.height || window.innerHeight);

  document.documentElement.style.setProperty("--app-width", `${width}px`);
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  document.body.dataset.orientation = width > height ? "landscape" : "portrait";
  document.body.dataset.viewport = width <= 720 ? "compact" : width <= 1080 ? "tablet" : "desktop";
}

const discord = await setupDiscordBridge();

syncViewportMetrics();
document.body.dataset.runtime = discord.mode;
window.addEventListener("resize", syncViewportMetrics);
window.visualViewport?.addEventListener("resize", syncViewportMetrics);
window.addEventListener("beforeunload", () => {
  discord.dispose?.();
});

startGameApp({ discord });
