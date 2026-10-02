import fallbackImage from "./assets/unknown-pokemon.svg";
import petEffectImage from "./assets/pat-pat-pet-pet.gif";
import heartsEffectImage from "./assets/hearts.gif";
import boulderBadge from "./assets/badges/boulder.png";
import cascadeBadge from "./assets/badges/cascade.png";
import thunderBadge from "./assets/badges/thunder.png";
import rainbowBadge from "./assets/badges/rainbow.png";
import soulBadge from "./assets/badges/soul.png";
import marshBadge from "./assets/badges/marsh.png";
import volcanoBadge from "./assets/badges/volcano.png";
import earthBadge from "./assets/badges/earth.png";

type Pokemon = {
  id?: string;
  number: number;
  name: string;
  level?: number;
  hp?: number;
  maxHp?: number;
  experience?: number;
};

type PetAuthor = {
  did: string;
  name: string;
  avatar?: string;
};

type PetQueue = {
  requests: Promise<PetAuthor>[];
  running: boolean;
};

type GrowthRate = "fast" | "medium-fast" | "medium-slow" | "slow";

const badges = [
  { name: "Boulder Badge", image: boulderBadge },
  { name: "Cascade Badge", image: cascadeBadge },
  { name: "Thunder Badge", image: thunderBadge },
  { name: "Rainbow Badge", image: rainbowBadge },
  { name: "Soul Badge", image: soulBadge },
  { name: "Marsh Badge", image: marshBadge },
  { name: "Volcano Badge", image: volcanoBadge },
  { name: "Earth Badge", image: earthBadge },
];

const fastGrowth = new Set([35, 36, 39, 40, 113]);
const mediumSlowGrowth = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 29, 30, 31, 32, 33, 34,
  43, 44, 45, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 74, 75,
  76, 92, 93, 94, 151,
]);
const slowGrowth = new Set([
  58, 59, 72, 73, 90, 91, 102, 103, 111, 112, 120, 121, 127, 128, 129,
  130, 131, 142, 143, 144, 145, 146, 147, 148, 149, 150,
]);

function growthRateFor(number: number): GrowthRate {
  if (fastGrowth.has(number)) return "fast";
  if (mediumSlowGrowth.has(number)) return "medium-slow";
  if (slowGrowth.has(number)) return "slow";
  return "medium-fast";
}

