-- CI-only integration probe. Installed into the disposable test world by the
-- native-smoke workflow, never into a public world or production game pack.
local world = core.get_worldpath()
local elapsed = 0
local finished = false
local owner_name, guest_name, claim_pos, inventory_slot
local owner_left = false

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
    local inventory = player:get_inventory()
    local slot = inventory:get_size("main")
    check(slot >= 1, "owner has no main inventory")
    inventory:set_stack("main", slot, "default:diamond 3")
    check(inventory:get_stack("main", slot):get_count() == 3, "inventory fixture could not be set")
    owner_name, guest_name, claim_pos, inventory_slot = owner, guest, pos, slot
    return "PASS owner/outsider/member protection, paid quota, invitation and removal"
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

core.register_globalstep(function(dtime)
    if finished then return end
    elapsed = elapsed + dtime
    if elapsed < 1 then return end
    elapsed = 0
    local config = read_config()
    if not config or not core.get_player_by_name(config.owner) or not core.get_player_by_name(config.guest) then return end
    finished = true
    local ok, result = pcall(run, config)
    local status = ok and result or "FAIL " .. tostring(result)
    write_result("town-probe-result.txt", status, ok)
end)
