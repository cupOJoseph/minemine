core.register_on_mods_loaded(function()
    local cactus = assert(core.registered_nodes["default:cactus"])
    assert(cactus.groups.choppy == 3)
    assert(core.get_dig_params(cactus.groups, core.registered_items[""].tool_capabilities, 0).diggable)
    local contact = dofile(core.get_modpath("minemine_cactus") .. "/contact.lua")
    local box = {-0.3, 0, -0.3, 0.3, 1.7, 0.3}
    local function node(pos)
        if pos.x == 0 and pos.y == 0 and pos.z == 0 then return {name = "default:cactus"} end
        return {name = "air"}
    end
    local function hit(x,y,z) return contact({x=x,y=y,z=z}, box, node) end
    assert(hit(0.8,-0.5,0).x > 0)
    assert(hit(-0.8,-0.5,0).x < 0)
    assert(hit(0,-0.5,0.8).z > 0)
    assert(hit(0,-0.5,-0.8).z < 0)
    assert(hit(0,0.5,0).y > 0)
    assert(not hit(1.3,-0.5,0) and not hit(0,1.5,0))
    local impulses, callbacks, hp = 0, {}, 20
    local player = {
        get_player_name = function() return "probe" end,
        get_hp = function() return hp end, get_attach = function() return nil end,
        get_pos = function() return {x = 0.8, y = -0.5, z = 0} end,
        get_properties = function() return {collisionbox = box} end,
        add_velocity = function(_, v) assert(v.x > 0 and v.y > 0); impulses = impulses + 1 end,
    }
    local fake = {core = setmetatable({
        get_connected_players = function() return {player} end, get_node_or_nil = node,
        register_globalstep = function(fn) callbacks.step = fn end,
        register_on_leaveplayer = function() end, register_on_dieplayer = function() end,
        override_item = function() end,
    }, {__index = core})}
    setmetatable(fake, {__index = _G})
    setfenv(assert(loadfile(core.get_modpath("minemine_cactus") .. "/init.lua")), fake)()
    callbacks.step(0.1)
    callbacks.step(1.0)
    assert(impulses == 1 and hp == 20)
    player.get_pos = function() return {x = 2, y = -0.5, z = 0} end
    callbacks.step(0.1)
    player.get_pos = function() return {x = 0.8, y = -0.5, z = 0} end
    callbacks.step(0.1)
    assert(impulses == 2 and hp == 20)
    core.after(0, function()
        core.log("action", "[cactus_probe] PASS hand digging, contact, cooldown, no damage")
        core.request_shutdown("Cactus probe complete")
    end)
end)