function experienceAtLevel(level: number, growthRate: GrowthRate) {
  const cubed = level ** 3;

  switch (growthRate) {
    case "fast": return Math.floor(4 * cubed / 5);
    case "medium-slow": return Math.max(0, Math.floor(6 * cubed / 5 - 15 * level ** 2 + 100 * level - 140));
    case "slow": return Math.floor(5 * cubed / 4);
    default: return cubed;
  }
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function createBar(className: string, percentage: number) {
  const track = document.createElement("div");
  const fill = document.createElement("div");
  track.className = `meter ${className}`;
  fill.className = "meter-fill";
  fill.style.width = `${clampPercentage(percentage)}%`;
  track.append(fill);
  return track;
}

function createStatusPanel(pokemon: Pokemon) {
  const panel = document.createElement("div");
  panel.className = "status-panel";

  const heading = document.createElement("div");
  heading.className = "status-heading";
  const name = document.createElement("span");
  name.className = "pokemon-name";
  name.textContent = pokemon.name;
  const level = document.createElement("span");
  level.className = "pokemon-level";
  level.textContent = pokemon.level === undefined ? "" : `Lv.${pokemon.level}`;
  heading.append(name, level);

  const hpRow = document.createElement("div");
  hpRow.className = "status-row";
  const hpLabel = document.createElement("span");
  hpLabel.className = "status-label";
  hpLabel.textContent = "HP";
  const hpPercentage = pokemon.hp === undefined || !pokemon.maxHp
    ? 0
    : pokemon.hp / pokemon.maxHp * 100;
  const hpBar = createBar("hp-meter", hpPercentage);
  hpBar.dataset.health = hpPercentage <= 20 ? "low" : hpPercentage <= 50 ? "medium" : "high";
  hpRow.append(hpLabel, hpBar);

  const xpRow = document.createElement("div");
  xpRow.className = "status-row xp-row";
  const xpLabel = document.createElement("span");
  xpLabel.className = "status-label";
  xpLabel.textContent = "EXP";
  let xpPercentage = 0;
  let xpTitle = "Experience unavailable";

  if (pokemon.level !== undefined && pokemon.experience !== undefined) {
    if (pokemon.level >= 100) {
      xpPercentage = 100;
      xpTitle = "Maximum level";
    } else {
      const growthRate = growthRateFor(pokemon.number);
      const currentThreshold = experienceAtLevel(pokemon.level, growthRate);
      const nextThreshold = experienceAtLevel(pokemon.level + 1, growthRate);
      xpPercentage = (pokemon.experience - currentThreshold) / (nextThreshold - currentThreshold) * 100;
      xpTitle = `${Math.max(0, nextThreshold - pokemon.experience).toLocaleString()} XP to next level`;
    }
  }

  const xpBar = createBar("xp-meter", xpPercentage);
  xpBar.title = xpTitle;
  xpRow.append(xpLabel, xpBar);

  panel.append(heading, hpRow, xpRow);
  return panel;
}

// National Pokédex number -> image shown by the overlay.
const pokemonImages = new Map([
  [3, "https://media.giphy.com/media/EJOdcxm52IWNq/giphy.gif"],
  [25, "https://media.giphy.com/media/31vamYdZV5ISQ/giphy.gif"],
  [31, "https://media.giphy.com/media/nzhNS6v9jKwy97m3EN/giphy.gif"],
  [37, "https://media.giphy.com/media/eM3S83hIueaUEjbBYC/giphy.gif"],
  [38, "https://media.giphy.com/media/iheXjyc9btNm0WrFgz/giphy.gif"],
  [61, "https://media.giphy.com/media/m0kJGZioi44vtTcKrZ/giphy.gif"],
  [62, "https://media.giphy.com/media/v2Oo1HzfEr0nHHAM10/giphy.gif"],
  [83, "https://media.giphy.com/media/LVQ1HZOfl54YrODThX/giphy.gif"],
  [130, "https://media.giphy.com/media/CtTZ0k0UNLq084qRdj/giphy.gif"],

  // Pokémon ready to add to the team.
  [147, "https://media.giphy.com/media/uuaImYFJ82LRARUq2t/giphy.gif"],
  [148, "https://media.giphy.com/media/KaHrX0xJYqjdpKWwZa/giphy.gif"],
  [149, "https://media.giphy.com/media/Th9vH3DGtIC4etgI3K/giphy.gif"],
]);

const teamElement = document.querySelector("#team");
const badgesElement = document.querySelector("#badges");

if (!teamElement) throw new Error("Team element is missing");
if (!badgesElement) throw new Error("Badges element is missing");

let lastState = "";
let requestInFlight = false;
const teamFigures = new Map<string, HTMLElement>();
const pokemonKeysByName = new Map<string, string>();
const petQueues = new Map<string, PetQueue>();
const activePets = new Map<string, PetAuthor>();
const profileCache = new Map<string, Promise<PetAuthor>>();

function normalizedName(value: string) {
  return value.trim().toLowerCase();
}

function pokemonKey(pokemon: Pokemon) {
  return pokemon.id ?? `${pokemon.number}:${normalizedName(pokemon.name)}`;
}

function addPetEffect(figure: HTMLElement, author: PetAuthor) {
  figure.querySelectorAll(".pet-effect, .pet-hearts, .pet-author").forEach((element) => element.remove());

  const effect = document.createElement("img");
  effect.className = "pet-effect";
  effect.src = `${petEffectImage}?restart=${Date.now()}`;
  effect.alt = "";

  const attribution = document.createElement("div");
  attribution.className = "pet-author";
  if (author.avatar) {
    const avatar = document.createElement("img");
    avatar.className = "pet-author-avatar";
    avatar.src = author.avatar;
    avatar.alt = "";
    attribution.append(avatar);
  }
  figure.append(effect, attribution);

  setTimeout(() => {
    if (!figure.isConnected || !figure.querySelector(".pet-effect")) return;
    const hearts = document.createElement("img");
    hearts.className = "pet-hearts";
    hearts.src = `${heartsEffectImage}?restart=${Date.now()}`;
    hearts.alt = "";
    figure.append(hearts);
  }, 750);
}

function renderTeam(team: Pokemon[]) {
  teamElement.replaceChildren();
  teamFigures.clear();
  pokemonKeysByName.clear();
  const currentKeys = new Set<string>();

  for (const pokemon of team) {
    const key = pokemonKey(pokemon);
    currentKeys.add(key);
    const figure = document.createElement("figure");
    const image = document.createElement("img");

    image.src = pokemonImages.get(pokemon.number) ?? fallbackImage;
    image.alt = pokemon.name;
    image.addEventListener("error", () => {
      image.src = fallbackImage;
    }, { once: true });

    figure.append(image, createStatusPanel(pokemon));
    teamElement.append(figure);
    teamFigures.set(key, figure);
    pokemonKeysByName.set(normalizedName(pokemon.name), key);
    const activePet = activePets.get(key);
    if (activePet) addPetEffect(figure, activePet);
  }

  for (const key of petQueues.keys()) {
    if (!currentKeys.has(key)) petQueues.delete(key);
  }
  for (const key of activePets.keys()) {
    if (!currentKeys.has(key)) activePets.delete(key);
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function runPetQueue(key: string, queue: PetQueue) {
  queue.running = true;
  while (petQueues.get(key) === queue && queue.requests.length > 0) {
    const author = await queue.requests.shift()!;
    if (petQueues.get(key) !== queue) break;
    const figure = teamFigures.get(key);
    if (!figure) break;
    activePets.set(key, author);
    addPetEffect(figure, author);
    await wait(10000);
    if (petQueues.get(key) !== queue) break;
    if (activePets.get(key) === author) activePets.delete(key);
    teamFigures.get(key)?.querySelectorAll(".pet-effect, .pet-hearts, .pet-author").forEach((element) => element.remove());
  }
  if (petQueues.get(key) === queue) petQueues.delete(key);
}

function queuePet(name: string, author: Promise<PetAuthor>) {
  const key = pokemonKeysByName.get(normalizedName(name));
  if (!key) return;
  const queue = petQueues.get(key) ?? { requests: [], running: false };
  queue.requests.push(author);
  petQueues.set(key, queue);
  if (!queue.running) void runPetQueue(key, queue);
}

function getProfile(did: string) {
  let profile = profileCache.get(did);
  if (!profile) {
    profile = fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Profile request returned ${response.status}`);
        const data = await response.json() as { displayName?: string; handle?: string; avatar?: string };
        return {
          did,
          name: data.displayName?.trim() || (data.handle ? `@${data.handle}` : did),
          avatar: data.avatar,
        };
      })
      .catch(() => ({ did, name: did }));
    profileCache.set(did, profile);
  }
  return profile;
}

function handleChatMessage(record: { text?: unknown }, authorDid: unknown) {
  if (typeof record.text !== "string") return;
  if (typeof authorDid !== "string") return;
  const match = record.text.match(/^\s*!pet\s+(.+?)\s*$/i);
  if (!match) return;
  queuePet(match[1], getProfile(authorDid));
}

const jetstreamHosts = [
  "jetstream2.us-east.bsky.network",
  "jetstream1.us-east.bsky.network",
  "jetstream2.us-west.bsky.network",
  "jetstream1.us-west.bsky.network",
];

function connectChat() {
  const streamerDid = new URLSearchParams(location.search).get("streamer");
  if (!streamerDid?.startsWith("did:")) {
    console.warn("Chat interactions disabled: add ?streamer=did:... to the overlay URL");
    return;
  }

  let hostIndex = 0;
  let reconnectDelay = 1000;

  const connect = () => {
    const host = jetstreamHosts[hostIndex % jetstreamHosts.length];
    const socket = new WebSocket(`wss://${host}/subscribe?wantedCollections=place.stream.chat.message`);

    socket.addEventListener("open", () => {
      reconnectDelay = 1000;
      console.info(`Chat interactions connected via ${host}`);
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        const commit = message?.commit;
        if (message?.kind !== "commit" || commit?.operation !== "create") return;
        if (commit.collection !== "place.stream.chat.message") return;
        if (commit.record?.streamer !== streamerDid) return;
        void handleChatMessage(commit.record, message.did);
      } catch {
        // Ignore malformed or unrelated Jetstream events.
      }
    });

    socket.addEventListener("close", () => {
      hostIndex++;
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
    });
  };

  connect();
}

function renderBadges(mask: number) {
  badgesElement.replaceChildren();

  badges.forEach((badge, index) => {
    const image = document.createElement("img");
    const owned = (mask & (1 << index)) !== 0;
    image.className = owned ? "badge owned" : "badge unowned";
    image.src = badge.image;
    image.alt = owned ? badge.name : `${badge.name} not yet obtained`;
    image.title = badge.name;
    badgesElement.append(image);
  });
}

async function refreshTeam() {
  if (requestInFlight) return;
  requestInFlight = true;

  try {
    const [teamResponse, badgesResponse] = await Promise.all([
      fetch("/team.json", { cache: "no-store" }),
      fetch("/badges.json", { cache: "no-store" }),
    ]);
    if (!teamResponse.ok) throw new Error(`team.json returned ${teamResponse.status}`);
    if (!badgesResponse.ok) throw new Error(`badges.json returned ${badgesResponse.status}`);

    const team = await teamResponse.json() as Pokemon[];
    const { mask } = await badgesResponse.json() as { mask: number };
    const serializedState = JSON.stringify({ team, mask });
    if (serializedState === lastState) return;

    renderTeam(team);
    renderBadges(mask);
    lastState = serializedState;
  } catch (error) {
    console.error("Could not refresh the Pokémon team", error);
  } finally {
    requestInFlight = false;
  }
}

await refreshTeam();
setInterval(refreshTeam, 1000);
connectChat();
