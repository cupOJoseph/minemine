local modpath, initialize_fixture, markers = ...
local api = dofile(modpath .. "/planner.lua")
local village = assert(loadfile(modpath .. "/village.lua"))(modpath, api)
local storage = core.get_mod_storage()
local busy = false
-- The sole local player can use the workshop without Luanti's general
-- maintenance privilege. An opted-in multiplayer workshop stays admin-only.
local workshop_privs = core.is_singleplayer() and {} or {server = true}
core.register_on_mods_loaded(village.load_templates)

local style_names = {}
for style in pairs(village.styles) do style_names[#style_names + 1] = style end
table.sort(style_names)

core.register_chatcommand("structure_preview", {
    params = "<style> <seed> [count] [compact]",
    description = "Visit a gallery of 1–12 seeded villages. Styles: " .. table.concat(style_names, ", "),
    privs = workshop_privs,
    func = function(player_name, param)
        local style, seed, count, size = param:match("^%s*(%a+)%s+(%d+)%s*(%d*)%s*(%a*)%s*$")
        seed, count = tonumber(seed), tonumber(count) or 1
        if not village.styles[style] or not seed or seed + count - 1 > 4294967295 or count < 1 or count > 12
            or (size ~= "" and size ~= "compact") then
            return false, "Try /structure_preview tundra 42 6. Styles: " .. table.concat(style_names, ", ")
        end
        if busy then return false, "A preview is already being generated." end
        local player = core.get_player_by_name(player_name)
        if not player then return false, "Join the world to use the workshop." end
        local batch = storage:get_int("preview_batches")
        -- Separate galleries in otherwise empty space. Bounds and an air check
        -- prevent a preview from replacing existing nodes.
        if batch >= 512 then return false, "This world has reached its workshop limit." end
        storage:set_int("preview_batches", batch + 1)
        local z, y = -16000 + batch * 48, 4096
        local return_pos = player:get_pos()
        busy = true
        local function build(i)
            if i >= count then
                busy = false
                local visitor = core.get_player_by_name(player_name)
                if visitor then
                    local key = "return_" .. player_name
                    if storage:get_string(key) == "" then storage:set_string(key, core.pos_to_string(return_pos, 1)) end
                    visitor:set_pos({x = 0, y = y + 1, z = z - 13})
                    visitor:set_look_horizontal(0)
                    core.chat_send_player(player_name, ("Gallery ready: %s, seeds %d through %d, west to east. /structure_return to go back."):format(style, seed, seed + count - 1))
                end
                return
            end
            local x = i * 60
            local minp = {x = x - 26, y = y - 1, z = z - 14}
            local maxp = {x = x + 33, y = y + 10, z = z + 14}
            core.emerge_area(minp, maxp, function(_, _, remaining)
                if remaining ~= 0 then return end
                core.after(0, function()
                    local dimensions = (maxp.x - minp.x + 1) * (maxp.y - minp.y + 1) * (maxp.z - minp.z + 1)
                    if #core.find_nodes_in_area(minp, maxp, {"air"}) ~= dimensions then
                        busy = false
                        core.chat_send_player(player_name, "Gallery area is occupied or unavailable. Try again for a new site.")
                        return
                    end
                    local layout = size == "compact" and village.definition.fallback or village.definition.plan
                    local plan = layout(style, PcgRandom(seed + i, 9001))
                    local function flat() return y end
                    local vm = VoxelManip(minp, maxp)
                    -- A continuous walkway connects each scene.
                    for pz = z - 14, z + 12 do
                        local end_x = pz <= z - 12 and (i + 1 < count and x + 33 or x + 25) or x + 25
                        for px = pz <= z - 12 and x - 26 or x - 25, end_x do
                            vm:set_node_at({x = px, y = y, z = pz}, {name = "default:stone_block"})
                        end
                    end
                    api.place(plan, vm, x, y, z, flat, true)
                    local label = {x = x, y = y + 1, z = z - 12}
                    vm:set_node_at(label, {name = "default:meselamp"})
                    vm:write_to_map()
                    core.get_meta(label):set_string("infotext", ("Seed %d · %d homes · %d workplaces"):format(seed + i, plan.counts.homes, plan.counts.occupations))
                    for _, p in ipairs(core.find_nodes_in_area(minp, maxp, markers)) do
                        initialize_fixture(p, core.get_node(p))
                    end
                    build(i + 1)
                end)
            end)
        end
        build(0)
        return true, ("Building %d %s village previews…"):format(count, style)
    end,
})

core.register_chatcommand("structure_return", {
    description = "Return to where you were before visiting the preview gallery",
    privs = workshop_privs,
    func = function(name)
        local player = core.get_player_by_name(name)
        local key = "return_" .. name
        local previous = core.string_to_pos(storage:get_string(key))
        if not player or not previous then return false, "No workshop return point." end
        player:set_pos(previous)
        storage:set_string(key, "")
        return true
    end,
})

core.register_chatcommand("structure_export", {
    params = "<name> <x,y,z> <x,y,z>",
    description = "Export a loaded selection to the world's structure_exports folder",
    privs = workshop_privs,
    func = function(_, param)
        local name, a, b = param:match("^%s*([%w_-]+)%s+([%d,-]+)%s+([%d,-]+)%s*$")
        if not name or #name > 40 then return false, "Try /structure_export house 12,4,10 18,10,16" end
        local function parse(s)
            local x, y, z = s:match("^(-?%d+),(-?%d+),(-?%d+)$")
            if x then return {x = tonumber(x), y = tonumber(y), z = tonumber(z)} end
        end
        local p1, p2 = parse(a), parse(b)
        if not p1 or not p2 then return false, "Use two integer x,y,z points." end
        local low, high = {}, {}
        for _, k in ipairs({"x", "y", "z"}) do
            low[k], high[k] = math.min(p1[k], p2[k]), math.max(p1[k], p2[k])
            if low[k] < -30900 or high[k] > 30900 or high[k] - low[k] > 31 then
                return false, "Keep your selection in world bounds and at most 32 nodes per side."
            end
        end
        for z = low.z, high.z do for y = low.y, high.y do for x = low.x, high.x do
            local node = core.get_node_or_nil({x = x, y = y, z = z})
            if not node or node.name == "ignore" then return false, "Move closer so the full selection is loaded." end
        end end end
        local dir = core.get_worldpath() .. "/structure_exports"
        core.mkdir(dir)
        for _, file in ipairs(core.get_dir_list(dir, false)) do
            if file == name .. ".mts" then return false, "That name already exists; choose a new one." end
        end
        core.create_schematic(low, high, nil, dir .. "/" .. name .. ".mts")
        for _, file in ipairs(core.get_dir_list(dir, false)) do
            if file == name .. ".mts" then return true, "Exported structure_exports/" .. file end
        end
        return false, "Could not write the schematic."
    end,
})
