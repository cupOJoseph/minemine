local window = 0.35
local boost = 1.5
local timer = 0
local players = {}

local function stop(player, state)
    if state.applied then
        -- Leave any newer walk-speed override alone.
        if player:get_physics_override().speed_walk == state.applied then
            player:set_physics_override({speed_walk = state.base})
        end
        state.applied, state.base = nil, nil
    end
end

local function clear(player)
    local name = player:get_player_name()
    if players[name] then
        stop(player, players[name])
        players[name] = nil
    end
end

core.register_on_leaveplayer(clear)
core.register_on_dieplayer(clear)

core.register_globalstep(function(dtime)
    timer = timer + dtime
    for _, player in ipairs(core.get_connected_players()) do
        local name = player:get_player_name()
        local state = players[name]
        if not state then
            state = {}
            players[name] = state
        end
        local control = player:get_player_control()
        local forward = control.movement_y and control.movement_y > 0.5
            or (control.movement_y == nil and control.up == true)
        if control.sneak or player:get_attach() or player:get_hp() <= 0 then
            stop(player, state)
            state.first = nil
        elseif forward and not state.held then
            if state.first and timer - state.first <= window then
                state.base = player:get_physics_override().speed_walk
                player:set_physics_override({speed_walk = state.base * boost})
                -- Save the value returned by the engine after float conversion.
                state.applied = player:get_physics_override().speed_walk
                state.first = nil
            else
                state.first = timer
            end
        elseif not forward and state.held then
            stop(player, state)
        end
        state.held = forward
    end
end)
