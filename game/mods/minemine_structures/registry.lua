-- Both map generation and the workshop use the same structure definitions.
local modpath = ...
local api = dofile(modpath .. "/planner.lua")
local loaders = {}
for _, name in ipairs({"village", "treehouse"}) do
    local structure = assert(loadfile(modpath .. "/" .. name .. ".lua"))(modpath, api)
    api.register(structure.definition)
    if structure.load_templates then loaders[#loaders + 1] = structure.load_templates end
end
local function load_templates()
    for _, load in ipairs(loaders) do load() end
end
return api, load_templates
