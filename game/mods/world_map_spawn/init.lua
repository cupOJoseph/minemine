-- The Minetest Game spawn mod chooses the default new-player location. Record
-- that choice only after it has actually spawned a new player in this world.
-- This file contains no player identity or position tracking.
local output = core.get_worldpath() .. "/world-map-spawn.json"
local previous

core.register_on_newplayer(function(player)
    local point = spawn.get_default_pos()
    if not point then return end -- Engine fallback has no reliable default to publish.
    local actual = player:get_pos()
    if not actual or math.abs(actual.x - point.x) > 1 or
            math.abs(actual.z - point.z) > 1 then return end
    local x, z = math.floor(point.x), math.floor(point.z)
    if math.abs(x) > 30927 or math.abs(z) > 30927 then return end
    local payload = assert(core.write_json({ version = 1, x = x, z = z })) .. "\n"
    if payload ~= previous then
        if core.safe_file_write(output, payload) then
            previous = payload
        else
            core.log("error", "world_map_spawn: could not update default spawn projection")
        end
    end
end)
