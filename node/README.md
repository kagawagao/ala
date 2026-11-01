# ala-dsh

ALA (Android Log Analyzer) as a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
bundle. Everything in this package runs on Node: the Android diagnostics parsers, the agent tools,
the skills, and (in progress) the web workbench.

The existing Python service (`backend/`) is still the source of truth for the four web viewers and
for the Perfetto trace pipeline; see [docs/dsh-node-rewrite.md](../../docs/dsh-node-rewrite.md) for
the migration status and remaining work.

## What it provides

A host plugin, inserted by `cordis.patch.yml`, that registers:

| Tool                   | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `ala_detect_file_type` | Header-based artifact detection (`log`/`pcap`/`hci`/`trace`/`anr`/`tombstone`) |
| `ala_log_overview`     | Format, line count, level distribution, top tags, first matching entries       |
| `ala_log_search`       | Lazy scan by level, regex keyword/tag, PID/TID, timestamp range                |
| `ala_log_read_range`   | Line-numbered context around a hit                                             |
| `ala_log_tail`         | The last N entries without loading the file                                    |
| `ala_parse_diagnostic` | Structured ANR trace / tombstone parsing                                       |
| `ala_pcap_overview`    | PCAP/PCAPng protocol and endpoint statistics                                   |
| `ala_pcap_search`      | Filter packets without loading them all into memory                            |
| `ala_hci_overview`     | BTSnoop HCI packet statistics                                                  |
| `ala_hci_search`       | Filter HCI packets by type, direction, opcode, or keyword                      |

It also registers two skills — `android-logcat` and `android-diagnostics` — so an agent knows how
to triage a capture with the tools.

## Install into DSH

Build the package, then add it to a profile:

```bash
cd node
npm ci
npm run build

dsh plugin --profile ala add "$PWD"
dsh --profile ala web
```

The bundle's tools and skills are then available in every Session of that profile. Once published
to npm, the same install is `dsh plugin --profile ala add ala-dsh`.

## CLI

The same engine is exposed headlessly:

```bash
node dist/cli.js detect ../examples/sample-android.log
node dist/cli.js overview ../examples/sample-android.log
node dist/cli.js search ../examples/sample-android.log --level E --keyword "FATAL|ANR"
node dist/cli.js search ../examples/sample-android.log --level E --limit 200
node dist/cli.js tail ../examples/sample-android.log --lines 50
```

`node --experimental-strip-types src/cli/index.ts …` runs the CLI from source on Node 22+.

## Development

```bash
npm ci
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsdown → dist/
npm run check     # all three
```

Layout:

```
src/core/file-detect   header-based artifact detection
src/core/log           logcat / plain-text parsing, filtering, lazy file streaming, archives
src/core/diagnostic    ANR trace and native tombstone parser
src/core/hci           BTSnoop HCI parser, filters, statistics
src/core/pcap          PCAP/PCAPng parser, filters, statistics
src/host               DSH host plugin: tools, path handling, skills
src/cli                `ala` command
skills/                bundled DSH skills
```

The parsers are dependency-free TypeScript ports of `backend/src/ala/services/*`; the Python tests
under `backend/tests/` are the behavioral contract and are mirrored in `*.test.ts`.
