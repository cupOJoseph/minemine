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

-- Public, read-only projection for a map built from a stopped world copy.
-- Never include owner names, wallet addresses, members, invitations or quotas.
local function export_map_claims()
    local entries = {}
    for _, town in pairs(state.towns) do
        if type(town) == "table" and type(town.name) == "string" and
                #town.name >= 3 and #town.name <= 24 and town.name:match("^[%w _%-]+$") and
                type(town.claims) == "table" then
            for _, claim in ipairs(town.claims) do
                if type(claim) == "table" then
                    local valid = true
                    for _, key in ipairs({ "x1", "x2", "z1", "z2" }) do
                        local value = claim[key]
                        if type(value) ~= "number" or value % 1 ~= 0 or math.abs(value) > 30927 then valid = false end
                    end
                    if valid and claim.x1 <= claim.x2 and claim.z1 <= claim.z2 and
                            claim.x2 - claim.x1 <= 32 and claim.z2 - claim.z1 <= 32 then
                        entries[#entries + 1] = { town = town.name, x1 = claim.x1,
                            x2 = claim.x2, z1 = claim.z1, z2 = claim.z2 }
                    end
                end
            end
        end
    end
    table.sort(entries, function(a, b)
        if a.town ~= b.town then return a.town < b.town end
        if a.x1 ~= b.x1 then return a.x1 < b.x1 end
        return a.z1 < b.z1
    end)
    local encoded = {}
    for index, entry in ipairs(entries) do encoded[index] = assert(core.write_json(entry)) end
    local payload = '{"version":1,"claims":[' .. table.concat(encoded, ",") .. ']}\n'
    if not core.safe_file_write(core.get_worldpath() .. "/town-map-claims.json", payload) then
        core.log("error", "town_claims: could not update public map projection")
    end
end

