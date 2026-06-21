import "./styles.css";
import { startGameApp } from "./app/gameApp.js";
import { setupDiscordBridge } from "./discord/bridge.js";

function syncViewportMetrics() {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || window.innerWidth);
  const height = Math.round(viewport?.height || window.innerHeight);
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  let viewportClass = "desktop";

  if (shortSide <= 520) {
    viewportClass = "compact";
  } else if (shortSide <= 900 || longSide <= 1366) {
    viewportClass = "tablet";
  }

  document.documentElement.style.setProperty("--app-width", `${width}px`);
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  document.body.dataset.orientation = width > height ? "landscape" : "portrait";
  document.body.dataset.viewport = viewportClass;
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
