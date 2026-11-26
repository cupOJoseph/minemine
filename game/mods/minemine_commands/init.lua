core.register_chatcommand("day", {
    description = "Set the time to noon",
    privs = core.is_singleplayer() and {} or {settime = true},
    func = function(_, param)
        if param:match("%S") then return false, "Usage: /day" end
        core.set_timeofday(0.5)
        core.log("action", "[minemine_commands] Time set to noon via /day")
        return true, "Time set to noon."
    end,
})
