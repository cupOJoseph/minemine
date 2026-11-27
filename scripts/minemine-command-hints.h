// Native chat command hints for the MineMine browser build.
// SPDX-License-Identifier: LGPL-2.1-or-later
#pragma once

#include <string>
#include <vector>

namespace minemine {
struct CommandHint {
    std::wstring ghost;
    std::wstring completion;
    bool known = false;
};

struct Command {
    std::wstring name;
    std::vector<std::wstring> syntax;
    std::vector<std::vector<std::wstring>> choices;
};

inline bool startsWith(const std::wstring &text, const std::wstring &prefix)
{
    return text.compare(0, prefix.size(), prefix) == 0;
}

inline const std::vector<Command> &commands()
{
    static const std::vector<Command> catalog = {
        {L"day", {}, {}},
        {L"help", {L"[command]"}, {{L"all", L"privs"}}},
        {L"home", {}, {}},
        {L"privs", {L"[player]"}, {}},
        {L"sethome", {}, {}},
        {L"structure_export", {L"<name>", L"<x,y,z>", L"<x,y,z>"}, {}},
        {L"structure_preview", {L"<type>", L"<biome>", L"[seed]", L"[count]", L"[compact]"},
            {{L"treehouse", L"village"}, {L"cold_desert", L"coniferous_forest", L"deciduous_forest", L"desert",
                L"grassland", L"rainforest", L"sandstone_desert", L"savanna", L"snowy_grassland", L"taiga",
                L"tundra", L"tundra_highland"}, {}, {}, {L"compact"}}},
        {L"structure_return", {}, {}},
        {L"teleport", {L"<x,y,z>"}, {}},
        {L"time", {L"[HH:MM]"}, {}},
    };
    return catalog;
}

inline CommandHint commandHint(const std::wstring &line)
{
    if (line.empty() || line[0] != L'/')
        return {};
    const auto split = line.find_first_of(L" \t", 1);
    const std::wstring name = line.substr(1, split == std::wstring::npos ? split : split - 1);
    const Command *selected = nullptr;
    for (const auto &command : commands()) {
        if (command.name == name) {
            selected = &command;
            break;
        }
        if (split == std::wstring::npos && !selected && startsWith(command.name, name))
            selected = &command;
    }
    if (!selected)
        return {};

    CommandHint hint;
    hint.known = true;
    size_t pos = 0;
    if (split == std::wstring::npos) {
        const auto suffix = selected->name.substr(name.size());
        hint.ghost = suffix;
        hint.completion = suffix;
        if (!selected->syntax.empty())
            hint.completion += L" ";
        for (const auto &word : selected->syntax)
            hint.ghost += L" " + word;
        return hint;
    }

    // Count completed arguments, allowing runs of whitespace. An empty final
    // token means the user has finished the preceding argument.
    size_t start = split;
    std::wstring word, first_argument;
    while (start < line.size()) {
        const auto next = line.find_first_not_of(L" \t", start);
        if (next == std::wstring::npos) {
            word.clear();
            break;
        }
        const auto end = line.find_first_of(L" \t", next);
        word = line.substr(next, end == std::wstring::npos ? end : end - next);
        if (end == std::wstring::npos)
            break;
        if (pos == 0) first_argument = word;
        ++pos;
        start = end;
        word.clear();
    }
    const bool treehouse = selected->name == L"structure_preview" && first_argument == L"treehouse";
    const size_t syntax_size = selected->syntax.size() - (treehouse ? 1 : 0);
    if (pos >= syntax_size)
        return hint;

    bool has_choice = false;
    if (pos < selected->choices.size()) {
        static const std::vector<std::wstring> forest_biomes = {L"rainforest", L"taiga"};
        const auto &choices = treehouse && pos == 1 ? forest_biomes : selected->choices[pos];
        const std::wstring *choice = nullptr;
        for (const auto &value : choices) {
            if (value == word) {
                choice = &value;
                break;
            }
            if (!choice && startsWith(value, word))
                choice = &value;
        }
        if (choice) {
            has_choice = true;
            hint.ghost = choice->substr(word.size());
            hint.completion = hint.ghost;
            if (pos + 1 < syntax_size)
                hint.completion += L" ";
        }
    }
    const bool consumed = has_choice || !word.empty();
    if (consumed)
        ++pos;
    for (size_t i = pos; i < syntax_size; ++i) {
        if (consumed || i > pos)
            hint.ghost += L" ";
        hint.ghost += selected->syntax[i];
    }
    return hint;
}
}
