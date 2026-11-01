# Android logcat triage

Use this skill when a person asks about an Android `logcat` file, a captured bugreport, or a
crash they cannot explain. ALA's tools read the file lazily from disk; never ask the person to
paste the log, and never load a large file with `read` before trying the overview.

## Tool workflow

1. `ala_detect_file_type` — confirm the artifact is a `log` (or `anr` / `tombstone`); the type is
   detected from content, so a `.txt` capture still works.
2. `ala_log_overview` — format, line count, level distribution, top tags, first entries. Do this
   before any search.
3. `ala_log_search` — narrow by `level` (`E`, `F`), `keyword` (regex, e.g. `FATAL EXCEPTION|ANR in`),
   `tag`, `pid`, `tid`, or a timestamp range. Prefer a few narrow searches over one broad one.
4. `ala_log_read_range` — pull 20–80 lines around a hit to see the stack trace and the lines
   immediately before it. Line numbers come from the search results.
5. `ala_log_tail` — for "what happened most recently" questions.

## Reading a crash

The interesting part is rarely the exception line alone:

- `FATAL EXCEPTION: main` is followed by `Process: <pkg>, PID: <pid>` and a Java stack trace with
  `Caused by:` chains. Quote the first-app frame and the deepest `Caused by` frame.
- Native crashes appear as `signal 11 (SIGSEGV)` / `Fatal signal` with a `backtrace:` block; the
  tombstone parser (`ala_parse_diagnostic`) gives a structured view when the file is a tombstone.
- `ANR in <pkg>` comes with a `Reason:` and a `CPU usage` report; the ANR itself is usually in a
  separate `anr_*` trace where the main thread's state matters.

## Filtering and counting

- `keywords` is a JavaScript regular expression (case-insensitive) matched against both the message
  and the raw line, so merged multi-line stack traces are searchable.
- With both `keyword` and `tag`, the default is AND. Set `relation: "OR"` to widen.
- `level` is exact: `E` catches errors but `FATAL` lines are `F`; search `level: "F"` separately.
- PIDs from a crash are the best correlation key: search `pid: "<pid>"` to see the whole app
  lifecycle, including `ActivityManager` lines from other PIDs around it.

## Reporting

Report what the log proves, with line numbers (`file:line`), and separate facts from hypotheses.
If the evidence is insufficient, say which capture (full logcat, tombstone, ANR trace) is missing.
