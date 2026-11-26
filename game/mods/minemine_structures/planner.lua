-- Shared by mapgen and the workshop; all geometry is relative to the anchor.
local api = {types = {}}

function api.register(def)
    assert(type(def.id) == "string" and type(def.plan) == "function")
    assert(type(def.biomes) == "table" and type(def.default_chance) == "number")
    for _, other in ipairs(api.types) do assert(other.id ~= def.id, "Duplicate structure ID") end
    api.types[#api.types + 1] = def
end

function api.new_plan()
    return {plots = {}, roads = {}, counts = {}}
end

function api.plot(plan, x, z, schematic, foundation, rotation)
    local size = schematic.size
    assert(size.x % 2 == 1 and size.z % 2 == 1, "Use odd-sized footprints")
    assert(not rotation or rotation == "0" or rotation == "180", "Use 0° or 180° for rectangular plots")
    plan.plots[#plan.plots + 1] = {
        x = x, z = z, hx = math.floor(size.x / 2), hz = math.floor(size.z / 2),
        height = size.y, schematic = schematic, foundation = foundation, rotation = rotation or "0",
    }
end

function api.bounds(plot, x, y, z)
    return {x = x + plot.x - plot.hx, y = y, z = z + plot.z - plot.hz},
        {x = x + plot.x + plot.hx, y = y + plot.height - 1, z = z + plot.z + plot.hz}
end

function api.road(plan, x, z, material)
    plan.roads[x .. ":" .. z] = {x = x, z = z, material = material}
end

-- Roads and plots are checked together before any nodes are changed.
function api.fit(plan, x, y, z, minp, maxp, surface, biome_id, foundation_check)
    local function fits_column(px, pz, bottom, top)
        if px < minp.x + 1 or px > maxp.x - 1 or pz < minp.z + 1 or pz > maxp.z - 1
            or bottom < minp.y or top > maxp.y then return false end
        local ground, biome = surface(px, pz)
        return ground and math.abs(ground - y) <= 2
            and ground >= minp.y and (biome_id == nil or biome == biome_id)
            and (not foundation_check or foundation_check(px, ground, pz))
    end
    for _, plot in ipairs(plan.plots) do
        for pz = z + plot.z - plot.hz, z + plot.z + plot.hz do
            for px = x + plot.x - plot.hx, x + plot.x + plot.hx do
                if not fits_column(px, pz, y - 2, y + math.max(plot.height - 1, 6)) then return false end
            end
        end
    end
    for _, road in pairs(plan.roads) do
        if not fits_column(x + road.x, z + road.z, y - 2, y + 4) then return false end
    end
    return true
end

function api.place(plan, vm, x, y, z, surface, preview)
    local pos = {}
    local function set(px, py, pz, name)
        pos.x, pos.y, pos.z = px, py, pz
        vm:set_node_at(pos, {name = name})
    end
    for _, road in pairs(plan.roads) do
        local px, pz = x + road.x, z + road.z
        local ground = surface(px, pz)
        for py = math.min(ground, y), y do set(px, py, pz, road.material) end
        for py = y + 1, math.max(ground + 2, y + 2) do set(px, py, pz, "air") end
    end
    for _, plot in ipairs(plan.plots) do
        for pz = z + plot.z - plot.hz, z + plot.z + plot.hz do
            for px = x + plot.x - plot.hx, x + plot.x + plot.hx do
                local ground = surface(px, pz)
                for py = ground, y - 1 do set(px, py, pz, plot.foundation) end
                for py = y, y + math.max(plot.height - 1, 6) do set(px, py, pz, "air") end
            end
        end
        local schematic = plot.schematic
        if preview then
            -- The showcase is for design work; don't make it a source of loot.
            local data = {}
            for i, node in ipairs(schematic.data) do
                data[i] = node.name == "minemine_structures:chest_pending"
                    and {name = "minemine_structures:chest_pending", param2 = node.param2 % 32, prob = 255}
                    or node
            end
            schematic = {size = schematic.size, data = data, yslice_prob = schematic.yslice_prob}
        end
        local placed = core.place_schematic_on_vmanip(vm,
            {x = x + plot.x - plot.hx, y = y, z = z + plot.z - plot.hz},
            schematic, plot.rotation, nil, true)
        assert(placed, "Validated structure schematic did not fit")
    end
end

return api
