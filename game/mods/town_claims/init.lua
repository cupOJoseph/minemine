-- Prototype town protection for the wallet-gated shared world.
-- Payment is verified by the Node service and exported as private quota files.
-- A purchased "block" is one x/z column, protected at every height.
local storage = core.get_mod_storage()
local saved = core.deserialize(storage:get_string("towns:v1"), true)
local state = type(saved) == "table" and saved or { towns = {}, invitations = {} }
state.towns = type(state.towns) == "table" and state.towns or {}
state.invitations = type(state.invitations) == "table" and state.invitations or {}
local quota_dir = core.get_worldpath() .. "/town_quotas/"
local previous_is_protected = core.is_protected

local function persist()
    storage:set_string("towns:v1", core.serialize(state))
end

local function wallet_name(name)
    return type(name) == "string" and name:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") ~= nil
end

local function quota(name)
    if not wallet_name(name) then return 0 end
    local file = io.open(quota_dir .. name .. ".json", "r")
    if not file then return 0 end
    local raw = file:read(4097)
    file:close()
    if not raw or #raw > 4096 then return 0 end
    local value = core.parse_json(raw)
    if type(value) ~= "table" or value.name ~= name then return 0 end
    if type(value.blocks) ~= "number" or value.blocks < 0 or value.blocks > 1000000 or value.blocks % 1 ~= 0 then return 0 end
    return value.blocks
end

local function town_of(name)
    for owner, town in pairs(state.towns) do
        if owner == name or town.members[name] then return owner, town end
    end
end

local function inside(claim, pos)
    return pos.x >= claim.x1 and pos.x <= claim.x2 and pos.z >= claim.z1 and pos.z <= claim.z2
end

local function overlaps(a, b)
    return a.x1 <= b.x2 and a.x2 >= b.x1 and a.z1 <= b.z2 and a.z2 >= b.z1
end

local function used(town)
    local total = 0
    for _, claim in ipairs(town.claims) do
        total = total + (claim.x2 - claim.x1 + 1) * (claim.z2 - claim.z1 + 1)
    end
    return total
end

-- Luanti's standard dig/place protection entry point. Other protection mods
-- retain their original decision; town membership never bypasses them.
core.is_protected = function(pos, name)
    if previous_is_protected(pos, name) then return true end
    if name and core.check_player_privs(name, { protection_bypass = true }) then return false end
    for owner, town in pairs(state.towns) do
        for _, claim in ipairs(town.claims) do
            if inside(claim, pos) then
                return name ~= owner and not town.members[name]
            end
        end
    end
    return false
end

core.register_chatcommand("town", {
    params = "create <name> | claim <radius> | unclaim | invite <player> | accept <owner> | kick <player> | leave | info",
    description = "Create and manage a wallet-funded protected town",
    func = function(name, param)
        if not wallet_name(name) then return false, "Town commands require a wallet account." end
        local command, argument = (param or ""):match("^(%S+)%s*(.-)%s*$")
        local owner, town = town_of(name)
        if command == "create" then
            if owner then return false, "You already belong to a town." end
            if #argument < 3 or #argument > 24 or not argument:match("^[%w _%-]+$") then return false, "Use a town name of 3–24 letters, numbers, spaces, _ or -." end
            state.towns[name] = { name = argument, members = {}, claims = {} }
            persist()
            return true, "Town " .. argument .. " created. Buy MINE land credits, sync them, then use /town claim <radius>."
        elseif command == "info" then
            if not town then return false, "You do not belong to a town." end
            return true, town.name .. " · owner " .. owner .. " · protected " .. used(town) .. "/" .. quota(owner) .. " columns"
        elseif command == "claim" then
            if owner ~= name then return false, "Only the town owner can claim land." end
            local radius = tonumber(argument)
            if not radius or radius % 1 ~= 0 or radius < 1 or radius > 16 then return false, "Choose an integer radius from 1 to 16." end
            local player = core.get_player_by_name(name)
            if not player then return false, "Player is not in the world." end
            local pos = player:get_pos()
            local x, z, y = math.floor(pos.x), math.floor(pos.z), math.floor(pos.y)
            local claim = { x1 = x - radius, x2 = x + radius, z1 = z - radius, z2 = z + radius }
            local area = (2 * radius + 1) ^ 2
            if used(town) + area > quota(name) then return false, "Insufficient confirmed land credits. Sync your purchase in the wallet lab." end
            for _, other_town in pairs(state.towns) do
                for _, other in ipairs(other_town.claims) do
                    if overlaps(claim, other) then return false, "This area overlaps an existing town claim." end
                end
            end
            for cx = claim.x1, claim.x2 do
                for cz = claim.z1, claim.z2 do
                    if previous_is_protected({ x = cx, y = y, z = cz }, name) then return false, "Another protection mod already protects part of this area." end
                end
            end
            table.insert(town.claims, claim)
            persist()
            return true, "Protected " .. area .. " columns for " .. town.name .. "."
        elseif command == "unclaim" then
            if owner ~= name then return false, "Only the town owner can unclaim land." end
            local player = core.get_player_by_name(name)
            if not player then return false, "Player is not in the world." end
            local pos = player:get_pos()
            for index, claim in ipairs(town.claims) do
                if inside(claim, pos) then
                    table.remove(town.claims, index)
                    persist()
                    return true, "Area unclaimed. Purchased credits remain available for another claim."
                end
            end
            return false, "Stand inside one of your town's claims."
        elseif command == "invite" then
            if owner ~= name then return false, "Only the town owner can invite players." end
            if not wallet_name(argument) or argument == name then return false, "Enter a wallet player name (w_…)." end
            if town_of(argument) then return false, "That player already belongs to a town." end
            state.invitations[argument] = name
            persist()
            return true, "Invitation saved. Ask " .. argument .. " to use /town accept " .. name .. "."
        elseif command == "accept" then
            if owner then return false, "Leave your current town first." end
            if state.invitations[name] ~= argument or not state.towns[argument] then return false, "No invitation from that town owner." end
            state.towns[argument].members[name] = true
            state.invitations[name] = nil
            persist()
            return true, "Joined " .. state.towns[argument].name .. "."
        elseif command == "kick" then
            if owner ~= name then return false, "Only the town owner can remove members." end
            if not town.members[argument] then return false, "That player is not a member." end
            town.members[argument] = nil
            persist()
            return true, "Removed " .. argument .. " from the town."
        elseif command == "leave" then
            if not town or owner == name then return false, "Owners cannot leave their town." end
            town.members[name] = nil
            persist()
            return true, "You left " .. town.name .. "."
        end
        return false, "Use /town create, claim, unclaim, invite, accept, kick, leave, or info."
    end,
})
