local modpath, api = ...
local biomes = dofile(modpath .. "/config.lua")
local pending = "minemine_structures:chest_pending"
local hearth = "minemine_structures:hearth"
local furnace = "minemine_structures:furnace_pending"
local palettes = {
    plains = {wall="default:wood", trim="default:tree", floor="default:wood", roof="default:cobble", base="default:cobble", road="default:gravel"},
    pine = {wall="default:pine_wood", trim="default:pine_tree", floor="default:pine_wood", roof="default:stonebrick", base="default:cobble", road="default:gravel"},
    tundra = {wall="default:cobble", trim="default:stonebrick", floor="default:stone_block", roof="default:stonebrick", base="default:cobble", road="default:gravel", hearth=true},
    desert = {wall="default:sandstonebrick", trim="default:sandstone_block", floor="default:sandstone_block", roof="default:sandstone", base="default:sandstone", road="default:sandstone", well=true},
    savanna = {wall="default:acacia_wood", trim="default:acacia_tree", floor="default:acacia_wood", roof="default:desert_cobble", base="default:desert_cobble", road="default:gravel"},
    jungle = {wall="default:junglewood", trim="default:jungletree", floor="default:junglewood", roof="default:mossycobble", base="default:mossycobble", road="default:gravel"},
}
local templates = {}
local roles = {"shop", "chapel", "smithy", "barn"}

local function volume(w, h, d)
    local data = {}
    local air = {name = "air", prob = 255, param2 = 0}
    for i = 1, w * h * d do data[i] = air end
    return {size = {x = w, y = h, z = d}, data = data}, function(x, y, z, name, param2)
        assert(x >= 0 and x < w and y >= 0 and y < h and z >= 0 and z < d, "Template coordinate outside bounds")
        data[1 + x + y * w + z * w * h] = {name = name, prob = 255, param2 = param2 or 0}
    end
end

local function loot_code(rng)
    if rng:next(1, 100) > 55 then return 0 end
    return rng:next(1, 7) * 32
end

local function decorate_import(schematic, rng)
    local data = {}
    for i, node in ipairs(schematic.data) do
        data[i] = node
        if node.name == "default:chest" or node.name == "default:furnace" then
            data[i] = {
                name = node.name == "default:chest" and pending or furnace,
                param2 = (node.param2 or 0) % 4 + (node.name == "default:chest" and loot_code(rng) or 0),
                prob = 255,
            }
        end
    end
    return {size = schematic.size, data = data, yslice_prob = schematic.yslice_prob}
end

local function building(role, p, rng)
    local w = role == "barn" and 9 or rng:next(0, 1) * 2 + 5
    local d, wall = 7, role == "barn" and 2 or 3
    local center = math.floor(w / 2)
    local flat_roof = p.well and rng:next(1, 3) ~= 1
    local gabled = not flat_roof and rng:next(1, 4) ~= 1
    local roof_height = wall + (gabled and center or 0) + 2
    local silhouette = role == "chapel" and 2 or (role == "smithy" or (role == "home" and p.hearth)) and 1 or 0
    local schematic, set = volume(w, roof_height + silhouette, d)
    for x = 0, w - 1 do
        for z = 0, d - 1 do
            set(x, 0, z, p.floor)
            local outside = x == 0 or x == w - 1 or z == 0 or z == d - 1
            local corner = (x == 0 or x == w - 1) and (z == 0 or z == d - 1)
            if outside then
                for y = 1, wall do set(x, y, z, corner and p.trim or p.wall) end
            end
            local rise = gabled and math.min(x, w - 1 - x) or 0
            set(x, wall + 1 + rise, z, p.roof)
            if z == 0 or z == d - 1 then
                for y = wall + 1, wall + rise do set(x, y, z, p.wall) end
            end
        end
    end
    -- Front faces -Z. Doors are oriented as a pair of generated MTG nodes.
    if role == "barn" then
        for x = center - 1, center + 1 do
            for y = 1, 2 do set(x, y, 0, "air") end
        end
    else
        set(center, 1, 0, "doors:door_wood_a", 0)
        set(center, 2, 0, "doors:hidden", 0)
    end
    local window = role == "chapel" and "default:obsidian_glass" or "default:glass"
    set(0, 2, 2, window)
    set(w - 1, 2, rng:next(2, 4), window)
    set(center, 2, d - 1, window)
    set(center, wall, 1, "default:torch_ceiling", 0)
    if role == "home" then
        local bed = rng:next(1, 3) == 1 and "beds:fancy_bed" or "beds:bed"
        set(1, 1, 3, bed .. "_bottom", 0)
        set(1, 1, 4, bed .. "_top", 0)
        set(w - 2, 1, 4, pending, loot_code(rng))
        if p.hearth then
            set(center, 0, 5, "default:stonebrick")
            set(center - 1, 1, 5, "default:stonebrick")
            set(center + 1, 1, 5, "default:stonebrick")
            set(center, 1, 5, hearth)
            for y = 2, schematic.size.y - 1 do set(center, y, 5, "default:stonebrick") end
        end
    elseif role == "shop" then
        for x = 1, w - 3 do set(x, 1, 3, p.trim) end
        set(1, 1, 5, pending, loot_code(rng))
    elseif role == "chapel" then
        set(center, 1, 5, "default:stonebrick")
        for z = 2, 4, 2 do
            set(1, 1, z, p.trim)
            set(w - 2, 1, z, p.trim)
        end
        for y = roof_height - 1, schematic.size.y - 2 do
            set(center, y, 1, p.trim)
            set(center, y, 0, p.trim)
        end
        set(center, schematic.size.y - 1, 0, "default:meselamp")
    elseif role == "smithy" then
        set(1, 1, 5, furnace)
        set(w - 2, 1, 5, pending, loot_code(rng))
        set(center, 1, 5, "default:steelblock")
        local chimney_top = schematic.size.y - 1
        for y = wall, chimney_top do set(1, y, 5, p.trim) end
    else
        for x = 1, w - 2, 2 do set(x, 1, 5, "farming:straw") end
        set(w - 2, 1, 4, pending, loot_code(rng))
    end
    return schematic
