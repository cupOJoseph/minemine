-- CI-only integration probe. Installed into the disposable test world by the
-- native-smoke workflow, never into a public world or production game pack.
local world = core.get_worldpath()
local elapsed = 0
local finished = false
local owner_name, guest_name, claim_pos, inventory_slot
local owner_left = false
local packet_pos, packet_guest, packet_ready, packet_aimed, packet_reaimed, packet_done
local packet_phase, packet_place_ready, packet_place_aimed, packet_place_done
local owner_place_ready, owner_place_aimed, owner_place_done
local owner_dig_ready, owner_dig_aimed, owner_dig_reaimed, owner_dig_done
local member_place_ready, member_place_aimed, member_place_done
local member_dig_ready, member_dig_aimed, member_dig_reaimed, member_dig_done
local removed_place_ready, removed_place_aimed, removed_place_done
local expired_grant_checked = false

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
    local wallet = core.registered_chatcommands.wallet
    check(wallet ~= nil, "wallet command missing")
    local wallet_ok, wallet_message = wallet.func(owner, "")
    local address = wallet_message and wallet_message:match("Wallet: (0x%x+)")
    check(wallet_ok and address and #address == 42, "wallet identity command failed")
    local balance_ok, balance_message = wallet.func(owner, "balance")
    check(not balance_ok and balance_message:find("No recent MINE balance", 1, true), "missing wallet balance was not explained")
    core.mkdir(world .. "/wallet_balances")
    local snapshot_path = world .. "/wallet_balances/" .. owner .. ".json"
    local snapshot = {
        name = owner, address = address, token = "0x" .. string.rep("1", 40),
        chain_id = 31337, raw = "42500000000000000000", formatted = "42.5", decimals = 18,
        block_number = 7, expires_at = os.time() + 60,
    }
    local snapshot_file = assert(io.open(snapshot_path, "w"))
    snapshot_file:write(assert(core.write_json(snapshot)))
    snapshot_file:close()
    balance_ok, balance_message = wallet.func(owner, "balance")
    check(balance_ok and balance_message:find("Observed MINE balance: 42.5 on chain 31337 at block 7", 1, true),
        "wallet balance snapshot was not displayed")
    snapshot.expires_at = os.time() - 1
    snapshot_file = assert(io.open(snapshot_path, "w"))
    snapshot_file:write(assert(core.write_json(snapshot)))
    snapshot_file:close()
    balance_ok, balance_message = wallet.func(owner, "balance")
    check(not balance_ok and balance_message:find("No recent MINE balance", 1, true), "expired balance snapshot was shown")
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
    if not packet_ready or name ~= packet_guest then return end
    if pos.x ~= packet_pos.x or math.abs(pos.y - packet_pos.y) > 1 or math.abs(pos.z - packet_pos.z) > 1 then return end
    if packet_phase == "dig" and not packet_done then
        packet_done = true
        local intact = core.get_node(pos).name == "default:stone"
        write_result("town-packet-dig-result.txt",
            intact and "PASS outsider browser dig reached protected node without changing it"
                or "FAIL protected node changed during browser dig", intact)
    elseif packet_phase == "place" and not packet_place_done then
        packet_place_done = true
        local empty = core.get_node(pos).name == "air"
        write_result("town-packet-place-result.txt",
            empty and "PASS outsider browser place reached protected air without changing it"
                or "FAIL protected node changed during browser place", empty)
    elseif packet_phase == "removed_place" and not removed_place_done then
        removed_place_done = true
        local empty = core.get_node(pos).name == "air"
        write_result("town-packet-removed-place-result.txt",
            empty and "PASS removed member browser place was denied"
                or "FAIL removed member changed protected air", empty)
    end
end)

