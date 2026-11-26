-- Return a small outward impulse if the player's collision box touches cactus.
-- Node positions are integer centers; a full cactus occupies center +/- 0.5.
local EPSILON = 0.09
return function(pos, box, get_node)
    local a = {x = pos.x + box[1], y = pos.y + box[2], z = pos.z + box[3]}
    local b = {x = pos.x + box[4], y = pos.y + box[5], z = pos.z + box[6]}
    local function low(n) return math.floor(n + 0.5 - EPSILON) end
    local function high(n) return math.floor(n + 0.5 + EPSILON) end
    local nearest, distance
    for x = low(a.x), high(b.x) do
        for y = low(a.y), high(b.y) do
            for z = low(a.z), high(b.z) do
                local node = get_node({x=x, y=y, z=z})
                if node and node.name == "default:cactus" then
                    local dx, dz = pos.x - x, pos.z - z
                    local metric = dx * dx + dz * dz + (a.y - y)^2
                    if not distance or metric < distance then
                        nearest, distance = {x=x,y=y,z=z}, metric
                    end
                end
            end
        end
    end
    if not nearest then return nil end

    local dx, dz = pos.x - nearest.x, pos.z - nearest.z
    -- Choose the closest horizontal face. On an edge, use the direction away
    -- from its center. A player standing on top is pushed off the cactus too.
    if math.abs(dx) < 0.5 and math.abs(dz) < 0.5 then
        if math.abs(dx) >= math.abs(dz) then dx, dz = dx < 0 and -1 or 1, 0
        else dx, dz = 0, dz < 0 and -1 or 1 end
    end
    local length = math.sqrt(dx * dx + dz * dz)
    return {x = 4.0 * dx / length, y = 2.4, z = 4.0 * dz / length}
end
