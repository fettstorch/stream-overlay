import { createApp } from "vue";
import CloudCrystalOverlay from "./CloudCrystalOverlay.vue";
const app = createApp(CloudCrystalOverlay);
app.mount("#app");
addEventListener("pagehide", () => app.unmount(), { once: true });
