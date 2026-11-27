local cane = "default:papyrus"
local ground_names = {
    "default:dirt", "default:dirt_with_grass", "default:dirt_with_grass_footsteps",
    "default:dirt_with_dry_grass", "default:dirt_with_snow",
    "default:dirt_with_rainforest_litter", "default:dirt_with_coniferous_litter",
    "default:dry_dirt", "default:dry_dirt_with_dry_grass",
    "default:sand", "default:desert_sand", "default:silver_sand",
}
local ground = {}
for _, name in ipairs(ground_names) do ground[name] = true end
local sides = {vector.new(1, 0, 0), vector.new(-1, 0, 0), vector.new(0, 0, 1), vector.new(0, 0, -1)}

local function valid_root(pos)
    if not ground[core.get_node(pos).name] then return false end
    for _, side in ipairs(sides) do
        if core.get_item_group(core.get_node(vector.add(pos, side)).name, "water") > 0 then
            return true
        end
    end
    return false
end

core.override_item(cane, {
    node_placement_prediction = "",
    on_place = function(stack, player, pointed)
        if pointed.type ~= "node" then return stack end
        local under = core.registered_nodes[core.get_node(pointed.under).name]
        if not under then return stack end
        -- Preserve ordinary right-click interactions, e.g. opening a chest.
        if under.on_rightclick and player and not player:get_player_control().sneak then
            return core.item_place(stack, player, pointed)
        end
        local target = under.buildable_to and pointed.under or pointed.above
        if core.get_item_group(core.get_node(target).name, "liquid") > 0 then return stack end
        local root = vector.offset(target, 0, -1, 0)
        while core.get_node(root).name == cane do root.y = root.y - 1 end
        if not valid_root(root) then return stack end
        return core.item_place(stack, player, pointed)
    end,
})

-- Reuse the stock growth ABM and its original interval, chance and height limit.
-- Sand can now grow cane too; only the four neighboring water blocks are tested.
function default.grow_papyrus(pos, node)
    if not valid_root(vector.offset(pos, 0, -1, 0)) then return end
    pos = vector.copy(pos)
    local height = 0
    while node.name == cane and height < 4 do
        height = height + 1
        pos.y = pos.y + 1
        node = core.get_node(pos)
    end
    if height < 4 and node.name == "air" and (core.get_node_light(pos) or 0) >= 13 then
        core.set_node(pos, {name = cane})
        return true
    end
end

for _, abm in ipairs(core.registered_abms) do
    if abm.label == "Grow papyrus" then
        abm.neighbors = ground_names
        break
    end
end
