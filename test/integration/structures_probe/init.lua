-- Disposable engine test. A single-biome flat world isolates terrain selection
-- from the engine's noise so the end-to-end assertion is deterministic.
local style = core.settings:get("structures_probe_style") or "desert"
local biome = style == "tundra" and "tundra" or "desert"
local ground = style == "tundra" and "default:dirt_with_snow" or "default:sand"
core.clear_registered_biomes()
core.clear_registered_decorations()
core.register_biome({
    name = biome, node_top = ground, depth_top = 1, node_filler = ground, depth_filler = 2,
    y_min = -31000, y_max = 31000, heat_point = 50, humidity_point = 50,
})

local path = core.get_modpath("minemine_structures")
local api = dofile(path .. "/planner.lua")
local village = assert(loadfile(path .. "/village.lua"))(path, api)

local function check_workshop_permissions()
    local commands = {"structure_preview", "structure_return", "structure_export"}
    for _, name in ipairs(commands) do
        assert(core.registered_chatcommands[name].privs.server, "Multiplayer workshop must require an admin")
    end

    -- Exercise the solo registration policy with the real module, without
    -- replacing the native server's workshop or running its callbacks twice.
    local is_singleplayer = core.is_singleplayer
    local register_command = core.register_chatcommand
    local register_loaded = core.register_on_mods_loaded
    local solo = {}
    core.is_singleplayer = function() return true end
    core.register_chatcommand = function(name, def) solo[name] = def end
    core.register_on_mods_loaded = function() end
    local ok, err = pcall(assert(loadfile(path .. "/workshop.lua")), path)
    core.is_singleplayer = is_singleplayer
    core.register_chatcommand = register_command
    core.register_on_mods_loaded = register_loaded
    assert(ok, err)
    for _, name in ipairs(commands) do
        assert(solo[name] and not next(solo[name].privs), "Solo workshop must accept the local player without admin privileges")
    end
    core.log("action", "[structures_probe] Workshop permissions verified for solo and multiplayer")
end

local function same_bed(bottom)
    local node = core.get_node(bottom)
    local top = core.get_node(vector.add(bottom, core.facedir_to_dir(node.param2)))
    assert(top.name == node.name:gsub("_bottom$", "_top") and top.param2 == node.param2)
end

