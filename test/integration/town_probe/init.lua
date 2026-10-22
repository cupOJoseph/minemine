-- CI-only integration probe. Installed into the disposable test world by the
-- native-smoke workflow, never into a public world or production game pack.
local world = core.get_worldpath()
local elapsed = 0
local finished = false

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
    return "PASS owner/outsider/member protection, paid quota, invitation and removal"
end

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
    local file = assert(io.open(world .. "/town-probe-result.txt", "w"))
    file:write(status, "\n")
    file:close()
    core.log(ok and "action" or "error", "Town probe: " .. status)
end)
