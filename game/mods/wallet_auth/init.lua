-- EXPERIMENTAL: verify against the pinned native and WASM engine before public use.
-- This replaces ordinary password registration. Wallet signatures are checked only
-- by the Node service; this mod reads its two-minute grants inside the world dir.
local storage = core.get_mod_storage()
local dir = core.get_worldpath() .. "/wallet_grants/"
local identities = {}

local function grant(name)
    if type(name) ~= "string" or not name:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") then return nil end
    local file = io.open(dir .. name .. ".json", "r")
    if not file then return nil end
    local raw = file:read(4097)
    file:close()
    if not raw or #raw > 4096 then return nil end
    local value = core.parse_json(raw)
    if type(value) ~= "table" or value.name ~= name then return nil end
    if type(value.expires_at) ~= "number" or value.expires_at <= os.time() then return nil end
    if type(value.address) ~= "string" or not value.address:match("^0x%x+$") or #value.address ~= 42 then return nil end
    if type(value.password_hash) ~= "string" or #value.password_hash ~= 28 then return nil end
    local known = storage:get_string("address:" .. name)
    if known ~= "" and known:lower() ~= value.address:lower() then return nil end
    return value
end

local function privileges(name)
    local saved = storage:get_string("privs:" .. name)
    -- Never grant server/admin privileges just because someone owns a wallet.
    if saved == "" then return { interact = true, shout = true } end
    return core.deserialize(saved, true) or {}
end

core.register_authentication_handler({
    get_auth = function(name)
        local value = grant(name)
        if not value then return nil end
        return { password = value.password_hash, privileges = privileges(name),
            last_login = storage:get_int("last_login:" .. name) }
    end,
    create_auth = function() return false end,
    delete_auth = function() return false end,
    set_password = function() return false end,
    set_privileges = function(name, privs)
        if not grant(name) and storage:get_string("address:" .. name) == "" then return false end
        storage:set_string("privs:" .. name, core.serialize(privs))
        core.notify_authentication_modified(name)
        return true
    end,
    reload = function() return true end,
    record_login = function(name) storage:set_int("last_login:" .. name, os.time()) end,
})

core.register_on_prejoinplayer(function(name)
    if not grant(name) then return "Sign in with your wallet at the Miners launcher and request a fresh game session." end
end)

core.register_on_joinplayer(function(player)
    local name = player:get_player_name()
    local value = grant(name)
    if not value then core.kick_player(name, "Wallet grant expired; please relaunch.") return end
    identities[name] = value.address
    storage:set_string("address:" .. name, value.address)
    core.chat_send_player(name, "Wallet connected. Use /wallet to see your address. Currency gameplay is not enabled yet.")
end)
core.register_on_leaveplayer(function(player) identities[player:get_player_name()] = nil end)
core.register_chatcommand("wallet", {
    description = "Show the Ethereum address linked to your character",
    func = function(name)
        local address = identities[name]
        if not address then return false, "No verified wallet for this connection." end
        return true, "Wallet: " .. address
    end,
})
