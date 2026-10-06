import type { BadgeDefinition } from "@stream-overlay/pokemon-ui";
import zephyr from "../../../assets/badges/crystal/zephyr.png";
import hive from "../../../assets/badges/crystal/hive.png";
import plain from "../../../assets/badges/crystal/plain.png";
import fog from "../../../assets/badges/crystal/fog.png";
import mineral from "../../../assets/badges/crystal/mineral.png";
import storm from "../../../assets/badges/crystal/storm.png";
import glacier from "../../../assets/badges/crystal/glacier.png";
import rising from "../../../assets/badges/crystal/rising.png";
import boulder from "../../../assets/badges/boulder.png";
import cascade from "../../../assets/badges/cascade.png";
import thunder from "../../../assets/badges/thunder.png";
import rainbow from "../../../assets/badges/rainbow.png";
import soul from "../../../assets/badges/soul.png";
import marsh from "../../../assets/badges/marsh.png";
import volcano from "../../../assets/badges/volcano.png";
import earth from "../../../assets/badges/earth.png";

export const crystalBadges: BadgeDefinition[] = [
  ["zephyr", zephyr], ["hive", hive], ["plain", plain], ["fog", fog],
  ["storm", storm], ["mineral", mineral], ["glacier", glacier], ["rising", rising],
  ["boulder", boulder], ["cascade", cascade], ["thunder", thunder], ["rainbow", rainbow],
  ["soul", soul], ["marsh", marsh], ["volcano", volcano], ["earth", earth],
].map(([id, image]) => ({ id: id!, name: `${id![0]!.toUpperCase()}${id!.slice(1)} Badge`, image: image! }));
