# Adaptive practice v1

Free practice supports rule-based, experimental model-based (logistic / depth3 CART / boosted stumps) and broad-coverage selection for single identity, chord quality and 2/3-chord progression formats. Curriculum stages keep balanced progression/unlock evaluation; adaptation is never used for unlocking. Manual history review preserves original choices and records its own selection policy.

## Candidate construction

Progression four-choice sets are generated before the audible target is selected. Major is one category; minor and diminished form another **only for candidate construction**, with exact quality unchanged for grading. Random sets share a single category pattern. Balanced sets prefer that pattern, otherwise use exactly two category patterns with two options each. Each position has two actual chords occurring twice, and every candidate has equal total positional overlap. Adjacent repeated chords are excluded. The existing5/5 balanced/random quota is retained for ordinary/curriculum plans. This reduces quality-only shortcuts; minor/dim timbral clues are not claimed to disappear.

Adaptive four-choice ranks **sets by mean risk** (up to60 sampled sets), then picks one of the four answers uniformly. It does not select an answer by weakness or retry the answer draw. Coverage and repeat limits apply to sets before that draw. Thus the logged target probability .25 is conditional on the chosen set, not an overall problem selection probability. Ordered progression candidates enumerate all valid2/3-chord sequences; identity candidates use the selected domain, including its selected number of choices. Candidate generation v1 is recorded and compared separately from legacy questions.

## Causal features and selection

A session freezes valid same-user history with `answeredAt < session.startedAt`. Rule selection isolates instrument/reference-permission; exact-condition statistics retain task/key/input/length/duration/register/style and candidate generation, while component evidence shares according to the existing bounded pooling rules. Other users and future/equal-time answers are excluded.

Rule priority = .45 whole-target smoothed error + .30 average chord/pair error + .15 recent whole-target error + .10 directed offered-confusion rate. Rates are smoothed; no single miss is presented as proof of inability. Five priority slots plus five coverage slots are shuffled; absent relevant evidence all10 slots become coverage. Priority focuses on evidence-bearing candidates, penalizes heavily repeated chords, limits priority target/set reuse to3 where feasible, balances coverage uses, and avoids consecutive identical targets where the domain allows. Coverage slots prioritize underexposed targets/chords. This is a provisional heuristic; it is not an estimate of learning gain.

Model selection uses the chosen family with **fixed balanced pooling and confusion features** trained on all valid prior answers. Gates: >=60 prior answers, >=5 correct and incorrect, >=10 answers with same instrument/reference permission/format. Missing gates or fit failure falls back to rule. Family/profile choice is explicit, not selected from outer test scores. The plan freezes model weights and feature snapshots at session start; ranking prioritizes low predicted correctness. A Worker runs generation/training; if worker errors or exceeds30s, broad coverage remains available and an explicit failure reason is recorded.

## Directed confusion

`confusion-evidence.js` records directed target→chosen-answer counts, denominators, positions and key/duration/register/style contexts. Features measure errors into **currently offered** alternatives, aggregate count/rate, strongest confusion and local rates. Minor/major and opposite confusion directions remain separate. Single unknown answers contribute denominator but no guessed wrong target; ordered unknown answers and legacy malformed local labels do not create local evidence. Four-choice progressions contribute only whole-sequence confusions. Features use submitted earlier answers only. Evaluation refits the3 fixed-sharing families with confusion inputs masked out, under the identical outer session split; additional Brier/log-loss comparisons are exploratory.

## Provenance and UI

Reasons are displayed only after answering, with generic session quotas before answering. Every adaptive answer retains requested/effective method, fallback, bucket, selected target/set score, prediction, exact prediction vector, family/model/feature version, fixed pooling profile, snapshot ID, cutoff, training count, seed, direct/component/confusion summaries, candidate count, and conditional four-choice probability. Models + training IDs + configuration are saved once per session in IndexedDB metadata and included in history JSON. Imports validate them and append missing IDs without overwriting existing answers/models. Exported features and model reproduce the logged probability.

The current user's history panel summarizes actual selection method, priority/coverage counts, correctness and prediction Brier. These are descriptive observations of different selected questions, **not randomized learning-effect estimates**. Learned benefit needs a future design with common assessment questions or randomized assignment. Old history remains supported; missing permission/generation metadata stays unknown/legacy.

## Verification

`node --test tests/*.test.cjs` covers all24 major/natural-minor keys, candidate quality patterns, balanced position counts, target uniformity, source separation, causal timing, directed confusion, candidate-offered effects, cold start,5/5 slots, repeat limits,3 live models, fallback, Worker imports, snapshot validation/backup and prediction reproduction. Browser QA checks the actual start/play/answer/reason/history flow.
