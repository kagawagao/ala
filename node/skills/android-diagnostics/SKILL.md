# ANR traces and native tombstones

Use this skill when the artifact is an ANR trace (`----- pid N at ... -----` plus thread dumps)
or a native crash tombstone (`*** *** ***` banner, signal info, backtrace).

## Tools

- `ala_parse_diagnostic` — parses either flavour, auto-detects it, and returns structured JSON:
  threads with stack frames for ANRs; signal, fault address, backtrace, and registers for
  tombstones. This is cheaper and more reliable than reading the raw text.
- `ala_detect_file_type` — `anr` and `tombstone` are detected from content, not the file name.
- `ala_log_read_range` — read the raw lines around the structured result when the parser's summary
  is not enough (for example the `"main" prio=` block with lock ownership).

## Interpreting an ANR

1. Find the `"main"` thread. Its state decides the story: `Blocked` needs the lock owner (follow
   `held by tid=`), `Waiting` needs the lock it waits on, `Native`/`Runnable` needs the native
   frame or the busy loop.
2. Check the other threads for the owner of the contended monitor. A chain of `Blocked` threads
   points at the owner; a single blocked main thread with no owner often means a slow binder call.
3. The reason line (`Reason: Input dispatching timed out`, `Broadcast of Intent`, ...) names the
   stall; quote it.
4. Note the sample age and whether the trace was cut before all threads were dumped.

## Interpreting a tombstone

1. Read `signal`, `code`, `fault addr`, and `Abort message` first — they distinguish a null
   dereference, a stack overflow, and an abort.
2. The backtrace frames are `#NN pc <addr> <lib> (<build-id>)`; map the top frames to the app or
   platform library. Do not invent symbol names the tombstone does not contain.
3. Check `pid`/`tid`, the process name, and the `build fingerprint` to place the crash on a build.

## Reporting

Quote the decisive fields (`signal`, `fault addr`, main-thread state, lock owner, top frames) and
give the raw line numbers or frame numbers. Separate what the trace proves from what needs the
matching build's symbols.
