local world = core.get_worldpath()
local elapsed = 0

local function prepare_movement()
    local request = world .. "/minemine-load-prepare.json"
    local file = io.open(request, "r")
    if not file then return end
    local raw = file:read(4097)
    file:close()
    os.remove(request)
    local config = raw and #raw <= 4096 and core.parse_json(raw)
    local names = config and config.players
    local result = { ready = false, count = 0 }
    if type(names) == "table" and #names == 8 then
        local actors = {}
        local seen = {}
        for _, name in ipairs(names) do
            if type(name) ~= "string" or not name:match("^w_[0-9a-f]+$") or #name ~= 19 or seen[name] then break end
            seen[name] = true
            local player = core.get_player_by_name(name)
            if not player then break end
            table.insert(actors, player)
        end
        if #actors == 8 then
            local spawn = actors[1]:get_pos()
            local origin_x = math.floor(spawn.x + 0.5)
            local origin_z = math.floor(spawn.z + 0.5) + 12
            local floor_y = math.floor(spawn.y - 1.5 + 0.5)
            for index, player in ipairs(actors) do
                local x = origin_x + index * 4
                for dx = -1, 1 do
                    for dz = -1, 1 do
                        core.set_node({ x = x + dx, y = floor_y, z = origin_z + dz }, { name = "default:stone" })
                        for dy = 1, 3 do
                            core.set_node({ x = x + dx, y = floor_y + dy, z = origin_z + dz }, { name = "air" })
                        end
                    end
                end
                player:set_pos({ x = x, y = floor_y + 1.5, z = origin_z })
            end
            result = { ready = true, count = #actors }
        end
    end
    core.safe_file_write(world .. "/minemine-load-prepare-result.json", core.write_json(result) .. "\n")
end

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
    prepare_movement()
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