local function finish(style, homes, chests, fixtures)
    core.log("action", ("[structures_probe] PASS %s: %d homes, %d chests, %d biome fixtures"):format(style, #homes, #chests, #fixtures))
    core.request_shutdown("Structures probe complete")
end

local function check_workshop(on_complete)
    local name = "structures_probe_visitor"
    local pos = vector.new(10, 13, 12)
    local old_get_player = core.get_player_by_name
    local exported = false
    local visit = {
        get_pos = function() return pos end,
        set_look_horizontal = function() end,
        set_pos = function(_, new_pos)
            pos = new_pos
            if exported then return end
            core.after(0, function()
                local y, z = 4096, -16000
                assert(pos.x == 0 and pos.y == y + 1)
                for i = 0, 1 do
                    local a = {x = i * 60 - 24, y = y, z = z - 12}
                    local b = {x = i * 60 + 24, y = y + 9, z = z + 12}
                    local plan = village.definition.plan("desert", PcgRandom(42 + i, 9001))
                    local beds = core.find_nodes_in_area(a, b, {"beds:bed_bottom", "beds:fancy_bed_bottom"})
                    assert(#beds == plan.counts.homes, "Preview diverged from its seed")
                    for _, chest in ipairs(core.find_nodes_in_area(a, b, {"default:chest"})) do
                        assert(core.get_meta(chest):get_inventory():is_empty("main"))
                    end
                    if i == 0 then
                        local home = plan.plots[2]
                        local low, high = api.bounds(home, 0, y, z)
                        local param = ("demo %d,%d,%d %d,%d,%d"):format(low.x, low.y, low.z, high.x, high.y, high.z)
                        local export = core.registered_chatcommands.structure_export.func
                        local ok, reason = export(name, param)
                        assert(ok, reason)
                        assert(not export(name, param), "Export overwrote an existing schematic")
                        local schematic = assert(core.read_schematic(core.get_worldpath() .. "/structure_exports/demo.mts", {}))
                        assert(schematic.size.y == home.height)
                        local has_bed
                        for _, node in ipairs(schematic.data) do
                            if core.get_item_group(node.name, "bed") == 1 then has_bed = true end
                        end
                        assert(has_bed, "Export must keep the bed blocks")
                    end
                end
                exported = true
                assert(core.registered_chatcommands.structure_return.func(name))
                assert(pos.x == 10 and pos.y == 13 and pos.z == 12)
                core.get_player_by_name = old_get_player
                core.log("action", "[structures_probe] Two gallery previews and MTS export/return verified")
                on_complete()
            end)
        end,
    }
    core.get_player_by_name = function(player)
        return player == name and visit or old_get_player(player)
    end
    assert(core.registered_chatcommands.structure_preview.func(name, "desert 42 2"))
end

core.register_on_mods_loaded(function()
    dofile(core.get_modpath("structures_probe") .. "/sprint.lua")
    check_workshop_permissions()
    local day = assert(core.registered_chatcommands.day)
    local time = core.get_timeofday()
    assert(day.privs.settime and not day.func("", "extra") and day.func("", ""))
    assert(math.abs(core.get_timeofday() - 0.5) < 0.0001, "Day command should set noon")
    core.set_timeofday(time)
    local totals = {}
    for palette in pairs(village.styles) do
        local sizes, occupations = {}, {}
        for seed = 0, 159 do
            local plan = village.definition.plan(palette, PcgRandom(seed, 9001))
            local seed_again = village.definition.plan(palette, PcgRandom(seed, 9001))
            assert(core.serialize_schematic(plan.plots[2].schematic, "mts", {})
                == core.serialize_schematic(seed_again.plots[2].schematic, "mts", {}), "Layout must repeat by seed")
            assert(#plan.plots == plan.counts.homes + plan.counts.occupations + 1)
            assert(plan.counts.homes >= 1 and plan.counts.homes <= 6)
            assert(plan.counts.occupations >= 0 and plan.counts.occupations <= 3)
            sizes[plan.counts.homes], occupations[plan.counts.occupations] = true, true
            for i, plot in ipairs(plan.plots) do
                local beds = 0
                for _, node in ipairs(plot.schematic.data) do
                    assert(core.registered_nodes[node.name], "Unknown structure node " .. node.name)
                    if core.get_item_group(node.name, "bed") == 1 then beds = beds + 1 end
                end
                if i > 1 and i <= plan.counts.homes + 1 then assert(beds == 1, "Every home needs a bed") end
            end
        end
        for n = 1, 6 do assert(sizes[n]) end
        for n = 0, 3 do assert(occupations[n]) end
        totals[#totals + 1] = palette
    end
    core.log("action", "[structures_probe] 960 repeated layouts checked in " .. table.concat(totals, ", "))

    local p1, p2 = {x = -32, y = 10, z = -32}, {x = 47, y = 24, z = 47}
    core.after(0, function()
        core.emerge_area(p1, p2, function(_, action, remaining)
            assert(action ~= core.EMERGE_CANCELLED and action ~= core.EMERGE_ERRORED)
            if remaining ~= 0 then return end
            core.after(0, function()
                core.load_area(p1, p2)
                local homes = core.find_nodes_in_area(p1, p2, {"beds:bed_bottom", "beds:fancy_bed_bottom"})
                local chests = core.find_nodes_in_area(p1, p2, {"default:chest"})
                local feature = style == "tundra" and "minemine_structures:hearth" or "default:water_source"
                local fixtures = core.find_nodes_in_area(p1, p2, {feature})
                local empty = core.settings:get_bool("structures_probe_empty", false)
                if empty then
                    assert(#homes == 0 and #chests == 0 and #fixtures == 0, "Disabled world generated a village")
                else
                    assert(#homes >= 1 and #homes <= 6, "Village did not place a valid number of homes: " .. #homes)
                    assert(#chests >= #homes and #chests <= #homes + 3, "Unexpected number of village chests: " .. #chests)
                    assert(#fixtures == (style == "tundra" and #homes + 1 or 1), "Village is missing its biome fixture")
                    for _, bed in ipairs(homes) do same_bed(bed) end
                    local stocked = 0
                    for _, chest in ipairs(chests) do
                        local inv = core.get_meta(chest):get_inventory()
                        assert(inv:get_size("main") == 32)
                        local stacks = 0
                        for _, stack in ipairs(inv:get_list("main")) do
                            if not stack:is_empty() then
                                stacks = stacks + 1
                                assert(stack:get_count() <= 5 and stack:get_name() ~= "default:diamond")
                            end
                        end
                        assert(stacks <= 2)
                        if stacks > 0 then stocked = stocked + 1 end
                    end
                    assert(stocked > 0, "Seeded village lost its chest loot")
                    core.log("action", ("[structures_probe] %s loot: %d/%d chests stocked"):format(style, stocked, #chests))
                end
                if style == "desert" and not empty then
                    check_workshop(function() finish(style, homes, chests, fixtures) end)
                else
                    finish(style, homes, chests, fixtures)
                end
            end)
        end)
    end)
end)
