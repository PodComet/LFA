# LFA - Labornese Football Association

A complete 6v6 football league simulator with a web SPA, match engine, season management, and player development.

## Architecture

**Single-file SPA pattern:** `build-site.js` reads all JSON data files, embeds them as JS constants, and outputs one self-contained `site/index.html` (~240 KB) with inline CSS and JS. The server (`serve-cards.js`) serves this file and exposes API endpoints. After any data change through the API, the server rebuilds the site automatically.

**Pipeline:** `LFA.bat` → `node build-site.js` → `node serve-cards.js` (port 3456) → browser

## Key Files

| File | Role |
|------|------|
| `build-site.js` | SPA generator. Contains all frontend CSS (`CSS()`), JS (`APP_JS()`), and rendering logic (~2900 lines) |
| `serve-cards.js` | HTTP server + 20+ API endpoints for simulation, playoffs, awards, transfers, skill shop |
| `simulate.js` | Match orchestrator. Runs the engine, handles substitutions, coach influence, event logging |
| `engine/engine.js` | Core match simulation engine (6v6 football physics) |
| `cards.js` | Generates static HTML profile cards with deterministic SVG avatars |
| `player-development.js` | Age-based skill evolution with potential modifiers and position-weighted ratings |
| `schedule.js` | Circle-method round-robin schedule generator |
| `manage.js` | CLI tool for inspecting/editing league data |
| `generate-history.js` | Seeds historical seasons |

## Data Files (all in `data/`)

| File | Contents |
|------|----------|
| `league.json` | Current teams, players (10 per team), coaches, ratings |
| `history.json` | All season records: standings, match results, team snapshots, playoffs, awards |
| `config.json` | League metadata (name, format, team count), trophy name, award names |
| `schedule.json` | Current season match schedule |
| `pitch.json` | Field dimensions and player positioning |
| `preferences.json` | UI prefs: starting season, team count, expansions/contractions |

## Data Model

- **12 teams**, each with 10 players (6 starters + 4 subs) and 1 coach
- **Positions:** GK, CB, CM, ST (formation: GK - CB - 2CM - 2ST)
- **Player skills** (12): passing, shooting, tackling, saving, agility, strength, penalty_taking, jumping, speed, marking, head_game, set_piece_taking (rated 1-99)
- **Player fields:** name, position, rating, age, height, fitness, captain, international, injured, starter
- **Coach styles:** attacking, defensive, balanced, possession, counter-attack (affects skill bonuses in matches)
- **Season:** 11 matchdays (round-robin), 6 matches each. First-to-5 scoring (extended to 6 at 4-4, draw at 5-5)
- **Playoffs:** Top 8 → Quarterfinals (best-of-3) → Semifinals (single match) → Final (Guy Kilne Trophy)
- **Awards:** MVP, LFA Promise, GK of Season, Field Player of Year, Coach of Year, Fichichi (top scorer), Assist King

## Common Modifications

### Adding a UI feature to a card/page
1. Edit the rendering function in `build-site.js` (all frontend code lives here)
2. Add CSS in the `CSS()` function (starts around line 45)
3. Run `node build-site.js` to rebuild — or just restart the server which auto-rebuilds

### Key rendering functions in `build-site.js`
- `renderHome(main)` — Home/dashboard page
- `renderTeamsList(main)` / `renderTeamCard(main, name)` — Team list and detail views
- `renderCoachesList(main)` / `renderCoachCard(main, idx)` — Coach list and detail views
- `renderPlayersList(main)` / `renderPlayerCard(main, name)` — Player list and detail views
- `renderSkillShop(main)` — Skill shop UI
- `renderPreferences(main)` — Preferences page
- `renderResults(main, parts)` / `renderSeasonResults(main, num)` — Season results
- `renderStandings(main, num)` — League table
- `renderAwards(main, num)` — Awards display
- `renderMatchReport(main, season, idx)` — Match report with animated goal scenes

### Adding an API endpoint
1. Add the route handler in `serve-cards.js`
2. Update `league.json` / `history.json` as needed
3. Call `buildSite()` after data changes to regenerate the SPA

### Player development
- Edit `player-development.js` for age curves, growth/decline rates, potential modifiers
- Called via `/api/develop-season` between seasons

## Frontend Details

- **Routing:** Hash-based (`#statistics/players/Name`) — parsed in `route()` function
- **Theme:** Dark mode (CSS variables: `--bg: #0b1220`, `--accent: #3b82f6`, `--gold: #f59e0b`)
- **No frameworks:** Vanilla JS, no build tools, no dependencies
- **Helper functions:** `h(tag, cls, html)` creates elements, `go(path)` navigates, `teamColor(t)`/`teamColor2(t)` get team colors

## Conventions

- All frontend code is in `build-site.js` as string-returning functions (template literals with escaped quotes)
- Unicode escapes are used inside template strings (e.g., `\\u{1F3C6}` for trophy, `\\u2022` for bullet)
- Championship data is tracked per-season via `history.seasons[].champion` (team name string)
- Team lookup: `LEAGUE.teams.find(t => t.name === name)` or the helper `teamByName(name)`
- Player lookup across all teams: `findPlayer(name)` returns `{player, team}`
