# Local Game Vocabulary

В production prompt classifier uses this compact local catalog to add only
conservative archetype/genre hints; it never sends the entire vocabulary list to
the model. The original user request and explicit prohibitions remain primary.
These hints are not gameplay proof: the technical Canvas/browser gate remains
separate, and game rules without observed evidence are `NOT_VERIFIED`.

Числа dev-корпуса ниже относятся только к указанному локальному benchmark и не
доказывают качество игры. Сверяйте их с [текущим статусом](release-status.md) и
[индексом документации](README.md).

`src/game-vocabulary.ts` is a small, static, versioned catalog for the local
request interpreter. It separates game archetypes from broad genres, mechanics,
audiences, presentation preferences and explicit constraints. Aliases are
enumerated rather than suffix-stemmed. Matching uses case folding, NFC,
whitespace-tolerant phrases, common hyphen variants and Russian `ё`/`е` spelling;
the original prompt, numeric literals, rule order and prohibitions remain intact.

Catalog shape is informed by public game taxonomy and design references, not by
copied store records: [Steamworks Tags](https://partner.steamgames.com/doc/store/tags),
[IGDB API fields](https://api-docs.igdb.com/), and the
[MDA design framework](https://www.cs.northwestern.edu/~hunicke/pubs/MDA.pdf).
Steam tags and IGDB genres are useful reminders that genres and descriptive tags
are separate labels; MDA motivates keeping player-facing mechanics distinct from
genre names. The catalog is YAPLIX-authored and contains no third-party catalog
dump.

Unicode uses canonical normalization, as specified by
[Unicode UAX #15](https://www.unicode.org/reports/tr15/). We deliberately do not
run Snowball or another stemmer at runtime: its own project describes stemming
as information-retrieval conflation and warns that over-stemming is more
problematic than under-stemming ([Snowball algorithms](https://snowballstem.org/algorithms/)).
For short game names and titles, explicit aliases provide a smaller false-match
surface. Quoted game text is ignored during classification, and nearby negation
suppresses the corresponding positive archetype mention.

The interpreter retains multiple named archetypes rather than choosing one.
Compatibility metadata is descriptive; it never permits deleting a requested
idea or overriding an explicit rule. Unknown ideas remain valid and pass through
verbatim. `direct` and `intent` modes still send two messages in one provider
request; only relevant short hints are added, never the full vocabulary or an
extra classification call. Automatic genre additions are hints at `INFERRED`
priority. Explicit rules remain in the raw request and take precedence.

The development-only [vocabulary set](nl-evaluation/vocabulary-dev.json) contains
109 short, hand-authored cases for aliases, negatives, titles, unknown ideas and
multi-archetype requests. It is not production prompt data and not a blind or
held-out benchmark. Run `node scripts/game-vocabulary-benchmark.mjs` on Node 24
for a repeatable before/after alias-recognition and local latency comparison.
