local world = core.get_worldpath()
local elapsed = 0

local function capture(label)
    local players = core.get_connected_players()
    local positions = {}
    for _, player in ipairs(players) do
        positions[player:get_player_name()] = player:get_pos()
    end
    local snapshot = core.write_json({
        count = #players,
        observed_at = os.time(),
        positions = positions,
    })
    if not snapshot or not core.safe_file_write(world .. "/minemine-load-position-" .. label .. ".json", snapshot .. "\n") then
        core.log("error", "MineMine load probe could not write the " .. label .. " position snapshot")
    end
end

core.register_globalstep(function(dtime)
    elapsed = elapsed + dtime
    if elapsed < 0.25 then return end
    elapsed = 0
    for _, label in ipairs({ "before", "after" }) do
        local request = world .. "/minemine-load-position-" .. label .. ".request"
        local file = io.open(request, "r")
        if file then
            file:close()
            os.remove(request)
            capture(label)
        end
    end
end)
