// The wrapper versions installed packs by URL pathname. Put the content hash
// in the path so an existing browser gets new mods without losing its world.
export function configureGamePack(launcher, build, pageUrl = location.href) {
  if (build.gamePack === undefined) return; // Legacy engine artifact.
  if (!/^[a-f0-9]{12}$/.test(build.release) ||
      !/^[a-f0-9]{12}\/packs\/[a-f0-9]{16}\/minetest\.pack$/.test(build.gamePack) ||
      !build.gamePack.startsWith(build.release + '/')) throw new Error('Invalid game pack in the engine manifest.');
  launcher.setPacksDir(new URL(build.gamePack.replace(/\/minetest\.pack$/, ''), pageUrl).href, false);
}
