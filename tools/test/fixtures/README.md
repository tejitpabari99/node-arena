# Tools fixture index

These fixtures stay outside production content. Tests merge them into temporary or in-memory corpora; reports, locks and recorded solutions are removed after each test.

| Fixture / test | Acceptance coverage |
|---|---|
| `levels/corpus.json`, `levels.test.ts` | Four reference wins; unwinnable failure; band four three actual wins of four; verified scripted winning solution; corrupted and uncommitted solution rejection; repeated-seed identity; zero rejected commands |
| `levels/corpus.json`, `authored-fixtures.test.ts` | Executable level CLI passes/fails authored corpora with current locks and located JSON diagnostics; authored automatic-win ownership fails content validation first |
| `profiles/invalid-tier.json`, `authored-fixtures.test.ts` | Complete utility personality with `extends` and valid `skill` still fails the executable content CLI because the remaining personality fields cannot be overridden |
| Temporary corpora in `gates.test.ts` | Missing visual key fails executable manifest CLI with source/pointer; repository manifest passes; malformed content and stale locks fail |
| Temporary rules in `rules-replay.test.ts` | Missing active rule and unknown coverage tag fail executable rule CLI; repository coverage passes; skipped tests cannot claim coverage; corrupt replay diagnostics |
| `levels/corpus.json`, `balance.test.ts` | Real worker pool reports are byte-identical with jobs 1/2 in JSON and Markdown; bounded campaign/arena runs and worker failures |

V1 requires distinct player teams and an owned tower for every player. An idle human cannot initiate the flow that captures an enemy tower, so the automatic idle-win scenario intentionally cannot pass authored content validation. `levels.test.ts` uses adversarial compiled ownership to exercise the runtime idle-win safeguard separately; `authored-fixtures.test.ts` proves the authored boundary rejects it before matches run. The seeded band-four and scripted-solution cases remain simulation tests rather than additional CLI suites, keeping runtime bounded.