core.register_on_placenode(function(pos, node, player)
    if not owner_place_ready or owner_place_done or not player or player:get_player_name() ~= owner_name then return end
    if pos.x ~= packet_pos.x or pos.y ~= packet_pos.y or pos.z ~= packet_pos.z then return end
    owner_place_done = true
    local placed = node.name == "default:wood" and core.get_node(pos).name == "default:wood"
    write_result("town-packet-owner-place-result.txt",
        placed and "PASS owner browser place changed own claimed node"
            or "FAIL owner browser place did not create wood", placed)
end)

core.register_on_placenode(function(pos, node, player)
    if not member_place_ready or member_place_done or not player or player:get_player_name() ~= guest_name then return end
    if pos.x ~= packet_pos.x or pos.y ~= packet_pos.y or pos.z ~= packet_pos.z then return end
    member_place_done = true
    local placed = node.name == "default:wood" and core.get_node(pos).name == "default:wood"
    write_result("town-packet-member-place-result.txt",
        placed and "PASS invited member browser place changed claimed node"
            or "FAIL invited member browser place did not create wood", placed)
end)

core.register_on_dignode(function(pos, node, player)
    if not owner_dig_ready or owner_dig_done or not player or player:get_player_name() ~= owner_name then return end
    if pos.x ~= packet_pos.x or pos.y ~= packet_pos.y or pos.z ~= packet_pos.z then return end
    owner_dig_done = true
    local removed = node.name == "default:wood" and core.get_node(pos).name == "air"
    write_result("town-packet-owner-dig-result.txt",
        removed and "PASS owner browser dig removed own claimed node"
            or "FAIL owner browser dig did not remove wood", removed)
end)

