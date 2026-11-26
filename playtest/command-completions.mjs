const villageStyles = ['desert', 'jungle', 'pine', 'plains', 'savanna', 'tundra'];

export const commands = {
  day: { syntax: [], description: 'Set the world to noon' },
  help: { syntax: ['[command]'], choices: [ ['all', 'privs'] ], description: 'Get help with commands' },
  home: { syntax: [], description: 'Return to your saved home' },
  privs: { syntax: ['[player]'], description: 'Show player privileges' },
  sethome: { syntax: [], description: 'Save your current location as home' },
  structure_export: { syntax: ['<name>', '<x,y,z>', '<x,y,z>'], description: 'Save the selected blocks as a schematic' },
  structure_preview: {
    syntax: ['<style>', '<seed>', '[count]', '[compact]'],
    choices: [villageStyles, [], [], ['compact']],
    description: 'Preview 1–12 seeded villages',
  },
  structure_return: { syntax: [], description: 'Leave the village preview gallery' },
  teleport: { syntax: ['<x,y,z>'], description: 'Teleport to coordinates' },
  time: { syntax: ['[HH:MM]'], description: 'Show or set the time of day' },
};

// Ghost text can contain syntax markers; only concrete completions are accepted.
export function suggestCommand(input, selection = 0) {
  const match = /^\/(\w*)(?:\s+(.*))?$/.exec(input);
  if (!match) return null;
  const [, name, args] = match;
  if (args === undefined) {
    const matches = Object.keys(commands).filter(command => command.startsWith(name));
    if (matches.length === 0) return null;
    if (matches.includes(name)) {
      matches.splice(matches.indexOf(name), 1);
      matches.unshift(name);
    }
    const selected = matches[((selection % matches.length) + matches.length) % matches.length];
    const def = commands[selected];
    const remainder = selected.slice(name.length);
    return {
      ghost: remainder + (def.syntax.length ? ' ' + def.syntax.join(' ') : ''),
      value: '/' + selected + (def.syntax.length ? ' ' : ''),
      title: '/' + selected + (def.syntax.length ? ' ' + def.syntax.join(' ') : ''),
      description: def.description, options: matches,
    };
  }

  if (!Object.hasOwn(commands, name)) return null;
  const def = commands[name];
  const words = args.split(/\s+/);
  const pos = words.length - 1;
  const word = words[pos];
  const options = (def.choices?.[pos] ?? []).filter(choice => choice.startsWith(word));
  const choice = options.length ? options[((selection % options.length) + options.length) % options.length] : null;
  const hints = def.syntax.slice(pos + (choice || word ? 1 : 0));
  return {
    ghost: (choice ? choice.slice(word.length) : '') + (hints.length ? (choice || word ? ' ' : '') + hints.join(' ') : ''),
    value: choice ? input.slice(0, input.length - word.length) + choice + (pos + 1 < def.syntax.length ? ' ' : '') : null,
    title: '/' + name + (def.syntax.length ? ' ' + def.syntax.join(' ') : ''),
    description: def.description, options,
  };
}
