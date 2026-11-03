-- Local playtest content. No wallets, rewards, or remote services.
core.register_on_newplayer(function(player)
    local inv = player:get_inventory()
    for _, item in ipairs({ "default:pick_steel", "default:dirt 99", "default:wood 99", "default:torch 99" }) do
        inv:add_item("main", item)
    end
end)
core.register_on_joinplayer(function(player)
    core.chat_send_player(player:get_player_name(), "MineMine playtest: WASD to move, mouse to look, left click to dig, right click to build, I for inventory, Esc for menu. This is a local world.")
end)
