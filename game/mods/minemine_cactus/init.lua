local groups = {}
for name, value in pairs(core.registered_nodes["default:cactus"].groups) do groups[name] = value end
groups.oddly_breakable_by_hand = 2
core.override_item("default:cactus", {groups = groups})

local contact = dofile(core.get_modpath("minemine_cactus") .. "/contact.lua")
local states, elapsed, sample = {}, 0, 0
local cooldown = 0.7
local function clear(player)
    states[player:get_player_name()] = nil
end
core.register_on_leaveplayer(clear)
core.register_on_dieplayer(clear)

core.register_globalstep(function(dtime)
    elapsed = elapsed + dtime
    sample = sample + dtime
    if sample < 0.08 then return end
    sample = 0
    for _, player in ipairs(core.get_connected_players()) do
        local name = player:get_player_name()
        local state = states[name] or {}
        states[name] = state
        local impulse
        if player:get_hp() > 0 and not player:get_attach() then
            local box = player:get_properties().collisionbox
            impulse = contact(player:get_pos(), box, core.get_node_or_nil)
        end
        if impulse and not state.touching and (not state.last or elapsed - state.last >= cooldown) then
            player:add_velocity(impulse)
            state.last = elapsed
        end
        -- Latch until separation, so standing against one cactus does not
        -- repeatedly launch the player or alter their health.
        state.touching = impulse ~= nil
    end
end)
