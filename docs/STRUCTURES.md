# Generated structures

MineMine adds villages and forest treehouses to newly generated terrain. Existing blocks and saved progress are left in place. Lua plans are seeded and run on Luanti's map generator thread, so solo and native multiplayer use the same content.

Villages have **1–6 homes with beds** and **0–3 workplaces** selected from a shop, chapel, smithy and barn. Roads connect the buildings to a small square. Home dimensions, rooflines, lot assignments, beds, occupations and chest contents vary by seed. Chests may be empty or hold up to two modest stacks such as bread, torches, seed or coal. Loot does not refill when the chest is reopened. The shops are scenery and storage for now; there are no villagers or trades.

| Style | Biomes | Features |
| --- | --- | --- |
| Plains | Grassland and deciduous forest | Wood and log houses, gravel lanes |
| Pine | Coniferous forest | Pine buildings with masonry roofs |
| Tundra | Taiga, snowy grassland, tundra and tundra highland | Stone houses with hearths that do not spread |
| Desert | Desert, sandstone desert and cold desert | Sandstone houses and a roofed well |
| Savanna | Savanna | Acacia and desert stone |
| Jungle | Rainforest | Jungle wood and mossy masonry |

## Tune how often villages appear

- `minemine_village_chance = 10` in `minetest.conf` gives each eligible surface generation chunk a 10% attempt chance. A biome can cover many chunks; this is not one village per ten contiguous biome regions.
- Edit `game/mods/minemine_structures/config.lua` to change the palette for a biome, add a biome or override its attempt chance: `grassland = {style = "plains", chance = 20}`. Use `chance = 0` to exclude that biome.
- Ocean, river and steep plots are rejected. The generator tries seven sites, retries with a smaller layout when space is tight, and places at most one structure in a chunk. Houses, paths and foundations are kept inside the new chunk; the actual rate is lower than the attempt rate.
- Set `minemine_structures_enabled = false` to turn off new generation.

## Forest treehouses

Rare tall pine trees in Taiga and jungle trees in Rainforest have a roofed wooden platform 12–15 blocks above the ground, a ladder leading through its floor, fence windows and a stocked chest. A treehouse attempts generation in 4% of eligible chunks; villages take priority when both fit. No treehouses generate in other biomes. Change `minemine_treehouse_chance` (0–100) to adjust the attempt chance.

## Compare lots of variations

Press **T** to open chat in solo mode:

```text
/structure_preview desert 42 6
/structure_preview tundra 42 6
/structure_preview taiga 42 3
/structure_preview rainforest 42 3
/structure_return
```

The commands show six consecutive seeds in an in-world gallery, left to right when facing the houses. Look at a lamp on the approach to read its seed and counts. Request up to 12 at once. Reusing a seed and style repeats the same design; preview chests stay empty. Add `compact` after the count to preview the smaller layouts. The native server's info log records each village's style, seed, and whether it used the compact layout. The gallery is built high above the map in a separate area of the same world. Use a disposable world for design work or set `minemine_structures_workshop = true` on a private native server and grant yourself the server privilege.

To try a Lua change in the browser without rebuilding WebAssembly:

```sh
node scripts/repack-playtest.mjs public/engine runtime/workshop-engine
PLAYTEST_ENGINE_DIR=runtime/workshop-engine PAGES_SITE_DIR=runtime/workshop-site node scripts/prepare-pages-playtest.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory runtime/workshop-site
```

Open `http://localhost:8000/play/`. Use a new output directory after changing the templates. The game pack URL changes with the content, so returning browsers can install the new mod while keeping their existing saves. New villages appear only in fresh terrain.

## Build and export a house

Yes, example houses help. The most useful first examples would be a **small stone tundra house with a fireplace** or a **sandstone desert house**. Even a screenshot and rough dimensions are useful; a Luanti schematic lets us place the exact design in the gallery and in generated villages.

1. Build in desktop Luanti using Minetest Game and the MineMine structures mod. Enable the coordinates in the debug display (**F5**) or use the in-game node position shown in debug mode when pointing at a corner.
2. Keep the footprint **5, 7 or 9 blocks wide (X)** and **5 or 7 deep (Z)**, with a **4–8 block** height including the floor and roof. Select the full rectangular volume: the bottom layer is the floor, the center of the low-Z face is the door, and the house contains a complete bed. Include air within the box and leave the terrain below the floor out.
3. Open chat and run `/structure_export tundra_cottage 12,4,10 18,10,16`, replacing the coordinates with opposite corners. The desktop world directory gets `structure_exports/tundra_cottage.mts`. The current browser playtest has no file download for exports; use desktop Luanti when you want an actual file.
4. Put the file in `game/mods/minemine_structures/schematics/` and add `{file = "tundra_cottage.mts", style = "tundra", weight = 2}` to `templates.lua`. The gallery then draws from both procedural homes and your imported designs. Weights are relative to a combined weight of four for the procedural generator.

The export saves blocks and orientation, not inventories, player data, node metadata or entities. Empty stock chests in imported homes get the same random loot as procedural homes. Stick to stock Minetest Game nodes unless the corresponding mod ships in both the browser and server.

## Add another structure type

Use `planner.lua` to create a plan with odd-width and odd-depth schematic plots, foundations and optional road cells. Register a definition in `mapgen.lua` with an ID, allowed biome rules, a default percent chance and a `plan(style, rng)` function. The planner checks the site's biome, slope and chunk bounds before any blocks are written. Registration order breaks ties when multiple types pass in the same chunk. Keep your planner independent of live map state and use the supplied random generator to preserve reproducibility.

For a new native world, `scripts/setup-world.mjs` installs and enables the mod. For an existing native world, with the server stopped, copy `game/mods/minemine_structures` into its `worldmods/` and set `load_mod_minemine_structures = true` in `world.mt`. This changes only subsequently generated terrain.
