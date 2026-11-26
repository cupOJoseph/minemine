local modpath = core.get_modpath("minemine_structures")
local chest = "minemine_structures:chest_pending"
local furnace = "minemine_structures:furnace_pending"

-- The mapgen thread cannot write metadata. Markers become normal MTG nodes
-- on the server thread; the load hook also handles any markers left on disk.
core.register_node(chest, {
    description = "Village Chest", tiles = {"default_chest_top.png"},
    paramtype2 = "colorfacedir", drop = "default:chest",
    groups = {choppy = 2, not_in_creative_inventory = 1},
})
core.register_node(furnace, {
    description = "Village Furnace", tiles = {"default_furnace_front.png"},
    paramtype2 = "facedir", drop = "default:furnace",
    groups = {cracky = 2, not_in_creative_inventory = 1},
})

core.register_node("minemine_structures:hearth", {
    description = "Stone Hearth", drawtype = "firelike",
    tiles = {{name = "fire_basic_flame_animated.png",
        animation = {type = "vertical_frames", aspect_w = 16, aspect_h = 16, length = 1}}},
    inventory_image = "fire_basic_flame.png", paramtype = "light", light_source = 10,
    sunlight_propagates = true, walkable = false, drop = "",
    groups = {dig_immediate = 3, not_in_creative_inventory = 1},
    -- No igniter or fire groups: this decorative flame never spreads.
})

local loot = {{"default:torch", 2, 5}, {"farming:bread", 1, 2},
    {"default:apple", 1, 3}, {"default:coal_lump", 1, 3}, {"default:stick", 2, 5},
    {"farming:seed_wheat", 1, 3}, {"default:steel_ingot", 1, 1}}

local function initialize_fixture(pos, node)
    local is_chest = node.name == chest
    local name = is_chest and "default:chest" or "default:furnace"
    local code = math.floor(node.param2 / 32)
    core.swap_node(pos, {name = name, param2 = node.param2 % 32})
    core.registered_nodes[name].on_construct(pos)
    if is_chest and code > 0 then
        local rng = PcgRandom(core.hash_node_position(pos), code)
        local inv = core.get_meta(pos):get_inventory()
        local first = rng:next(1, #loot)
        local function add(i)
            local item = loot[i]
            inv:add_item("main", item[1] .. " " .. rng:next(item[2], item[3]))
        end
        add(first)
        if rng:next(0, 1) == 1 then add((first + rng:next(0, #loot - 2)) % #loot + 1) end
    end
end

core.register_lbm({
    name = "minemine_structures:initialize_fixtures",
    nodenames = {chest, furnace}, run_at_every_load = true, action = initialize_fixture,
})

if core.settings:get_bool("minemine_structures_enabled", true) then
    core.set_gen_notify({custom = true}, nil, {"minemine_structures:plots"})
    core.register_mapgen_script(modpath .. "/mapgen.lua")
    core.register_on_generated(function()
        local notify = core.get_mapgen_object("gennotify")
        local plots = notify and notify.custom and notify.custom["minemine_structures:plots"]
        if not plots then return end
        for _, plot in ipairs(plots) do
            for _, pos in ipairs(core.find_nodes_in_area(plot.from, plot.to, {chest, furnace})) do
                initialize_fixture(pos, core.get_node(pos))
            end
        end
    end)
end

if core.settings:get_bool("minemine_structures_workshop", core.is_singleplayer()) then
    assert(loadfile(modpath .. "/workshop.lua"))(modpath, initialize_fixture, {chest, furnace})
end
