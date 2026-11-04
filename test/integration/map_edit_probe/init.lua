-- Installed only into a copied CI world. A visible gold platform should make
-- the chosen zoom-12 map tile change while Luanti and mapserver are both live.
local world = core.get_worldpath()
local file = assert(io.open(world .. "/map-edit-target.json", "r"))
local raw = assert(file:read(256))
file:close()
local target = assert(core.parse_json(raw))
assert(type(target.x) == "number" and type(target.y) == "number" and type(target.z) == "number")
assert(target.x == math.floor(target.x) and target.y == math.floor(target.y) and target.z == math.floor(target.z))
assert(math.abs(target.x) < 30000 and target.y >= -256 and target.y < 2560 and math.abs(target.z) < 30000)

local pos1 = { x = target.x, y = target.y, z = target.z }
local pos2 = { x = target.x + 7, y = target.y, z = target.z + 7 }
core.after(0.1, function()
    core.emerge_area(pos1, pos2, function(_, action, remaining)
        assert(action ~= core.EMERGE_CANCELLED and action ~= core.EMERGE_ERRORED)
        if remaining ~= 0 then return end
        for x = pos1.x, pos2.x do
            for z = pos1.z, pos2.z do
                local pos = { x = x, y = target.y, z = z }
                core.set_node(pos, { name = "default:goldblock" })
                assert(core.get_node(pos).name == "default:goldblock")
            end
        end
        local result = assert(io.open(world .. "/map-edit-result.txt", "w"))
        result:write("gold platform placed\n")
        result:close()
    end)
end)
