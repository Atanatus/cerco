# CERCO — Identity Contract V1

Status: DESIGN ONLY
Game: CERCO
Platform infrastructure: ATANATUS

## Principles

- CERCO is independently understandable and playable.
- Playing CERCO does not require knowledge of ATANATUS.
- No cryptocurrency, wallet or token is required.
- Guests and registered players have separate leaderboards.
- Permanent account linking is deferred.
- CERCO does not calculate or award global account EXP.
- Player-provided results are never automatically trusted.

## Identifiers

player_id:
  UUID v4.
  Internal CERCO player identifier.
  Server-assigned when backend identity is enabled.

guest_id:
  UUID v4.
  Browser installation identifier.
  May be lost when browser storage is cleared.
  Does not prove a unique human identity.

match_id:
  UUID v4.
  Unique match identifier.
  Future authoritative matches must be created by the server.

result_id:
  UUID v4.
  Unique result identifier.
  Official results require server validation.

account_id:
  UUID v4.
  Reserved for future persistent account identity.
  Not implemented in this phase.

## Player categories

guest:
  Can play.
  Can participate in a separate guest leaderboard
  once secure result verification is available.

registered:
  Can play.
  Can participate in the registered leaderboard
  after account authentication is implemented.

## Security boundaries

- Public IDs are not authentication credentials.
- Client localStorage is not authoritative.
- A score submitted by the browser is unverified.
- Official leaderboards require validated match results.
- Rate limiting and abuse prevention are required.
- No global EXP is granted by CERCO.

## Planned backend

Cloudflare Worker:
  API, validation, rate limits and access control.

Cloudflare D1:
  Player records, matches, verified results and rankings.

## Deferred decisions

- Account registration and recovery.
- Permanent account linking.
- Profile synchronization.
- Global EXP calculation.
- Reward eligibility.

## Deployment

This document does not enable any backend,
create any database or alter gameplay.