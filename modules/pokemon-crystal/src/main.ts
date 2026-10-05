import { createApp } from "vue";
import App from "../../pokemon-blue/src/App.vue";
import { crystalBadges } from "./badges.ts";
createApp(App, { moduleId: "pokemon-crystal", badgeDefinitions: crystalBadges }).mount("#app");