-- Private world projection for the authenticated admin player explorer.
-- Keep the public map export above free of player and membership data.
local function export_admin_roster()
    local entries = {}
    for owner, town in pairs(state.towns) do
        if type(owner) == "string" and owner:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") and
                type(town) == "table" and type(town.name) == "string" and
                #town.name >= 3 and #town.name <= 24 and town.name:match("^[%w _%-]+$") and
                type(town.members) == "table" and type(town.claims) == "table" then
            local members = {}
            for member, joined in pairs(town.members) do
                if joined == true and type(member) == "string" and
                        member:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") and member ~= owner then
                    members[#members + 1] = member
                end
            end
            table.sort(members)
            local columns = 0
            for _, claim in ipairs(town.claims) do
                if type(claim) == "table" and type(claim.x1) == "number" and type(claim.x2) == "number" and
                        type(claim.z1) == "number" and type(claim.z2) == "number" and
                        claim.x1 <= claim.x2 and claim.z1 <= claim.z2 then
                    columns = columns + (claim.x2 - claim.x1 + 1) * (claim.z2 - claim.z1 + 1)
                end
            end
            entries[#entries + 1] = { owner = owner, name = town.name, members = members,
                claims = #town.claims, protectedColumns = columns }
        end
    end
    table.sort(entries, function(a, b) return a.owner < b.owner end)
    local encoded = {}
    for index, entry in ipairs(entries) do
        local members = {}
        for member_index, member in ipairs(entry.members) do members[member_index] = assert(core.write_json(member)) end
        encoded[index] = '{"owner":' .. assert(core.write_json(entry.owner)) ..
            ',"name":' .. assert(core.write_json(entry.name)) ..
            ',"members":[' .. table.concat(members, ",") .. ']' ..
            ',"claims":' .. entry.claims .. ',"protectedColumns":' .. entry.protectedColumns .. '}'
    end
    local payload = '{"version":1,"towns":[' .. table.concat(encoded, ",") .. ']}\n'
    if not core.safe_file_write(core.get_worldpath() .. "/town-admin-roster.json", payload) then
        core.log("error", "town_claims: could not update private admin roster")
    end
end

local function persist()
    storage:set_string("towns:v1", core.serialize(state))
    export_map_claims()
    export_admin_roster()
end

export_map_claims()
export_admin_roster()

local function wallet_name(name)
    return type(name) == "string" and name:match("^w_%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$") ~= nil
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

local function counts()
    local towns, claims = 0, 0
    for _, town in pairs(state.towns) do
        towns = towns + 1
        claims = claims + #town.claims
    end
    return towns, claims
end

local manager_form = "town_claims:manager"
local function show_manager(name, message)
    local owner, town = town_of(name)
    local parts = {
        "formspec_version[4]size[10,8.5]",
        "label[0.5,0.5;MineMine towns]",
        "button_exit[8,7.7;1.5,0.7;close;Close]",
    }
    if not town then
        parts[#parts + 1] = "label[0.5,1.0;9,0.8;Create a town, then buy and sync MINE land credits before claiming.]"
        parts[#parts + 1] = "field[0.5,2.0;5.7,0.8;town_name;Town name;]"
        parts[#parts + 1] = "button[6.5,2.0;2.5,0.8;create;Create town]"
        local inviter = state.invitations[name]
        local invited_town = inviter and state.towns[inviter]
        if invited_town then
            parts[#parts + 1] = "label[0.5,3.4;Invitation from " .. core.formspec_escape(inviter) ..
                " to join " .. core.formspec_escape(invited_town.name) .. "]"
            parts[#parts + 1] = "button[0.5,4.0;2.5,0.8;accept;Join town]"
        else
            parts[#parts + 1] = "label[0.5,3.4;No pending town invitation.]"
        end
    elseif owner == name then
        local members = 0
        local member_ids = {}
        for member in pairs(town.members) do
            members = members + 1
            member_ids[#member_ids + 1] = core.formspec_escape(member)
        end
        table.sort(member_ids)
        parts[#parts + 1] = "label[0.5,1.2;" .. core.formspec_escape(town.name) .. " - owner]"
        parts[#parts + 1] = "label[0.5,1.7;Protected " .. used(town) .. "/" .. quota(name) ..
            " columns, " .. #town.claims .. " claims, " .. members .. " members]"
        parts[#parts + 1] = "field[0.5,2.6;3.1,0.8;claim_radius;Claim radius (1-16);1]"
        parts[#parts + 1] = "button[3.8,2.6;2.0,0.8;claim;Claim here]"
        parts[#parts + 1] = "button[6.0,2.6;2.7,0.8;unclaim;Unclaim here]"
        parts[#parts + 1] = "field[0.5,4.1;5.0,0.8;member_id;Wallet player ID (w_...);]"
        parts[#parts + 1] = "button[5.7,4.1;1.5,0.8;invite;Invite]"
        parts[#parts + 1] = "button[7.4,4.1;1.5,0.8;kick;Remove]"
        parts[#parts + 1] = "label[0.5,5.2;Members (copy an ID into the field above to remove):]"
        parts[#parts + 1] = "textlist[0.5,5.6;8.5,1.1;members_list;" ..
            (#member_ids > 0 and table.concat(member_ids, ",") or "No members") .. ";0;false]"
        parts[#parts + 1] = "label[0.5,6.7;9,0.6;Stand inside a claim to unclaim it. Wallet credit sync is on the website.]"
    else
        parts[#parts + 1] = "label[0.5,1.2;Member of " .. core.formspec_escape(town.name) .. "]"
        parts[#parts + 1] = "label[0.5,1.7;Owner: " .. core.formspec_escape(owner) .. "]"
        parts[#parts + 1] = "label[0.5,2.2;Protected " .. used(town) .. "/" .. quota(owner) .. " columns]"
        parts[#parts + 1] = "button[0.5,3.0;2.5,0.8;leave;Leave town]"
    end
    if message then parts[#parts + 1] = "label[0.5,7.2;7.2,1.0;" .. core.formspec_escape(message) .. "]" end
    core.show_formspec(name, manager_form, table.concat(parts))
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
    params = "[menu] | create <name> | claim <radius> | unclaim | invite <player> | accept <owner> | kick <player> | leave | info",
    description = "Create and manage a wallet-funded protected town",
    func = function(name, param)
        if not wallet_name(name) then return false, "Town commands require a wallet account." end
        local command, argument = (param or ""):match("^(%S+)%s*(.-)%s*$")
        if not command or command == "menu" then
            show_manager(name)
            return true, "Town manager opened."
        end
        local owner, town = town_of(name)
        if command == "create" then
            if owner then return false, "You already belong to a town." end
            local town_count = counts()
            if town_count >= 128 then return false, "This prototype world has reached its town limit." end
            if #argument < 3 or #argument > 24 or not argument:match("^[%w _%-]+$") then return false, "Use a town name of 3–24 letters, numbers, spaces, _ or -." end
            state.towns[name] = { name = argument, members = {}, claims = {} }
            persist()
            return true, "Town " .. argument .. " created. Buy MINE land credits, sync them, then use /town claim <radius>."
        elseif command == "info" then
            if not town then return false, "You do not belong to a town." end
            return true, town.name .. " · owner " .. owner .. " · protected " .. used(town) .. "/" .. quota(owner) .. " columns"
        elseif command == "claim" then
            if owner ~= name then return false, "Only the town owner can claim land." end
            local _, claim_count = counts()
            if claim_count >= 1024 or #town.claims >= 256 then return false, "This prototype world has reached its claim limit." end
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

core.register_on_player_receive_fields(function(player, formname, fields)
    if formname ~= manager_form then return end
    local name = player:get_player_name()
    if not wallet_name(name) or fields.quit then return true end
    local action
    for _, candidate in ipairs({ "create", "claim", "unclaim", "invite", "kick", "accept", "leave" }) do
        if fields[candidate] then
            if action then
                show_manager(name, "Choose one town action at a time.")
                return true
            end
            action = candidate
        end
    end
    if not action then return true end
    local argument = ""
    if action == "create" then argument = fields.town_name
    elseif action == "claim" then argument = fields.claim_radius
    elseif action == "invite" or action == "kick" then argument = fields.member_id
    elseif action == "accept" then argument = state.invitations[name] end
    if type(argument) ~= "string" or #argument > 64 then
        show_manager(name, "Invalid town form input.")
        return true
    end
    local ok, result = core.registered_chatcommands.town.func(name, action .. " " .. argument)
    show_manager(name, result or (ok and "Town updated." or "Town action failed."))
    return true
end)
