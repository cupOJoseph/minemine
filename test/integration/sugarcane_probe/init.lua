local cane = "default:papyrus"
local base = vector.new(0, 30, 0)
local target = vector.offset(base, 0, 1, 0)
local function set(delta, name)
    core.set_node(vector.add(base, delta), {name = name})
end
local function reset(ground, water, offset)
    for x = -2, 2 do for z = -2, 2 do for y = -1, 5 do
        set(vector.new(x, y, z), "air")
    end end end
    set(vector.new(0, -1, 0), "default:stone")
    core.set_node(base, {name = ground})
    if water then set(offset or vector.new(1, 0, 0), water) end
end
local function place(allowed, under, above)
    under, above = under or base, above or target
    local stack = core.registered_nodes[cane].on_place(ItemStack(cane .. " 2"), nil,
        {type = "node", under = under, above = above})
    assert((core.get_node(above).name == cane) == allowed, "Incorrect planting result")
    assert(stack:get_count() == (allowed and 1 or 2), "Incorrect item count")
end

core.register_on_mods_loaded(function()
    core.after(0, function()
        core.emerge_area(vector.offset(base, -4, -2, -4), vector.offset(base, 4, 8, 4), function(_, _, remaining)
            if remaining ~= 0 then return end
            core.after(0, function()
                for _, ground in ipairs({"default:sand", "default:desert_sand", "default:silver_sand",
                        "default:dirt", "default:dirt_with_grass", "default:dry_dirt"}) do
                    reset(ground, "default:water_source")
                    place(true)
                end
                reset("default:dirt", "default:river_water_flowing", vector.new(0, 0, -1)); place(true)
                reset("default:stone", "default:water_source"); place(false)
                reset("default:sand"); place(false)
                reset("default:dirt", "default:water_source", vector.new(2, 0, 0)); place(false)
                reset("default:dirt", "default:water_source", vector.new(1, 0, 1)); place(false)
                reset("default:dirt", "default:water_source", vector.new(1, 1, 0)); place(false)
                reset("default:sand", "default:lava_source"); place(false)
                reset("default:dirt", "default:water_source"); set(vector.new(0, 1, 0), "default:water_source"); place(false)
                reset("default:sand", "default:water_source"); place(true)
                local top = vector.offset(target, 0, 1, 0)
                place(true, target, top)
                set(vector.new(1, 0, 0), "air")
                place(false, top, vector.offset(top, 0, 1, 0))
                reset("default:sand", "default:water_source"); place(true)
                assert(default.grow_papyrus(target, {name = cane}), "Cane must grow on irrigated sand")
                assert(core.get_node(top).name == cane)
                reset("default:dirt", "default:water_source", vector.new(2, 0, 0)); set(vector.new(0, 1, 0), cane)
                assert(not default.grow_papyrus(target, {name = cane}), "Dry cane should not grow")
                local abms = 0
                for _, abm in ipairs(core.registered_abms) do
                    if abm.label == "Grow papyrus" then
                        abms = abms + 1
                        assert(abm.interval == 14 and abm.chance == 71)
                        local sand = false
                        for _, n in ipairs(abm.neighbors) do if n == "default:sand" then sand = true end end
                        assert(sand, "Native growth ABM must include sand")
                    end
                end
                assert(abms == 1, "Must reuse the existing growth ABM")
                core.log("action", "[sugarcane_probe] PASS irrigated sand/dirt, stacking, growth, rejected dry/diagonal/liquid/stone placement")
                core.request_shutdown("Sugarcane probe complete")
            end)
        end)
    end)
end)