end

local function plaza(p)
    local schematic, set = volume(3, 4, 3)
    for x = 0, 2 do for z = 0, 2 do set(x, 0, z, p.road) end end
    if p.well then
        for x = 0, 2 do for z = 0, 2 do
            if x == 1 and z == 1 then
                set(x, 1, z, "default:water_source")
            else
                set(x, 1, z, p.trim)
            end
            set(x, 3, z, p.roof)
        end end
        for x = 0, 2, 2 do for z = 0, 2, 2 do set(x, 2, z, p.trim) end end
    else
        set(1, 1, 1, p.trim)
        set(1, 2, 1, p.hearth and hearth or "default:meselamp")
    end
    return schematic
end

local function home(style, p, rng)
    local choices = templates[style]
    if choices then
        local pick = rng:next(1, 4 + #choices)
        if pick > 4 then return decorate_import(choices[pick - 4], rng) end
    end
    return building("home", p, rng)
end

local function village(style, rng, compact)
    local p = assert(palettes[style], "Unknown village style: " .. tostring(style))
    local plan = api.new_plan()
    local homes, shops = rng:next(1, compact and 2 or 6), rng:next(0, compact and 1 or 3)
    plan.counts = {homes = homes, occupations = shops}
    local slots, shuffled_roles = {}, {roles[1], roles[2], roles[3], roles[4]}
    for _, column in ipairs({0, 1, -1, 2, -2}) do
        local side = rng:next(0, 1) * 2 - 1
        slots[#slots + 1] = {x = column * 10, z = side * 8}
        slots[#slots + 1] = {x = column * 10, z = -side * 8}
    end
    for i = #shuffled_roles, 2, -1 do
        local j = rng:next(1, i)
        shuffled_roles[i], shuffled_roles[j] = shuffled_roles[j], shuffled_roles[i]
    end
    api.plot(plan, 0, 0, plaza(p), p.base)
    local left, right = 0, 0
    for i = 1, homes + shops do
        local slot = slots[i]
        local shape = i <= homes and home(style, p, rng) or building(shuffled_roles[i - homes], p, rng)
        api.plot(plan, slot.x, slot.z, shape, p.base, slot.z > 0 and "0" or "180")
        left, right = math.min(left, slot.x), math.max(right, slot.x)
        local direction = slot.z > 0 and 1 or -1
        for z = 2, 7 - math.floor(shape.size.z / 2) do
            api.road(plan, slot.x, z * direction, p.road)
        end
    end
    for x = left - 2, right + 2 do
        for z = -2, 2 do
            if math.abs(x) > 1 or math.abs(z) > 1 then api.road(plan, x, z, p.road) end
        end
    end
    return plan
end

local function load_templates()
    for _, t in ipairs(dofile(modpath .. "/templates.lua")) do
        assert(palettes[t.style] and t.file:match("^[%w_-]+%.mts$"), "Invalid village template")
        local s = assert(core.read_schematic(modpath .. "/schematics/" .. t.file, {}), "Cannot read " .. t.file)
        local w, h, d = s.size.x, s.size.y, s.size.z
        assert(w >= 5 and w <= 9 and w % 2 == 1 and d >= 5 and d <= 7 and d % 2 == 1 and h >= 4 and h <= 8,
            "Village template is outside lot limits: " .. t.file)
        local has_bed = false
        for i, node in ipairs(s.data) do
            local def = core.registered_nodes[node.name]
            assert(def and (node.prob or 255) >= 254,
                "Use registered nodes and full placement probability in " .. t.file)
            if def.groups.bed == 1 and node.param2 >= 0 and node.param2 < 4 then
                local dir = core.facedir_to_dir(node.param2)
                local x, z = (i - 1) % w + dir.x, math.floor((i - 1) / (w * h)) + dir.z
                local top = x >= 0 and x < w and z >= 0 and z < d and s.data[i + dir.x + dir.z * w * h]
                if top and top.name == node.name:gsub("_bottom$", "_top") and top.param2 == node.param2 then
                    has_bed = true
                end
            end
        end
        assert(has_bed, "Village home must contain a complete bed: " .. t.file)
        for _, slice in ipairs(s.yslice_prob or {}) do
            assert(slice.prob >= 254, "Use full slice placement probability in " .. t.file)
        end
        templates[t.style] = templates[t.style] or {}
        local weight = t.weight or 1
        assert(weight >= 1 and weight <= 10 and weight % 1 == 0, "Template weight must be 1–10")
        for _ = 1, weight do templates[t.style][#templates[t.style] + 1] = s end
    end
end

return {
    definition = {
        id = "village", biomes = biomes, plan = village,
        fallback = function(style, rng) return village(style, rng, true) end,
        default_chance = math.max(0, math.min(100, math.floor(tonumber(core.settings:get("minemine_village_chance")) or 10))),
    },
    styles = palettes, load_templates = load_templates,
}
