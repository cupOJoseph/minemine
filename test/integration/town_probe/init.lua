-- CI-only integration probe. Installed into the disposable test world by the
-- native-smoke workflow, never into a public world or production game pack.
local world = core.get_worldpath()
local elapsed = 0
local finished = false
local owner_name, guest_name, claim_pos, inventory_slot
local owner_left = false
local packet_pos, packet_guest, packet_ready, packet_aimed, packet_reaimed, packet_done

local function write_result(filename, status, ok)
    local file = assert(io.open(world .. "/" .. filename, "w"))
    file:write(status, "\n")
    file:close()
    core.log(ok and "action" or "error", "Town probe: " .. status)
end

local function read_config()
    local file = io.open(world .. "/town-probe-config.json", "r")
    if not file then return nil end
    local raw = file:read(4097)
    file:close()
    if not raw or #raw > 4096 then return nil end
    local config = core.parse_json(raw)
    if type(config) ~= "table" or type(config.owner) ~= "string" or type(config.guest) ~= "string" then return nil end
    return config
end

local function check(condition, message)
    if not condition then error(message) end
end

local function read_state()
    local file = io.open(world .. "/town-probe-state.json", "r")
    check(file ~= nil, "initial town probe state missing")
    local raw = file:read(4097)
    file:close()
    check(raw and #raw <= 4096, "invalid town probe state")
    local state = core.parse_json(raw)
    check(type(state) == "table" and type(state.pos) == "table" and type(state.slot) == "number", "invalid town probe state")
    return state
end

local function run(config)
    local town = core.registered_chatcommands.town
    check(town and type(town.func) == "function", "town chat command missing")
    local function command(name, param)
        return town.func(name, param)
    end
    local owner, guest = config.owner, config.guest
    local player = core.get_player_by_name(owner)
    check(player and core.get_player_by_name(guest), "both wallet players must be connected")

    local ok, message = command(owner, "create Probe Town")
    check(ok, "town creation failed: " .. tostring(message))
    ok, message = command(owner, "claim 2")
    check(not ok and message:find("Insufficient confirmed land credits", 1, true), "oversized claim was not refused")
    ok, message = command(owner, "claim 1")
    check(ok, "nine-column claim failed: " .. tostring(message))

    local pos = player:get_pos()
    check(not core.is_protected(pos, owner), "owner cannot build in own claim")
    check(core.is_protected(pos, guest), "outsider can build in protected claim")
    ok, message = command(owner, "invite " .. guest)
    check(ok, "invitation failed: " .. tostring(message))
    ok, message = command(guest, "accept " .. owner)
    check(ok, "invitation acceptance failed: " .. tostring(message))
    check(not core.is_protected(pos, guest), "member cannot build in protected claim")
    ok, message = command(owner, "kick " .. guest)
    check(ok, "member removal failed: " .. tostring(message))
    check(core.is_protected(pos, guest), "removed member can still build in protected claim")
    -- These public Luanti APIs enter the normal node_dig/item_place_node
    -- handlers with the connected wallet players as the actors.
    local edit_pos = { x = math.floor(pos.x), y = math.floor(pos.y) + 3, z = math.floor(pos.z) }
    local support = { x = edit_pos.x, y = edit_pos.y - 1, z = edit_pos.z }
    check(core.get_node(edit_pos).name ~= "ignore" and core.get_node(support).name ~= "ignore",
        "edit probe position is not loaded")
    core.set_node(support, { name = "default:stone" })
    core.set_node(edit_pos, { name = "default:stone" })
    local guest_player = core.get_player_by_name(guest)
    check(not core.dig_node(edit_pos, guest_player), "outsider dug a protected node")
    check(core.get_node(edit_pos).name == "default:stone", "outsider changed the protected node")
    check(core.dig_node(edit_pos, player), "owner could not dig a claimed node")
    check(core.get_node(edit_pos).name == "air", "owner dig did not remove the node")
    core.place_node(edit_pos, { name = "default:wood" }, guest_player)
    check(core.get_node(edit_pos).name == "air", "outsider placed in a protected claim")
    core.place_node(edit_pos, { name = "default:wood" }, player)
    check(core.get_node(edit_pos).name == "default:wood", "owner could not place in own claim")
    local inventory = player:get_inventory()
    local slot = inventory:get_size("main")
    check(slot >= 1, "owner has no main inventory")
    inventory:set_stack("main", slot, "default:diamond 3")
    check(inventory:get_stack("main", slot):get_count() == 3, "inventory fixture could not be set")
    owner_name, guest_name, claim_pos, inventory_slot = owner, guest, pos, slot
    local state_file = assert(io.open(world .. "/town-probe-state.json", "w"))
    state_file:write(assert(core.write_json({ owner = owner, guest = guest, pos = pos, edit_pos = edit_pos, slot = slot })))
    state_file:close()
    return "PASS owner/outsider/member protection, paid quota, invitation/removal and node edit handlers"
end

local function run_restart(config)
    local state = read_state()
    check(state.owner == config.owner and state.guest == config.guest, "wallet characters changed across restart")
    local owner = core.get_player_by_name(state.owner)
    check(owner and core.get_player_by_name(state.guest), "both wallet characters must rejoin after restart")
    local stack = owner:get_inventory():get_stack("main", state.slot)
    check(stack:get_name() == "default:diamond" and stack:get_count() == 3,
        "inventory stack was not restored after server restart")
    check(not core.is_protected(state.pos, state.owner), "town owner lost build access after restart")
    check(core.is_protected(state.pos, state.guest), "town outsider gained build access after restart")
    check(type(state.edit_pos) == "table" and core.get_node(state.edit_pos).name == "default:wood",
        "owner's placed node was not restored after restart")
    local town = core.registered_chatcommands.town
    check(town and type(town.func) == "function", "town command missing after restart")
    local ok, message = town.func(state.owner, "info")
    check(ok and message:find("protected 9/9 columns", 1, true), "town credit or claim count changed after restart")
    return "PASS inventory, placed node, paid-size claim and owner/outsider protection survive native restart"
end

core.register_on_leaveplayer(function(player)
    if finished and player:get_player_name() == owner_name then owner_left = true end
end)

core.register_on_joinplayer(function(player)
    if not owner_left or player:get_player_name() ~= owner_name then return end
    owner_left = false
    core.after(1, function()
        local ok, result = pcall(function()
            local current = core.get_player_by_name(owner_name)
            check(current ~= nil, "owner disappeared after reconnect")
            local stack = current:get_inventory():get_stack("main", inventory_slot)
            check(stack:get_name() == "default:diamond" and stack:get_count() == 3,
                "inventory stack was not restored after reconnect")
            check(core.is_protected(claim_pos, guest_name), "town claim was lost after reconnect")
            return "PASS inventory and town protection survive wallet reconnect"
        end)
        write_result("town-probe-reconnect-result.txt", ok and result or "FAIL " .. tostring(result), ok)
    end)
end)

core.register_on_protection_violation(function(pos, name)
    if not packet_ready or packet_done or name ~= packet_guest then return end
    if pos.x ~= packet_pos.x or math.abs(pos.y - packet_pos.y) > 1 or math.abs(pos.z - packet_pos.z) > 1 then return end
    packet_done = true
    local intact = core.get_node(pos).name == "default:stone"
    write_result("town-packet-dig-result.txt",
        intact and "PASS outsider browser dig reached protected node without changing it"
            or "FAIL protected node changed during browser dig", intact)
end)

local packet_elapsed = 0
core.register_globalstep(function(dtime)
    if not finished or packet_ready then return end
    packet_elapsed = packet_elapsed + dtime
    if packet_elapsed < 0.25 then return end
    packet_elapsed = 0
    local arm = io.open(world .. "/town-packet-arm.txt", "r")
    if not arm then return end
    arm:close()
    packet_ready = true
    local ok, result = pcall(function()
        local state = read_state()
        local guest = core.get_player_by_name(state.guest)
        check(guest ~= nil, "outsider disconnected before browser packet probe")
        packet_pos = { x = state.edit_pos.x + 1, y = state.edit_pos.y, z = state.edit_pos.z }
        local guest_pos = { x = packet_pos.x + 2.5, y = packet_pos.y - 1.5, z = packet_pos.z }
        check(core.get_node(packet_pos).name ~= "ignore", "browser packet target is not loaded")
        for dy = -1, 1 do
            for dz = -1, 1 do
                core.set_node({ x = packet_pos.x, y = packet_pos.y + dy, z = packet_pos.z + dz }, { name = "default:stone" })
            end
        end
        for dx = 1, 3 do
            for dy = -1, 1 do
                core.set_node({ x = packet_pos.x + dx, y = packet_pos.y + dy, z = packet_pos.z }, { name = "air" })
            end
        end
        for dx = 2, 3 do
            core.set_node({ x = packet_pos.x + dx, y = packet_pos.y - 2, z = packet_pos.z }, { name = "default:stone" })
        end
        check(guest:set_wielded_item("default:pick_steel"), "could not equip outsider pickaxe")
        guest:set_physics_override({ gravity = 0 })
        guest:set_pos(guest_pos)
        guest:set_look_horizontal(math.pi / 2)
        guest:set_look_vertical(0)
        local dir = guest:get_look_dir()
        check(dir.x < -0.9 and math.abs(dir.y) < 0.1, "outsider camera did not face target")
        packet_guest = state.guest
        return "PASS browser dig target armed"
    end)
    write_result("town-packet-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

local packet_debug_elapsed = 0
core.register_globalstep(function(dtime)
    if not packet_ready or packet_done or not packet_pos then return end
    packet_debug_elapsed = packet_debug_elapsed + dtime
    if packet_debug_elapsed < 1 then return end
    packet_debug_elapsed = 0
    local guest = core.get_player_by_name(packet_guest)
    if not guest then return end
    local file = io.open(world .. "/town-packet-debug.json", "w")
    if not file then return end
    file:write(core.write_json({ player_pos = guest:get_pos(), look_dir = guest:get_look_dir(), target = packet_pos, aimed = packet_aimed }))
    file:close()
end)

core.register_globalstep(function()
    if not packet_ready or packet_aimed or not packet_guest then return end
    local arm = io.open(world .. "/town-packet-aim.txt", "r")
    if not arm then return end
    arm:close()
    packet_aimed = true
    local guest = core.get_player_by_name(packet_guest)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-aim-ready.txt", "PASS browser camera reset after pointer lock", true)
end)

core.register_globalstep(function()
    if not packet_aimed or packet_reaimed or not packet_guest then return end
    local arm = io.open(world .. "/town-packet-reaim.txt", "r")
    if not arm then return end
    arm:close()
    packet_reaimed = true
    local guest = core.get_player_by_name(packet_guest)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-reaim-ready.txt", "PASS browser camera reset during held dig", true)
end)

core.register_globalstep(function(dtime)
    if finished then return end
    elapsed = elapsed + dtime
    if elapsed < 1 then return end
    elapsed = 0
    local config = read_config()
    if not config or not core.get_player_by_name(config.owner) or not core.get_player_by_name(config.guest) then return end
    finished = true
    local restart = config.phase == "restart"
    local ok, result = pcall(restart and run_restart or run, config)
    local status = ok and result or "FAIL " .. tostring(result)
    write_result(restart and "town-probe-restart-result.txt" or "town-probe-result.txt", status, ok)
end)
