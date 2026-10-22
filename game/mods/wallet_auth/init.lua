-- EXPERIMENTAL: verify against the pinned native and WASM engine before public use.
-- This replaces ordinary password registration. Wallet signatures are checked only
-- by the Node service; this mod reads its two-minute grants inside the world dir.
local storage = core.get_mod_storage()
local dir = core.get_worldpath() .. "/wallet_grants/"
local balance_dir = core.get_worldpath() .. "/wallet_balances/"
local identities = {}
local pending = {}

local function grant(name, allow_expired)
    if type(name) ~= "string" or not name:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") then return nil end
    local file = io.open(dir .. name .. ".json", "r")
    if not file then return nil end
    local raw = file:read(4097)
    file:close()
    if not raw or #raw > 4096 then return nil end
    local value = core.parse_json(raw)
    if type(value) ~= "table" or value.name ~= name then return nil end
    if type(value.expires_at) ~= "number" or (not allow_expired and value.expires_at <= os.time()) then return nil end
    if type(value.address) ~= "string" or not value.address:match("^0x%x+$") or #value.address ~= 42 then return nil end
    if type(value.password_hash) ~= "string" or #value.password_hash ~= 27 then return nil end
    if value.ens_name ~= nil and (type(value.ens_name) ~= "string" or #value.ens_name > 255 or value.ens_name:find("[%c]")) then return nil end
    local known = storage:get_string("address:" .. name)
    if known ~= "" and known:lower() ~= value.address:lower() then return nil end
    return value
end

local function same_grant(value, started)
    return value and started and value.password_hash == started.password_hash and
        value.session_hash == started.session_hash and value.address:lower() == started.address:lower()
end

local function privileges(name)
    local saved = storage:get_string("privs:" .. name)
    -- Never grant server/admin privileges just because someone owns a wallet.
    if saved == "" then return { interact = true, shout = true } end
    return core.deserialize(saved, true) or {}
end

local function observed_balance(name, address)
    if not name:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") then return nil end
    local file = io.open(balance_dir .. name .. ".json", "r")
    if not file then return nil end
    local raw = file:read(4097)
    file:close()
    if not raw or #raw > 4096 then return nil end
    local value = core.parse_json(raw)
    if type(value) ~= "table" or value.name ~= name or type(value.address) ~= "string" or
        value.address:lower() ~= address:lower() then return nil end
    if type(value.token) ~= "string" or #value.token ~= 42 or not value.token:match("^0x%x+$") then return nil end
    if type(value.raw) ~= "string" or #value.raw > 128 or not value.raw:match("^%d+$") then return nil end
    if type(value.formatted) ~= "string" or #value.formatted > 128 or
        not value.formatted:match("^%d+%.?%d*$") then return nil end
    if type(value.chain_id) ~= "number" or type(value.block_number) ~= "number" or
        value.block_number < 0 or value.block_number ~= math.floor(value.block_number) then return nil end
    if type(value.expires_at) ~= "number" or value.expires_at <= os.time() then return nil end
    return value
end

core.register_authentication_handler({
    get_auth = function(name)
        local value = grant(name)
        if not value and core.get_player_by_name(name) then
            -- Luanti asks for auth again when a client becomes ready and for
            -- privilege checks during play. Only an already emerged player
            -- may use the expired grant accepted at the start of its login.
            local current = grant(name, true)
            if same_grant(current, pending[name] or identities[name]) then value = current end
        end
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
    local value = grant(name)
    if not value then return "Sign in with your wallet at the MineMine launcher and request a fresh game session." end
    -- The engine authenticates before downloading media and joining the world.
    -- Keep the grant identity from the start of that handshake so a slow load
    -- can finish after the short ticket expires, without accepting a revoked
    -- or replaced grant.
    pending[name] = value
end)

core.register_on_joinplayer(function(player)
    local name = player:get_player_name()
    local value = grant(name, true)
    local started = pending[name]
    pending[name] = nil
    if not same_grant(value, started) then
        core.kick_player(name, "Wallet grant changed or was revoked; please relaunch.")
        return
    end
    identities[name] = value
    storage:set_string("address:" .. name, value.address)
    if value.ens_name then player:set_nametag_attributes({ text = value.ens_name }) end
    core.chat_send_player(name, "Wallet connected. Use /wallet for your address, /wallet balance for a recent MINE balance, or /town to manage claims.")
end)
core.register_on_leaveplayer(function(player)
    local name = player:get_player_name()
    identities[name] = nil
    pending[name] = nil
end)
core.register_chatcommand("wallet", {
    params = "[balance]",
    description = "Show your verified wallet or recent observed MINE balance",
    func = function(name, param)
        local identity = identities[name]
        if not identity then return false, "No verified wallet for this connection." end
        if param == "balance" then
            local value = observed_balance(name, identity.address)
            if not value then return false, "No recent MINE balance. Refresh balance in the MineMine wallet panel, then try again." end
            return true, "Observed MINE balance: " .. value.formatted .. " on chain " .. value.chain_id ..
                " at block " .. value.block_number .. ". This is a wallet snapshot, not spendable town credit."
        end
        if param ~= nil and param ~= "" then return false, "Usage: /wallet [balance]" end
        return true, "Wallet: " .. identity.address .. (identity.ens_name and " · ENS: " .. identity.ens_name or "")
    end,
})
