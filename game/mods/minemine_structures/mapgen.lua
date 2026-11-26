local modpath = core.get_modpath("minemine_structures")
local api = dofile(modpath .. "/planner.lua")
local village = assert(loadfile(modpath .. "/village.lua"))(modpath, api)
village.load_templates()
api.register(village.definition)

local surfaces = {}
local water_level = tonumber(core.get_mapgen_setting("water_level")) or 1
local function natural_ground(vm, pos)
    local name = vm:get_node_at(pos).name
    local solid = surfaces[name]
    if solid == nil then
        local def = core.registered_nodes[name]
        solid = name ~= "ignore" and def ~= nil and def.walkable and def.is_ground_content ~= false
        surfaces[name] = solid == true
    end
    if not solid then return false end
    pos.y = pos.y + 1
    local top = core.registered_nodes[vm:get_node_at(pos).name]
    return top ~= nil and (top.liquidtype == "none" or top.liquidtype == nil)
end

core.register_on_generated(function(vm, minp, maxp, blockseed)
    if maxp.y < water_level or maxp.x - minp.x < 31 or maxp.z - minp.z < 31 then return end
    -- One gate per type per chunk, followed by a few candidate sites. Keep layout
    -- RNG separate so accepting a different site won't change that site's design.
    local gate = PcgRandom(blockseed, 7159)
    local rolls, enabled = {}, false
    for i, def in ipairs(api.types) do
        rolls[i] = gate:next(1, 100)
        if rolls[i] <= def.default_chance then enabled = true end
        for _, rule in pairs(def.biomes) do
            if rolls[i] <= (rule.chance or 0) then enabled = true end
        end
    end
    if not enabled then return end
    local heights = core.get_mapgen_object("heightmap")
    local biomes = core.get_mapgen_object("biomemap")
    if not heights or not biomes then return end
    local width = maxp.x - minp.x + 1
    local function surface(x, z)
        local index = 1 + x - minp.x + (z - minp.z) * width
        return heights[index], biomes[index]
    end
    local middle_x = math.floor((minp.x + maxp.x) / 2)
    local middle_z = math.floor((minp.z + maxp.z) / 2)
    local offset_x = math.floor((maxp.x - minp.x) / 6)
    local offset_z = math.floor((maxp.z - minp.z) / 4)
    local rng = PcgRandom(blockseed, 6883)
    local sites = {{0, 0}, {-offset_x, -offset_z}, {offset_x, offset_z},
        {-offset_x, offset_z}, {offset_x, -offset_z}, {0, offset_z}, {0, -offset_z}}
    for i = #sites, 2, -1 do
        local j = rng:next(1, i)
        sites[i], sites[j] = sites[j], sites[i]
    end
    local pos = {}
    local function dry(px, ground, pz)
        if ground <= water_level then return false end
        pos.x, pos.y, pos.z = px, ground, pz
        return natural_ground(vm, pos)
    end
    local function try_site(def, index, site, layout, compact)
        local x, z = middle_x + site[1], middle_z + site[2]
        local y, biome_id = surface(x, z)
        if not y or y <= water_level or y < minp.y + 2 or y > maxp.y - 9 or not biome_id then return end
        local rule = def.biomes[core.get_biome_name(biome_id)]
        if not rule or rolls[index] > (rule.chance or def.default_chance) or not dry(x, y, z) then return end
        local layout_seed = PcgRandom(blockseed, 9001 + index * 32 + site[3]):next(0, 1073741823)
        local plan = layout(rule.style, PcgRandom(layout_seed, 9001))
        -- Nearby biome variants with the same palette can share a village.
        local function style_at(px, pz)
            local ground, id = surface(px, pz)
            local nearby = id and def.biomes[core.get_biome_name(id)]
            return ground, nearby and nearby.style
        end
        if not api.fit(plan, x, y, z, minp, maxp, style_at, rule.style, dry) then return end
        api.place(plan, vm, x, y, z, surface)
        vm:calc_lighting()
        local plots = {}
        for k, plot in ipairs(plan.plots) do
            local from, to = api.bounds(plot, x, y, z)
            plots[k] = {from = from, to = to}
        end
        core.save_gen_notify("minemine_structures:plots", plots)
        core.log("info", ("[minemine_structures] %s (%s, seed %d%s) at %d,%d,%d"):format(
            def.id, rule.style, layout_seed, compact and ", compact" or "", x, y, z))
        return true
    end
    for i, site in ipairs(sites) do site[3] = i end
    for i, def in ipairs(api.types) do
        for _, site in ipairs(sites) do if try_site(def, i, site, def.plan) then return end end
        if def.fallback then
            for _, site in ipairs(sites) do if try_site(def, i, site, def.fallback, true) then return end end
        end
    end
end)
