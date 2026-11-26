local style = core.settings:get("treehouse_probe_biome")
local expected = core.settings:get_bool("treehouse_probe_expected")
local path = core.get_modpath("minemine_structures")
local api = dofile(path .. "/planner.lua")
local treehouse = assert(loadfile(path .. "/treehouse.lua"))(path, api)
local ground = treehouse.styles[style] and treehouse.styles[style].ground or "default:sand"
core.clear_registered_biomes()
core.clear_registered_decorations()
core.register_biome({
    name = style, node_top = ground, depth_top = 1, node_filler = ground, depth_filler = 2,
    y_min = -31000, y_max = 31000, heat_point = 50, humidity_point = 50,
})

core.register_on_mods_loaded(function()
    -- Pure plans across both forests, including windows, climb geometry and
    -- reserved space that does not clear the forest floor.
    for palette, nodes in pairs(treehouse.styles) do
        local heights = {}
        for seed = 1, 32 do
            local plan = treehouse.definition.plan(palette, PcgRandom(seed))
            local plot = plan.plots[1]
            local deck = plan.counts.treehouse_height
            heights[deck] = true
            assert(plot.preserve_terrain and deck >= 12 and deck <= 15)
            assert(api.fit(plan, 0, 12, 0, {x = -32, y = -32, z = -32},
                {x = 47, y = 47, z = 47}, function() return 12, palette end, palette))
            assert(not api.fit(plan, 0, 12, 0, {x = -32, y = -32, z = -32},
                {x = 47, y = 24, z = 47}, function() return 12, palette end, palette))
            local s = plot.schematic
            local function node(x, y, z)
                return s.data[1 + x + y * s.size.x + z * s.size.x * s.size.y]
            end
            assert(node(0, 0, 0).prob == 0 and node(4, 0, 4).name == nodes.trunk)
            for y = 1, deck + 1 do
                assert(node(4, y, 3).name == "default:ladder_wood"
                    and node(4, y, 4).name == nodes.trunk, "Ladder must have continuous support")
            end
            assert(node(2, deck + 1, 3).name == nodes.fence)
            assert(node(2, deck + 4, 3).name == nodes.wood)
            for _, n in ipairs(s.data) do assert(core.registered_nodes[n.name], n.name) end
        end
        for y = 12, 15 do assert(heights[y]) end
    end

    local lo, hi = {x = -32, y = 10, z = -32}, {x = 47, y = 47, z = 47}
    core.after(0, function()
        core.emerge_area(lo, hi, function(_, action, remaining)
            assert(action ~= core.EMERGE_CANCELLED and action ~= core.EMERGE_ERRORED)
            if remaining ~= 0 then return end
            core.after(0, function()
                core.load_area(lo, hi)
                local ladders = core.find_nodes_in_area(lo, hi, {"default:ladder_wood"})
                local chests = core.find_nodes_in_area(lo, hi, {"default:chest"})
                if expected then
                    assert(#ladders >= 13 and #ladders <= 16 and #chests == 1)
                    for _, pos in ipairs(ladders) do
                        local support = vector.add(pos, core.wallmounted_to_dir(core.get_node(pos).param2))
                        assert(core.get_node(support).name == treehouse.styles[style].trunk)
                    end
                    local inv = core.get_meta(chests[1]):get_inventory()
                    assert(inv:get_size("main") == 32 and not inv:is_empty("main"))
                    local fences = core.find_nodes_in_area(lo, hi, {treehouse.styles[style].fence})
                    assert(#fences > 0)
                else
                    assert(#ladders == 0 and #chests == 0, "Treehouse generated in an excluded world")
                end
                core.log("action", "[treehouse_probe] PASS " .. style .. " expected=" .. tostring(expected))
                core.request_shutdown("Treehouse probe complete")
            end)
        end)
    end)
end)
