# Feedback

Feedback from someone using the app — a road test, a drive, a message. One file per
item, in this folder. This file is the process.

An item is a report plus the reasoning it produced, and the reasoning is the half
worth keeping. This is not a backlog.

## Files

`YYYY-MM-DDTHHMM-short-kebab-title.md` — when the item was **reported**, then a few
words. ASCII, so the names glob.

- The timestamp is when the reporter said it, not when the file was written.
- The name is chronological, so there is no number to allocate. Two road tests
  months apart cannot collide, and nothing is ever renumbered.
- Never change a filename once it exists.
- The filename's title is for `ls`. The `#` heading is the real title and keeps the
  German the UI actually says.
- The seven items of 2026-09-16 carry **assigned** hourly times. Only the date was
  recorded; the times exist to preserve the order they came in during one drive, and
  are not measurements.

## State

Frontmatter, and nowhere else:

```yaml
---
status: implemented
---
```

One key, and nothing is optional — an optional key is one that is sometimes absent,
which is indistinguishable from forgotten. Bare value, never quoted: `prettier`
rewrites quotes inside frontmatter, and it will not warn you when the YAML is broken
— it passes invalid frontmatter through and reports it clean. The greps below are the
only guard, which is why the schema is one bare enum and no free text. Everything
else a header would carry is already in the filename or the heading, and a second
copy is what goes stale.

| status        | means                                                       |
| ------------- | ----------------------------------------------------------- |
| `open`        | reported. No analysis, or analysis with no agreed fix.      |
| `discussed`   | cause understood, fix agreed and written down. No code yet. |
| `implemented` | the agreed change is in the tree.                           |

There is no overview table. Ask the files:

    ls feedback/                                    # chronological
    ls feedback/2026-09-16T*                        # one road test
    grep -H '^status:' feedback/20*.md              # everything
    grep -L '^status: implemented' feedback/20*.md  # not done
    grep -h '^status:' feedback/20*.md | sort -u    # must be 3 lines

The single file this folder replaced kept a seven-row state table, and two of its
rows were wrong: it called the share-link item implemented while that item's own body
listed what was left to do, and it still described the detour item's clamp after the
clamp had been removed. A table is a second copy of the state, and the copy is what
goes stale. Do not reintroduce one.

## Working an item

One item at a time: analyse, agree a fix, then implement. In that order.

1. **Analyse.** Read the code. Write what it does _today_ into the item file —
   causes, measurements, endpoints you probed. Not what it should do.
2. **Agree.** Propose a decision and get the user's answer before writing any code.
   Write the agreed decision in under a `## Decision: …` heading, with the
   alternatives that lost and why they lost.
3. **Implement.** The code and the item's `## Implemented` section change together,
   in one change, and `status` moves in that same change.

The analysis and the decision go in **before** the code exists. A decision recorded
afterwards is only a description of what got built: it loses the alternatives, and
the alternatives are what stops the question being reopened in three weeks. The
percentage, detour-sign and share-link items are mostly rejected options, and that is
the useful part of them. Decisions taken against stay in the file.

## Filing a new item

Mid-conversation is normal, and filing is not starting. Create the file with the
reported timestamp, `status: open`, and the reporter's words verbatim in a blockquote
if there were any — then stop and finish what you were doing.

Quote verbatim, in the reporter's language, and never paraphrase into the item's own
prose. The tester writes German; the analysis is English. Three of the 2026-09-16
items keep the original German and four have no quote at all, because none was
recorded — and writing one afterwards is not an option.

When an item grows a decision about something else, that is a new item with a
one-line pointer, not a longer section. The scroll-position item runs past 170 lines
and earns them; it would not have earned a second topic.

## Items refer to each other by title

Never by filename, never by a number. „The wording item", „the scroll-position item"
— a title survives, and it is what `grep -rl` takes. Filenames are timestamps
precisely so that nothing has an ordinal worth citing.

## The code never points here

No source file mentions a feedback file, an item, or this folder. Not in a comment,
not in a test name, not in a TODO.

A code comment has to stand on its own, because it is read by someone looking at that
function and nothing else. `detourCost` in `src/core/detour.ts` is the pattern: its
doc comment argues the whole case for returning a signed figure without citing
anything. It used to end with a pointer at „FEEDBACK.md item 5", and that line was
both a dangling path and a lie — the reasoning it promised was in the comment itself.

So the two directions are not symmetric. An item names the files and functions it
changed, because that is what the record is for. Code names neither.

## A stale item file is a bug

Every item claims something about the code, and there are two kinds of claim:

- **The analysis is dated and may describe the past.** The filename says when. An
  argument that has since expired is worth more marked as expired — see the
  percentage item's fourth argument — than deleted. Do not tidy history.
- **`status` and `## Implemented` must describe the present.** If the code no longer
  matches them, the file is wrong in the way a failing test is wrong.

So deleting or reworking code an item describes means editing that item in the same
change. An item whose _title_ names a bug that is now fixed keeps its title: the
title names the report, `status` carries the state. If you cannot tell whether an
item is current, write that uncertainty into the item rather than guessing.

This is not a demand that three files agree word for word. The item is the decision
record, the code comment is what a reader of that function needs, and `README.md` is
the architecture. Three registers, not three copies.
