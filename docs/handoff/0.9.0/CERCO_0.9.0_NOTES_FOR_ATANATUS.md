# CERCO 0.9.0 Beta — Integration notes for ATANATUS

This release is based directly on the supplied `cerco_expedition_v083_mobile(1).html` and retains the existing self-contained HTML, mobile controls, skins, Style Coins, expedition credits, local records and bridge.

## Host-facing compatibility

- Game version: `0.9.0`
- **Ruleset ID: `CERCO-0.9.0`** (changed because the enemy roster, threat progression and base score of new enemy types have changed).
- The existing `CERCO_BRIDGE` object, `cerco:event` CustomEvent and `postMessage` integration protocol `1` remain available.
- No additional network requests or service dependencies have been introduced.
- The same parent-origin configuration for equipping skins is preserved.
- Existing cosmetic skin IDs `cerco.default` and `cerco.void_circuit` remain unchanged.
- The account currency ID remains `atanatus.style_coins`; the game still only **reports** currency pickups. ATANATUS must verify them server-side.

## New enemy types in audit reports

- `seeker`: cyan homing shooter; base kill score **245**.
- `blighter`: yellow contamination caster; base kill score **260**.

Existing types retain their prior base scores. The `killsByType`, `killBuckets`, score breakdown and room audit records use the existing schema. Each combat room audit now also contains `invasionTier`, `hazardsCreated` and `maxEncroachment`. The schema name remains `cerco.audit.v2` because these are optional additive fields.

## Threat progression

- Enemy capabilities advance in tiers of five **combat** rooms.
- High-risk enemies have concurrent population caps; stationary players attract a greater proportion of ranged pressure after three seconds.
- The special ranged-only room schedule is unchanged: rooms 7, 17, 27, etc.
- In advanced combat tiers (combat index 25 or higher), **prolonged frenzies** trigger an expanding contaminated perimeter. The player has advance visual feedback. The effect resets between rooms and is never applied in sanctuaries.

## Leaderboard guidance

**Do not merge 0.9.0 scores blindly with 0.8.x scores.** They have different enemy behavior, hazards and points per new enemy type. Associate scores with the ruleset ID and retain historical verification logic for old runs.

The game is still a client-side game. Bridge statistics are unverified until authenticated, checked and accepted by the server. Avoid treating a session UUID or a self-consistent client report as conclusive proof of legitimate play.

## Validation undertaken

- 300 generated maps validated for connected entrances and exits.
- Browser scenarios: phantom inside/outside walls, detonator speed, contamination warning/damage, homing enemy shots, anti-camping detection, advanced encroachment.
- Stage 7 ranged-only spawn rules tested.
- 1,400 simulated updates on a high-level combat board with peak 81 enemies and no uncaught JS errors.
- Desktop 1365×631 and mobile 390×844 displayed without document scrolling.
- One finish event emitted for a finished run in the integration test.

**This is a playable beta, not a fully proven production balance or server-verified leaderboard.** Human playtesting is still necessary for the final enemy damage, spawn frequencies, and perceived fairness of the late-game invasion.
