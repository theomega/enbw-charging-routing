- For geo algorithms (i.e. buffering, point on line) use TurfJS (https://turfjs.org)
- Do not add indexes or other optimizations without confirmation of the user.
  If operations take longer on the main thread in the browers, ask the user
  what to do (i.e. display a progress bar or suggest an index).
- When unsure whether to implement an algorithm or or use a library, ask the
  user for confirmation.
- Do not do any optimizations without asking the user if they want it.
- Size of the bundle does not matter, it will be cached
- Always ignore the .swp files, never inspect them
- Do not document the layout in the code, it changes to often and is obvious.
  Document only things that are not obvious.

Wording:

- Code should be written in English, but the UI is in German
- The route to the destination is called "Route" in German
- Charging Stations (so the group of Charging Points) are called "Ladestation" in German
- The Charging Points are called "Ladesäulen" in German
