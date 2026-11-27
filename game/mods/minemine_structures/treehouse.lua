local modpath, api = ...
local styles = {
    taiga = {trunk = "default:pine_tree", wood = "default:pine_wood", leaves = "default:pine_needles",
        fence = "default:fence_pine_wood", ground = "default:dirt_with_snow"},
    rainforest = {trunk = "default:jungletree", wood = "default:junglewood", leaves = "default:jungleleaves",
        fence = "default:fence_junglewood", ground = "default:dirt_with_rainforest_litter"},
}

local function treehouse(style, rng)
    local p = assert(styles[style], "Unknown treehouse biome")
    local deck = rng:next(12, 15)
    local size = {x = 9, y = deck + 12, z = 9}
    local data = {}
    local keep = {name = "air", prob = 0, param2 = 0}
    for i = 1, size.x * size.y * size.z do data[i] = keep end
    local function set(x, y, z, name, param2)
        assert(x >= 0 and x < size.x and y >= 0 and y < size.y and z >= 0 and z < size.z)
        data[1 + x + y * size.x + z * size.x * size.y] = {name = name, prob = 255, param2 = param2 or 0}
    end

    -- Clear only the climb and cabin interior. Keep the forest floor and
    -- unrelated terrain under the rest of the canopy.
    for y = 1, deck + 2 do
        for x = 3, 5 do
            for z = 2, 3 do set(x, y, z, "air") end
        end
    end
    for y = 0, size.y - 2 do set(4, y, 4, p.trunk) end
    for x = 2, 6 do
        local roof = deck + 4 + math.min(x - 2, 6 - x)
        for z = 2, 6 do
            if (x ~= 4 or z ~= 3) and (x ~= 4 or z ~= 4) then set(x, deck, z, p.wood) end
            for y = deck + 1, roof - 1 do
                if x ~= 4 or z ~= 4 then set(x, y, z, "air") end
            end
            if x ~= 4 or z ~= 4 then set(x, roof, z, p.wood) end
            local edge = x == 2 or x == 6 or z == 2 or z == 6
            local corner = (x == 2 or x == 6) and (z == 2 or z == 6)
            if corner then
                for y = deck + 1, roof - 1 do set(x, y, z, p.trunk) end
            elseif edge then
                set(x, deck + 1, z, p.fence)
            end
        end
    end
    -- A supported ladder runs through a deliberate opening in the floor.
    -- wallmounted 4 attaches the ladder to the trunk one node toward +Z.
    for y = 1, deck + 1 do set(4, y, 3, "default:ladder_wood", 4) end
    set(rng:next(3, 5), deck + 1, 5, "minemine_structures:chest_pending", rng:next(1, 7) * 32)

    -- Finish the tall tree above the roof. Pines taper; jungle trees have
    -- a fuller crown. The trunk continues through the roof into the leaves.
    for i = 0, 4 do
        local radius = style == "taiga" and math.max(0, 4 - i) or (i <= 2 and 4 or 4 - i)
        local y = deck + 7 + i
        for x = 4 - radius, 4 + radius do
            for z = 4 - radius, 4 + radius do
                if math.abs(x - 4) + math.abs(z - 4) <= radius * 1.6 and (x ~= 4 or z ~= 4 or i == 4) then
                    local branch = i == 1 and ((x == 4 and math.abs(z - 4) <= 2) or (z == 4 and math.abs(x - 4) <= 2))
                    set(x, y, z, branch and p.trunk or p.leaves)
                end
            end
        end
    end
    local plan = api.new_plan()
    plan.counts = {treehouse_height = deck}
    api.road(plan, 0, -3, p.ground)
    api.road(plan, 0, -2, p.ground)
    api.road(plan, 0, -1, p.ground)
    api.plot(plan, 0, 0, {size = size, data = data}, p.ground,
        rng:next(0, 1) == 0 and "0" or "180", {preserve_terrain = true})
    -- The approach must line up with the ladder even when rotated.
    if plan.plots[1].rotation == "180" then
        plan.roads = {}
        for z = 1, 3 do api.road(plan, 0, z, p.ground) end
    end
    return plan
end

return {
    styles = styles,
    definition = {
        id = "treehouse",
        biomes = {taiga = {style = "taiga"}, rainforest = {style = "rainforest"}},
        default_chance = math.max(0, math.min(100, math.floor(tonumber(core.settings:get("minemine_treehouse_chance")) or 4))),
        plan = treehouse,
        preview_label = function(plan) return ("%d blocks up"):format(plan.counts.treehouse_height) end,
    },
}
