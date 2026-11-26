-- Exercise the actual server mod with timed player inputs. Use mock players
-- so this does not require an interactive client.
local callbacks = {}
local function player(name, base)
    local p = {control = {}, walk = base, hp = 20}
    function p:get_player_name() return name end
    function p:get_player_control() return self.control end
    function p:get_physics_override() return {speed_walk = self.walk} end
    function p:set_physics_override(o)
        assert(o.speed_walk and not o.speed and not o.gravity, "Only walk speed may change")
        self.walk = o.speed_walk
    end
    function p:get_attach() return self.attached end
    function p:get_hp() return self.hp end
    return p
end

local runner, other = player("runner", 0.8), player("other", 1)
local env = {core = {
    register_globalstep = function(fn) callbacks.step = fn end,
    register_on_dieplayer = function(fn) callbacks.death = fn end,
    register_on_leaveplayer = function(fn) callbacks.leave = fn end,
    get_connected_players = function() return {runner, other} end,
}}
setmetatable(env, {__index = _G})
local path = core.get_modpath("minemine_movement")
setfenv(assert(loadfile(path .. "/init.lua")), env)()

local function tick(seconds, y, sneak)
    runner.control = {movement_y = y, sneak = sneak}
    callbacks.step(seconds)
end
local function walk_speed(expected)
    assert(math.abs(runner.walk - expected) < 0.0001, "Unexpected walk speed: " .. runner.walk)
    assert(other.walk == 1, "Sprint changed a different player")
end

tick(0.05, 1) -- First tap
walk_speed(0.8)
tick(0.07, 0)
tick(0.08, 1)
walk_speed(1.2)
tick(0.6, 0.707) -- Still forward while strafing
walk_speed(1.2)
tick(0.05, 0)
walk_speed(0.8)

tick(0.05, 1)
tick(0.15, 0)
tick(0.25, 1) -- Too late
walk_speed(0.8)
tick(0.05, 0)
tick(0.05, 1)
walk_speed(1.2)
tick(0.05, 1, true)
walk_speed(0.8)
tick(0.05, 1, false) -- Dropping crouch does not restart a held key
walk_speed(0.8)

tick(0.05, 0)
tick(0.05, 1)
tick(0.05, 0)
tick(0.05, 1)
walk_speed(1.2)
runner.walk = 1.1 -- Another mechanic updates the baseline mid-sprint.
tick(0.05, 0)
walk_speed(1.1)

tick(0.05, 1)
tick(0.05, 0)
tick(0.05, 1)
walk_speed(1.65)
callbacks.death(runner)
walk_speed(1.1)
core.log("action", "[structures_probe] Double-tap sprint, release and crouch behavior verified")