core.register_on_dignode(function(pos, node, player)
    if not member_dig_ready or member_dig_done or not player or player:get_player_name() ~= guest_name then return end
    if pos.x ~= packet_pos.x or pos.y ~= packet_pos.y or pos.z ~= packet_pos.z then return end
    member_dig_done = true
    local removed = node.name == "default:wood" and core.get_node(pos).name == "air"
    write_result("town-packet-member-dig-result.txt",
        removed and "PASS invited member browser dig removed claimed node"
            or "FAIL invited member browser dig did not remove wood", removed)
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
        local owner = core.get_player_by_name(state.owner)
        check(guest ~= nil, "outsider disconnected before browser packet probe")
        check(owner ~= nil, "owner disconnected before browser packet probe")
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
        owner:set_physics_override({ gravity = 0 })
        owner:set_pos({ x = packet_pos.x - 6, y = packet_pos.y - 1.5, z = packet_pos.z + 6 })
        guest:set_physics_override({ gravity = 0 })
        guest:set_pos(guest_pos)
        guest:set_look_horizontal(math.pi / 2)
        guest:set_look_vertical(0)
        local dir = guest:get_look_dir()
        check(dir.x < -0.9 and math.abs(dir.y) < 0.1, "outsider camera did not face target")
        packet_guest = state.guest
        packet_phase = "dig"
        return "PASS browser dig target armed"
    end)
    write_result("town-packet-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

local packet_debug_elapsed = 0
core.register_globalstep(function(dtime)
    if not packet_ready or (packet_phase == "dig" and packet_done) or packet_place_done or not packet_pos then return end
    packet_debug_elapsed = packet_debug_elapsed + dtime
    if packet_debug_elapsed < 1 then return end
    packet_debug_elapsed = 0
    local guest = core.get_player_by_name(packet_guest)
    if not guest then return end
    local file = io.open(world .. "/town-packet-debug.json", "w")
    if not file then return end
    file:write(core.write_json({ player_pos = guest:get_pos(), look_dir = guest:get_look_dir(), target = packet_pos,
        phase = packet_phase, aimed = packet_aimed, place_aimed = packet_place_aimed }))
    file:close()
end)

core.register_globalstep(function()
    if not packet_done or packet_place_ready or not packet_guest then return end
    local arm = io.open(world .. "/town-packet-place-arm.txt", "r")
    if not arm then return end
    arm:close()
    packet_place_ready = true
    local ok, result = pcall(function()
        local guest = core.get_player_by_name(packet_guest)
        check(guest ~= nil, "outsider disconnected before browser place probe")
        for dy = -1, 1 do
            for dz = -1, 1 do
                core.set_node({ x = packet_pos.x, y = packet_pos.y + dy, z = packet_pos.z + dz }, { name = "air" })
                if dy ~= 0 or dz ~= 0 then
                    core.set_node({ x = packet_pos.x - 1, y = packet_pos.y + dy, z = packet_pos.z + dz }, { name = "default:stone" })
                end
            end
        end
        check(core.get_node({ x = packet_pos.x - 1, y = packet_pos.y, z = packet_pos.z }).name == "default:wood",
            "owner's persisted wood backing was unexpectedly changed")
        check(guest:set_wielded_item("default:wood 3"), "could not equip outsider placeable block")
        packet_phase = "place"
        return "PASS protected browser place target armed"
    end)
    write_result("town-packet-place-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

core.register_globalstep(function()
    if not packet_place_ready or packet_place_aimed or packet_phase ~= "place" then return end
    local arm = io.open(world .. "/town-packet-place-aim.txt", "r")
    if not arm then return end
    arm:close()
    packet_place_aimed = true
    local guest = core.get_player_by_name(packet_guest)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-place-aim-ready.txt", "PASS browser camera aimed at protected place target", true)
end)

core.register_globalstep(function()
    if not packet_place_done or owner_place_ready then return end
    local arm = io.open(world .. "/town-packet-owner-place-arm.txt", "r")
    if not arm then return end
    arm:close()
    owner_place_ready = true
    local ok, result = pcall(function()
        local owner = core.get_player_by_name(owner_name)
        local guest = core.get_player_by_name(packet_guest)
        check(owner ~= nil, "owner disconnected before browser place probe")
        check(guest ~= nil, "outsider disconnected before owner browser place probe")
        check(core.get_node(packet_pos).name == "air", "outsider changed protected placement target")
        check(core.get_node({ x = packet_pos.x - 1, y = packet_pos.y, z = packet_pos.z }).name == "default:wood",
            "owner's backing node disappeared before browser place probe")
        check(owner:set_wielded_item("default:wood 3"), "could not equip owner placeable block")
        guest:set_pos({ x = packet_pos.x + 5, y = packet_pos.y - 1.5, z = packet_pos.z })
        owner:set_physics_override({ gravity = 0 })
        owner:set_pos({ x = packet_pos.x + 2.5, y = packet_pos.y - 1.5, z = packet_pos.z })
        owner:set_look_horizontal(math.pi / 2)
        owner:set_look_vertical(0)
        return "PASS owner browser place target armed"
    end)
    write_result("town-packet-owner-place-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

core.register_globalstep(function()
    if not owner_place_ready or owner_place_aimed then return end
    local arm = io.open(world .. "/town-packet-owner-place-aim.txt", "r")
    if not arm then return end
    arm:close()
    owner_place_aimed = true
    local owner = core.get_player_by_name(owner_name)
    if not owner then return end
    owner:set_look_horizontal(math.pi / 2)
    owner:set_look_vertical(0)
    write_result("town-packet-owner-place-aim-ready.txt", "PASS owner browser camera aimed at claimed place target", true)
end)

core.register_globalstep(function()
    if not owner_place_done or owner_dig_ready then return end
    local arm = io.open(world .. "/town-packet-owner-dig-arm.txt", "r")
    if not arm then return end
    arm:close()
    owner_dig_ready = true
    local ok, result = pcall(function()
        local owner = core.get_player_by_name(owner_name)
        check(owner ~= nil, "owner disconnected before browser dig probe")
        check(core.get_node(packet_pos).name == "default:wood", "owner place target missing before browser dig")
        check(owner:set_wielded_item("default:axe_steel"), "could not equip owner steel axe")
        return "PASS owner browser dig target armed"
    end)
    write_result("town-packet-owner-dig-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

core.register_globalstep(function()
    if not owner_dig_ready or owner_dig_aimed then return end
    local arm = io.open(world .. "/town-packet-owner-dig-aim.txt", "r")
    if not arm then return end
    arm:close()
    owner_dig_aimed = true
    local owner = core.get_player_by_name(owner_name)
    if not owner then return end
    owner:set_look_horizontal(math.pi / 2)
    owner:set_look_vertical(0)
    write_result("town-packet-owner-dig-aim-ready.txt", "PASS owner browser camera aimed at claimed dig target", true)
end)

core.register_globalstep(function()
    if not owner_dig_aimed or owner_dig_reaimed then return end
    local arm = io.open(world .. "/town-packet-owner-dig-reaim.txt", "r")
    if not arm then return end
    arm:close()
    owner_dig_reaimed = true
    local owner = core.get_player_by_name(owner_name)
    if not owner then return end
    owner:set_look_horizontal(math.pi / 2)
    owner:set_look_vertical(0)
    write_result("town-packet-owner-dig-reaim-ready.txt", "PASS owner browser camera reset during held dig", true)
end)

core.register_globalstep(function()
    if not owner_dig_done or member_place_ready then return end
    local arm = io.open(world .. "/town-packet-member-place-arm.txt", "r")
    if not arm then return end
    arm:close()
    member_place_ready = true
    local ok, result = pcall(function()
        local owner = core.get_player_by_name(owner_name)
        local guest = core.get_player_by_name(guest_name)
        check(owner and guest, "wallet players disconnected before invited-member browser probe")
        check(core.get_node(packet_pos).name == "air", "owner dig did not clear member target")
        check(core.get_node({ x = packet_pos.x - 1, y = packet_pos.y, z = packet_pos.z }).name == "default:wood",
            "member placement backing node is missing")
        local town = core.registered_chatcommands.town
        local invited, message = town.func(owner_name, "invite " .. guest_name)
        check(invited, "member reinvitation failed: " .. tostring(message))
        local accepted, reply = town.func(guest_name, "accept " .. owner_name)
        check(accepted, "member acceptance failed: " .. tostring(reply))
        check(not core.is_protected(packet_pos, guest_name), "invited member lacks build access")
        check(guest:set_wielded_item("default:wood 3"), "could not equip invited member wood")
        owner:set_pos({ x = packet_pos.x - 6, y = packet_pos.y - 1.5, z = packet_pos.z + 6 })
        guest:set_pos({ x = packet_pos.x + 2.5, y = packet_pos.y - 1.5, z = packet_pos.z })
        guest:set_look_horizontal(math.pi / 2)
        guest:set_look_vertical(0)
        packet_phase = "member_place"
        return "PASS invited-member browser place target armed"
    end)
    write_result("town-packet-member-place-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

core.register_globalstep(function()
    if not member_place_ready or member_place_aimed then return end
    local arm = io.open(world .. "/town-packet-member-place-aim.txt", "r")
    if not arm then return end
    arm:close()
    member_place_aimed = true
    local guest = core.get_player_by_name(guest_name)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-member-place-aim-ready.txt", "PASS invited-member browser camera aimed at place target", true)
end)

core.register_globalstep(function()
    if not member_place_done or member_dig_ready then return end
    local arm = io.open(world .. "/town-packet-member-dig-arm.txt", "r")
    if not arm then return end
    arm:close()
    member_dig_ready = true
    local ok, result = pcall(function()
        local guest = core.get_player_by_name(guest_name)
        check(guest ~= nil, "invited member disconnected before browser dig")
        check(core.get_node(packet_pos).name == "default:wood", "member place target missing before dig")
        check(guest:set_wielded_item("default:axe_steel"), "could not equip invited member axe")
        packet_phase = "member_dig"
        return "PASS invited-member browser dig target armed"
    end)
    write_result("town-packet-member-dig-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

core.register_globalstep(function()
    if not member_dig_ready or member_dig_aimed then return end
    local arm = io.open(world .. "/town-packet-member-dig-aim.txt", "r")
    if not arm then return end
    arm:close()
    member_dig_aimed = true
    local guest = core.get_player_by_name(guest_name)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-member-dig-aim-ready.txt", "PASS invited-member browser camera aimed at dig target", true)
end)

core.register_globalstep(function()
    if not member_dig_aimed or member_dig_reaimed then return end
    local arm = io.open(world .. "/town-packet-member-dig-reaim.txt", "r")
    if not arm then return end
    arm:close()
    member_dig_reaimed = true
    local guest = core.get_player_by_name(guest_name)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-member-dig-reaim-ready.txt", "PASS invited-member browser camera reset during held dig", true)
end)

core.register_globalstep(function()
    if not member_dig_done or removed_place_ready then return end
    local arm = io.open(world .. "/town-packet-removed-place-arm.txt", "r")
    if not arm then return end
    arm:close()
    removed_place_ready = true
    local ok, result = pcall(function()
        local guest = core.get_player_by_name(guest_name)
        check(guest ~= nil, "member disconnected before removal probe")
        check(core.get_node(packet_pos).name == "air", "member dig did not clear removal target")
        local town = core.registered_chatcommands.town
        local removed, message = town.func(owner_name, "kick " .. guest_name)
        check(removed, "member removal failed: " .. tostring(message))
        check(core.is_protected(packet_pos, guest_name), "removed member retained build access")
        check(guest:set_wielded_item("default:wood 3"), "could not equip removed member wood")
        packet_phase = "removed_place"
        return "PASS removed-member browser place target armed"
    end)
    write_result("town-packet-removed-place-ready.txt", ok and result or "FAIL " .. tostring(result), ok)
end)

core.register_globalstep(function()
    if not removed_place_ready or removed_place_aimed then return end
    local arm = io.open(world .. "/town-packet-removed-place-aim.txt", "r")
    if not arm then return end
    arm:close()
    removed_place_aimed = true
    local guest = core.get_player_by_name(guest_name)
    if not guest then return end
    guest:set_look_horizontal(math.pi / 2)
    guest:set_look_vertical(0)
    write_result("town-packet-removed-place-aim-ready.txt", "PASS removed-member browser camera aimed at protected place target", true)
end)

core.register_globalstep(function()
    if not removed_place_done or expired_grant_checked then return end
    local arm = io.open(world .. "/town-expired-grant-check-arm.txt", "r")
    if not arm then return end
    arm:close()
    expired_grant_checked = true
    local ok, result = pcall(function()
        check(core.get_player_by_name(owner_name) ~= nil, "owner disconnected before expiry check")
        local file = assert(io.open(world .. "/wallet_grants/" .. owner_name .. ".json", "r"))
        local expired_grant = core.parse_json(file:read("*a"))
        file:close()
        check(expired_grant and expired_grant.expires_at <= os.time(), "ticket was not expired for the check")
        local auth = core.get_auth_handler().get_auth(owner_name)
        check(auth and auth.password ~= expired_grant.password_hash,
            "expired ticket password remained usable while owner was connected")
        check(auth.privileges.interact == true,
            "expired ticket auth lookup lost interact privilege")
        check(core.get_player_privs(owner_name).interact == true,
            "authenticated owner lost interact privilege after ticket expiry")
        check(not core.is_protected(claim_pos, owner_name),
            "authenticated owner lost access to own claim after ticket expiry")
        return "PASS expired ticket password rejected while connected owner retains interact and town access"
    end)
    write_result("town-expired-grant-check-result.txt", ok and result or "FAIL " .. tostring(result), ok)
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
