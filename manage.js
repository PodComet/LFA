#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LFA League Manager — view and edit players, teams, stats, standings
//
// Usage:
//   node manage.js teams                        — list all teams
//   node manage.js roster <team#>               — show team roster + attributes
//   node manage.js player <name>                — player profile + career stats
//   node manage.js standings [season#]          — league table (default: current)
//   node manage.js leaders [season#]            — stat leaders
//   node manage.js history <name>               — player career history
//   node manage.js coaches                      — coach overview + career win%
//   node manage.js playoffs [season#]            — playoff bracket
//   node manage.js trophy                        — Guy Kilne trophy history
//   node manage.js awards [season#]              — season awards
//   node manage.js card <name>                   — generate HTML player/coach card
//
//   node manage.js edit player <name> <field> <value>
//   node manage.js edit team <team#> <field> <value>
//   node manage.js edit coach <team#> <field> <value>
//   node manage.js edit skill <name> <skill> <value>
//
// Editable fields:
//   player: name, position, rating
//   team:   name, rating, colors.primary, colors.secondary
//   coach:  name, rating, style
//   skill:  passing, shooting, tackling, saving, agility, strength,
//           penalty_taking, jumping, speed, marking, head_game, set_piece_taking
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')

const leaguePath = path.join(__dirname, 'data', 'league.json')
const historyPath = path.join(__dirname, 'data', 'history.json')
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))

function loadLeague() { return JSON.parse(fs.readFileSync(leaguePath, 'utf8')) }
function saveLeague(data) { fs.writeFileSync(leaguePath, JSON.stringify(data, null, 2)) }
function loadHistory() {
  if (!fs.existsSync(historyPath)) {
    console.error('No history.json found. Run: node generate-history.js')
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(historyPath, 'utf8'))
}
function saveHistory(data) { fs.writeFileSync(historyPath, JSON.stringify(data, null, 2)) }

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function pad(str, len) { return String(str).padEnd(len) }
function rpad(str, len) { return String(str).padStart(len) }
function pct(on, total) { return total > 0 ? `${Math.round(on / total * 100)}%` : '-' }
function coachWinPct(pts, matches) {
  if (matches === 0) return 'NEW'
  return `${Math.round(pts / (matches * 3) * 100)}%`
}

const line = (n = 70) => console.log('-'.repeat(n))

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdTeams() {
  const league = loadLeague()
  console.log(`\n  ${CONFIG.league.shortName} LEAGUE — ${CONFIG.league.teamCount} Teams\n`)
  console.log(`  ${'#'.padStart(3)}  ${pad('Team', 22)} ${rpad('Rating', 6)}  ${pad('Coach', 16)} ${pad('Style', 14)} ${pad('Colors', 20)}`)
  line()
  league.teams.forEach((t, i) => {
    const coach = t.coach ? t.coach.name : '-'
    const style = t.coach ? t.coach.style : '-'
    const colors = t.colors ? `${t.colors.primary}/${t.colors.secondary}` : '-'
    console.log(`  ${String(i).padStart(3)}  ${pad(t.name, 22)} ${rpad(t.rating, 6)}  ${pad(coach, 16)} ${pad(style, 14)} ${pad(colors, 20)}`)
  })
  console.log('')
}

function cmdRoster(teamIdx) {
  const league = loadLeague()
  const team = league.teams[teamIdx]
  if (!team) { console.error(`Invalid team index: ${teamIdx}`); return }

  console.log(`\n  ${team.name} — Roster (Rating: ${team.rating})`)
  if (team.coach) console.log(`  Coach: ${team.coach.name} (${team.coach.style}, Rating: ${team.coach.rating})`)
  console.log('')
  console.log(`  ${'#'.padStart(3)}  ${pad('Name', 16)} ${pad('Pos', 4)} ${rpad('Rtg', 4)} ${rpad('Spd', 4)} ${rpad('Pas', 4)} ${rpad('Sho', 4)} ${rpad('Tck', 4)} ${rpad('Sav', 4)} ${rpad('Agi', 4)} ${rpad('Str', 4)} ${rpad('Jmp', 4)} ${rpad('Mrk', 4)} ${rpad('Hd', 4)} ${rpad('SP', 4)} ${rpad('Pen', 4)}`)
  line(80)

  team.players.forEach((p, i) => {
    const s = p.skill
    const starter = i < 6 ? '' : ' (sub)'
    console.log(`  ${String(i).padStart(3)}  ${pad(p.name + starter, 16)} ${pad(p.position, 4)} ${rpad(p.rating, 4)} ${rpad(s.speed, 4)} ${rpad(s.passing, 4)} ${rpad(s.shooting, 4)} ${rpad(s.tackling, 4)} ${rpad(s.saving, 4)} ${rpad(s.agility, 4)} ${rpad(s.strength, 4)} ${rpad(s.jumping, 4)} ${rpad(s.marking, 4)} ${rpad(s.head_game, 4)} ${rpad(s.set_piece_taking, 4)} ${rpad(s.penalty_taking, 4)}`)
  })
  console.log('')
}

function cmdPlayer(name) {
  const league = loadLeague()
  const history = loadHistory()

  let foundTeam = null, foundPlayer = null
  for (const t of league.teams) {
    const p = t.players.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (p) { foundTeam = t; foundPlayer = p; break }
  }
  if (!foundPlayer) { console.error(`Player not found: ${name}`); return }

  console.log(`\n  ${foundPlayer.name} — ${foundPlayer.position} (${foundTeam.name})`)
  console.log(`  Rating: ${foundPlayer.rating} | Height: ${foundPlayer.height}cm`)
  console.log('')
  console.log('  Skills:')
  const s = foundPlayer.skill
  console.log(`    Speed: ${s.speed}  Passing: ${s.passing}  Shooting: ${s.shooting}  Tackling: ${s.tackling}`)
  console.log(`    Saving: ${s.saving}  Agility: ${s.agility}  Strength: ${s.strength}  Jumping: ${s.jumping}`)
  console.log(`    Marking: ${s.marking}  Head Game: ${s.head_game}  Set Piece: ${s.set_piece_taking}  Penalty: ${s.penalty_taking}`)
  console.log('')

  // Career stats from history
  console.log('  Career Statistics:')
  console.log(`  ${rpad('Season', 7)} ${rpad('App', 4)} ${rpad('Gls', 4)} ${rpad('Ast', 4)} ${rpad('Shots', 6)} ${rpad('Shot%', 6)} ${rpad('Pass', 5)} ${rpad('Pas%', 5)} ${rpad('Tck', 4)} ${rpad('Tck%', 5)} ${rpad('Fouls', 5)} ${foundPlayer.position === 'GK' ? rpad('Saves', 6) : ''}`)
  line(75)

  let totals = { app: 0, gls: 0, ast: 0, shots: 0, shotsOn: 0, passes: 0, passesOn: 0, tackles: 0, tacklesOn: 0, fouls: 0, saves: 0 }

  for (const season of history.seasons) {
    const ps = season.playerSeasonStats.find(
      p => p.name.toLowerCase() === name.toLowerCase() && p.team === foundTeam.name
    )
    if (!ps || ps.appearances === 0) continue

    totals.app += ps.appearances
    totals.gls += ps.goals
    totals.ast += ps.assists
    totals.shots += ps.shots.total
    totals.shotsOn += ps.shots.on
    totals.passes += ps.passes.total
    totals.passesOn += ps.passes.on
    totals.tackles += ps.tackles.total
    totals.tacklesOn += ps.tackles.on
    totals.fouls += ps.tackles.fouls
    if (ps.saves !== undefined) totals.saves += ps.saves

    const savesStr = ps.saves !== undefined ? rpad(ps.saves, 6) : ''
    console.log(`  ${rpad('S' + season.number, 7)} ${rpad(ps.appearances, 4)} ${rpad(ps.goals, 4)} ${rpad(ps.assists, 4)} ${rpad(ps.shots.total, 6)} ${rpad(pct(ps.shots.on, ps.shots.total), 6)} ${rpad(ps.passes.total, 5)} ${rpad(pct(ps.passes.on, ps.passes.total), 5)} ${rpad(ps.tackles.total, 4)} ${rpad(pct(ps.tackles.on, ps.tackles.total), 5)} ${rpad(ps.tackles.fouls, 5)} ${savesStr}`)
  }

  line(75)
  const savesTot = foundPlayer.position === 'GK' ? rpad(totals.saves, 6) : ''
  console.log(`  ${rpad('TOTAL', 7)} ${rpad(totals.app, 4)} ${rpad(totals.gls, 4)} ${rpad(totals.ast, 4)} ${rpad(totals.shots, 6)} ${rpad(pct(totals.shotsOn, totals.shots), 6)} ${rpad(totals.passes, 5)} ${rpad(pct(totals.passesOn, totals.passes), 5)} ${rpad(totals.tackles, 4)} ${rpad(pct(totals.tacklesOn, totals.tackles), 5)} ${rpad(totals.fouls, 5)} ${savesTot}`)
  console.log('')
}

function cmdStandings(seasonNum) {
  const history = loadHistory()
  const season = history.seasons.find(s => s.number === seasonNum)
  if (!season) { console.error(`Season ${seasonNum} not found`); return }

  const label = season.champion ? `Champion: ${season.champion}` : '(in progress)'
  console.log(`\n  ${CONFIG.league.shortName} Season ${season.number} Standings — ${label}\n`)
  console.log(`  ${rpad('Pos', 4)} ${pad('Team', 22)} ${rpad('P', 3)} ${rpad('W', 3)} ${rpad('D', 3)} ${rpad('L', 3)} ${rpad('GF', 4)} ${rpad('GA', 4)} ${rpad('GD', 4)} ${rpad('Pts', 4)}`)
  line()
  season.standings.forEach((s, i) => {
    const gd = s.gf - s.ga
    const gdStr = gd > 0 ? `+${gd}` : String(gd)
    console.log(`  ${rpad(i + 1, 4)} ${pad(s.team, 22)} ${rpad(s.played, 3)} ${rpad(s.won, 3)} ${rpad(s.drawn, 3)} ${rpad(s.lost, 3)} ${rpad(s.gf, 4)} ${rpad(s.ga, 4)} ${rpad(gdStr, 4)} ${rpad(s.points, 4)}`)
  })
  console.log('')
}

function cmdLeaders(seasonNum) {
  const history = loadHistory()
  const season = history.seasons.find(s => s.number === seasonNum)
  if (!season) { console.error(`Season ${seasonNum} not found`); return }

  console.log(`\n  ${CONFIG.league.shortName} Season ${season.number} — Stat Leaders\n`)

  const stats = season.playerSeasonStats.filter(p => p.appearances > 0)

  const topGoals = [...stats].sort((a, b) => b.goals - a.goals).slice(0, 10)
  const topAssists = [...stats].sort((a, b) => b.assists - a.assists).slice(0, 10)
  const topSaves = [...stats].filter(p => p.saves !== undefined).sort((a, b) => b.saves - a.saves).slice(0, 5)
  const topPassPct = [...stats].filter(p => p.passes.total >= 50)
    .sort((a, b) => (b.passes.on / b.passes.total) - (a.passes.on / a.passes.total)).slice(0, 5)

  console.log('  TOP SCORERS')
  topGoals.forEach((p, i) => console.log(`    ${i + 1}. ${pad(p.name, 16)} ${pad(p.team, 20)} ${p.goals} goals (${p.appearances} app)`))
  console.log('')

  console.log('  TOP ASSISTS')
  topAssists.forEach((p, i) => console.log(`    ${i + 1}. ${pad(p.name, 16)} ${pad(p.team, 20)} ${p.assists} assists (${p.appearances} app)`))
  console.log('')

  console.log('  TOP SAVES (GK)')
  topSaves.forEach((p, i) => console.log(`    ${i + 1}. ${pad(p.name, 16)} ${pad(p.team, 20)} ${p.saves} saves (${p.appearances} app)`))
  console.log('')

  console.log('  BEST PASS ACCURACY (min 50 passes)')
  topPassPct.forEach((p, i) => console.log(`    ${i + 1}. ${pad(p.name, 16)} ${pad(p.team, 20)} ${pct(p.passes.on, p.passes.total)} (${p.passes.total} passes)`))
  console.log('')
}

function cmdHistory(name) {
  const league = loadLeague()
  const history = loadHistory()

  let foundTeam = null
  for (const t of league.teams) {
    if (t.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      foundTeam = t; break
    }
  }
  if (!foundTeam) { console.error(`Player not found: ${name}`); return }

  console.log(`\n  ${name} — Season-by-Season History (${foundTeam.name})\n`)
  console.log(`  ${rpad('Season', 8)} ${rpad('App', 4)} ${rpad('Goals', 6)} ${rpad('Assists', 7)} ${rpad('Shots', 6)} ${rpad('Passes', 7)} ${rpad('Tackles', 7)} ${rpad('Fouls', 6)}`)
  line(55)

  for (const season of history.seasons) {
    const ps = season.playerSeasonStats.find(
      p => p.name.toLowerCase() === name.toLowerCase() && p.team === foundTeam.name
    )
    if (!ps) continue
    console.log(`  ${rpad('S' + season.number, 8)} ${rpad(ps.appearances, 4)} ${rpad(ps.goals, 6)} ${rpad(ps.assists, 7)} ${rpad(ps.shots.total, 6)} ${rpad(ps.passes.total, 7)} ${rpad(ps.tackles.total, 7)} ${rpad(ps.tackles.fouls, 6)}`)
  }
  console.log('')
}

function cmdCoaches() {
  const league = loadLeague()
  const history = loadHistory()

  console.log(`\n  ${CONFIG.league.shortName} Coaches — Career Overview\n`)
  console.log(`  ${pad('Coach', 16)} ${pad('Team', 22)} ${pad('Style', 14)} ${rpad('Rtg', 4)} ${rpad('Seasons', 8)} ${rpad('W', 4)} ${rpad('D', 4)} ${rpad('L', 4)} ${rpad('Win%', 6)} ${rpad('Titles', 6)}`)
  line(80)

  for (const team of league.teams) {
    const coach = team.coach
    if (!coach) continue

    let totalW = 0, totalD = 0, totalL = 0, totalPts = 0, totalP = 0, titles = 0
    for (const season of history.seasons) {
      const cs = season.coachSeasonStats.find(c => c.team === team.name)
      if (cs) {
        totalW += cs.won; totalD += cs.drawn; totalL += cs.lost
        totalPts += cs.points; totalP += cs.played
      }
      if (season.champion === team.name) titles++
    }

    console.log(`  ${pad(coach.name, 16)} ${pad(team.name, 22)} ${pad(coach.style, 14)} ${rpad(coach.rating, 4)} ${rpad(history.seasons.length, 8)} ${rpad(totalW, 4)} ${rpad(totalD, 4)} ${rpad(totalL, 4)} ${rpad(coachWinPct(totalPts, totalP), 6)} ${rpad(titles, 6)}`)
  }
  console.log('')
}

function cmdPlayoffs(seasonNum) {
  const history = loadHistory()
  const season = history.seasons.find(s => s.number === seasonNum)
  if (!season) { console.error(`Season ${seasonNum} not found`); return }
  if (!season.playoffs) { console.log(`\n  Season ${seasonNum} — No playoff data (in progress)\n`); return }

  const po = season.playoffs
  console.log(`\n  ${CONFIG.league.shortName} Season ${season.number} — Playoffs\n`)

  console.log('  QUARTERFINALS (Best of 3)')
  line()
  for (const qf of po.quarterFinals) {
    console.log(`  #${qf.seedNums[0]} ${pad(qf.higherSeed, 22)} vs  #${qf.seedNums[1]} ${pad(qf.lowerSeed, 22)} => ${qf.winner} (${qf.seriesScore})`)
    for (let i = 0; i < qf.games.length; i++) {
      const g = qf.games[i]
      console.log(`      Game ${i + 1}: ${pad(g.home, 20)} ${g.score[0]} - ${g.score[1]}  ${g.away}`)
    }
    console.log('')
  }

  console.log('  SEMIFINALS (Neutral Site)')
  line()
  for (const sf of po.semiFinals) {
    console.log(`  ${pad(sf.team1, 22)} ${sf.score[0]} - ${sf.score[1]}  ${sf.team2}  =>  ${sf.winner}`)
  }
  console.log('')

  console.log('  FINAL (Neutral Site)')
  line()
  const f = po.final
  console.log(`  ${pad(f.team1, 22)} ${f.score[0]} - ${f.score[1]}  ${f.team2}`)
  console.log(`\n  CHAMPION: ${f.winner}`)
  if (season.guyKilneTrophy) {
    console.log(`  ${CONFIG.trophy.name}: ${season.guyKilneTrophy.captain} (Captain, ${season.guyKilneTrophy.team})`)
  }
  console.log('')
}

function cmdTrophy() {
  const history = loadHistory()
  console.log(`\n  ${CONFIG.trophy.name.toUpperCase()} — All-Time Winners\n`)
  console.log(`  ${rpad('Season', 8)} ${pad('Captain', 18)} ${pad('Team', 22)}`)
  line(50)

  const wins = {}
  for (const season of history.seasons) {
    if (season.guyKilneTrophy) {
      const t = season.guyKilneTrophy
      console.log(`  ${rpad('S' + season.number, 8)} ${pad(t.captain, 18)} ${pad(t.team, 22)}`)
      wins[t.team] = (wins[t.team] || 0) + 1
    } else {
      console.log(`  ${rpad('S' + season.number, 8)} ${pad('(in progress)', 18)}`)
    }
  }

  console.log('')
  console.log('  TITLES BY TEAM')
  line(35)
  const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1])
  for (const [team, count] of sorted) {
    console.log(`  ${pad(team, 22)} ${count}`)
  }
  console.log('')
}

function cmdAwards(seasonNum) {
  const history = loadHistory()
  const season = history.seasons.find(s => s.number === seasonNum)
  if (!season) { console.error(`Season ${seasonNum} not found`); return }
  if (!season.awards) { console.log(`\n  Season ${seasonNum} — No awards data (in progress)\n`); return }

  const a = season.awards
  console.log(`\n  ${CONFIG.league.shortName} Season ${season.number} — Awards\n`)
  line()
  if (a.mvp) console.log(`  ${pad(CONFIG.awards.mvp, 24)} ${pad(a.mvp.name, 18)} ${pad(a.mvp.team, 22)} ${a.mvp.position}  (Grade: ${a.mvp.grade})`)
  if (a.lfaPromise) console.log(`  ${pad(CONFIG.awards.lfaPromise, 24)} ${pad(a.lfaPromise.name, 18)} ${pad(a.lfaPromise.team, 22)} ${a.lfaPromise.position}  (Age ${a.lfaPromise.age})`)
  if (a.goalkeeperOfSeason) console.log(`  ${pad(CONFIG.awards.goalkeeperOfSeason, 24)} ${pad(a.goalkeeperOfSeason.name, 18)} ${pad(a.goalkeeperOfSeason.team, 22)} ${a.goalkeeperOfSeason.saves} saves`)
  if (a.fieldPlayerOfYear) console.log(`  ${pad(CONFIG.awards.fieldPlayerOfYear, 24)} ${pad(a.fieldPlayerOfYear.name, 18)} ${pad(a.fieldPlayerOfYear.team, 22)} ${a.fieldPlayerOfYear.position}`)
  if (a.coachOfYear) console.log(`  ${pad(CONFIG.awards.coachOfYear, 24)} ${pad(a.coachOfYear.name, 18)} ${pad(a.coachOfYear.team, 22)} ${a.coachOfYear.style}`)
  if (a.fichichi) console.log(`  ${pad(CONFIG.awards.fichichi, 24)} ${pad(a.fichichi.name, 18)} ${pad(a.fichichi.team, 22)} ${a.fichichi.goals} goals, ${a.fichichi.assists} assists`)
  if (a.assistKing) console.log(`  ${pad(CONFIG.awards.assistKing, 24)} ${pad(a.assistKing.name, 18)} ${pad(a.assistKing.team, 22)} ${a.assistKing.assists} assists (${a.assistKing.perMatch}/match)`)
  console.log('')
}

function cmdCard(name) {
  const { execSync } = require('child_process')
  const league = loadLeague()

  // Check if it's a player
  let isPlayer = false
  for (const t of league.teams) {
    if (t.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      isPlayer = true; break
    }
  }

  if (isPlayer) {
    const result = execSync(`node "${path.join(__dirname, 'cards.js')}" player ${name}`, { encoding: 'utf8' })
    console.log(result.trim())
    return
  }

  // Try as coach
  const idx = league.teams.findIndex(t => t.coach && t.coach.name.toLowerCase() === name.toLowerCase())
  if (idx >= 0) {
    const result = execSync(`node "${path.join(__dirname, 'cards.js')}" coach ${idx}`, { encoding: 'utf8' })
    console.log(result.trim())
  } else {
    console.error(`Not found as player or coach: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Edit commands
// ---------------------------------------------------------------------------

function cmdEditPlayer(name, field, value) {
  const league = loadLeague()
  const history = loadHistory()

  let foundPlayer = null, foundTeam = null
  for (const t of league.teams) {
    const p = t.players.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (p) { foundPlayer = p; foundTeam = t; break }
  }
  if (!foundPlayer) { console.error(`Player not found: ${name}`); return }

  const allowed = ['name', 'position', 'rating']
  if (!allowed.includes(field)) {
    console.error(`Invalid field: ${field}. Allowed: ${allowed.join(', ')}`)
    console.error('For skills, use: node manage.js edit skill <name> <skill> <value>')
    return
  }

  const oldValue = foundPlayer[field]

  // If renaming, update history too
  if (field === 'name') {
    for (const season of history.seasons) {
      for (const ps of season.playerSeasonStats) {
        if (ps.name === oldValue && ps.team === foundTeam.name) {
          ps.name = value
        }
      }
    }
    saveHistory(history)
  }

  foundPlayer[field] = value
  saveLeague(league)
  console.log(`  Updated ${name}: ${field} = "${oldValue}" -> "${value}"`)
}

function cmdEditTeam(teamIdx, field, value) {
  const league = loadLeague()
  const team = league.teams[teamIdx]
  if (!team) { console.error(`Invalid team index: ${teamIdx}`); return }

  if (field === 'colors.primary' || field === 'colors.secondary') {
    const sub = field.split('.')[1]
    if (!team.colors) team.colors = {}
    const old = team.colors[sub]
    team.colors[sub] = value
    saveLeague(league)
    console.log(`  Updated ${team.name}: ${field} = "${old}" -> "${value}"`)
    return
  }

  const allowed = ['name', 'rating']
  if (!allowed.includes(field)) {
    console.error(`Invalid field: ${field}. Allowed: name, rating, colors.primary, colors.secondary`)
    return
  }

  const oldName = team[field]

  // If renaming team, update history too
  if (field === 'name') {
    const history = loadHistory()
    for (const season of history.seasons) {
      for (const s of season.standings) { if (s.team === oldName) s.team = value }
      for (const ps of season.playerSeasonStats) { if (ps.team === oldName) ps.team = value }
      for (const cs of season.coachSeasonStats) { if (cs.team === oldName) cs.team = value }
      if (season.champion === oldName) season.champion = value
    }
    saveHistory(history)
  }

  team[field] = value
  saveLeague(league)
  console.log(`  Updated team ${teamIdx}: ${field} = "${oldName}" -> "${value}"`)
}

function cmdEditCoach(teamIdx, field, value) {
  const league = loadLeague()
  const team = league.teams[teamIdx]
  if (!team) { console.error(`Invalid team index: ${teamIdx}`); return }
  if (!team.coach) { console.error(`Team ${team.name} has no coach`); return }

  const allowed = ['name', 'rating', 'style']
  if (!allowed.includes(field)) {
    console.error(`Invalid field: ${field}. Allowed: ${allowed.join(', ')}`)
    return
  }

  const oldValue = team.coach[field]

  if (field === 'name') {
    const history = loadHistory()
    for (const season of history.seasons) {
      for (const cs of season.coachSeasonStats) {
        if (cs.coach === oldValue && cs.team === team.name) cs.coach = value
      }
    }
    saveHistory(history)
  }

  team.coach[field] = value
  saveLeague(league)
  console.log(`  Updated ${team.name} coach: ${field} = "${oldValue}" -> "${value}"`)
}

function cmdEditSkill(name, skill, value) {
  const league = loadLeague()
  let foundPlayer = null
  for (const t of league.teams) {
    const p = t.players.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (p) { foundPlayer = p; break }
  }
  if (!foundPlayer) { console.error(`Player not found: ${name}`); return }

  const validSkills = ['passing', 'shooting', 'tackling', 'saving', 'agility', 'strength',
    'penalty_taking', 'jumping', 'speed', 'marking', 'head_game', 'set_piece_taking']
  if (!validSkills.includes(skill)) {
    console.error(`Invalid skill: ${skill}. Valid: ${validSkills.join(', ')}`)
    return
  }

  const numVal = parseInt(value, 10)
  if (isNaN(numVal) || numVal < 1 || numVal > 99) {
    console.error('Skill value must be 1-99')
    return
  }

  const old = foundPlayer.skill[skill]
  foundPlayer.skill[skill] = String(numVal)
  saveLeague(league)
  console.log(`  Updated ${foundPlayer.name}: ${skill} = ${old} -> ${numVal}`)
}

// ---------------------------------------------------------------------------
// CLI router
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const cmd = args[0]

if (!cmd) {
  console.log(`
  ${CONFIG.league.shortName} League Manager

  Commands:
    teams                              List all teams
    roster <team#>                     Team roster + attributes
    player <name>                      Player profile + career stats
    standings [season#]                League table (default: current)
    leaders [season#]                  Stat leaders
    history <name>                     Player career history by season
    coaches                            Coach overview + career win%
    playoffs [season#]                 Playoff bracket
    trophy                             ${CONFIG.trophy.name} history
    awards [season#]                   Season awards
    card <name>                        Generate HTML player/coach card

    edit player <name> <field> <value> Edit player (name, position, rating)
    edit team <team#> <field> <value>  Edit team (name, rating, colors.primary, colors.secondary)
    edit coach <team#> <field> <value> Edit coach (name, rating, style)
    edit skill <name> <skill> <value>  Edit player skill (1-99)
  `)
  process.exit(0)
}

const history = cmd !== 'teams' && cmd !== 'edit' ? loadHistory() : null

switch (cmd) {
  case 'teams':
    cmdTeams()
    break
  case 'roster':
    cmdRoster(parseInt(args[1], 10))
    break
  case 'player':
    cmdPlayer(args.slice(1).join(' '))
    break
  case 'standings': {
    const h = loadHistory()
    const sn = args[1] ? parseInt(args[1], 10) : h.currentSeason
    cmdStandings(sn)
    break
  }
  case 'leaders': {
    const h = loadHistory()
    const sn = args[1] ? parseInt(args[1], 10) : h.currentSeason
    cmdLeaders(sn)
    break
  }
  case 'history':
    cmdHistory(args.slice(1).join(' '))
    break
  case 'coaches':
    cmdCoaches()
    break
  case 'playoffs': {
    const h = loadHistory()
    const sn = args[1] ? parseInt(args[1], 10) : h.currentSeason - 1
    cmdPlayoffs(sn)
    break
  }
  case 'trophy':
    cmdTrophy()
    break
  case 'awards': {
    const h = loadHistory()
    const sn = args[1] ? parseInt(args[1], 10) : h.currentSeason - 1
    cmdAwards(sn)
    break
  }
  case 'card':
    cmdCard(args.slice(1).join(' '))
    break
  case 'edit': {
    const sub = args[1]
    if (sub === 'player') cmdEditPlayer(args[2], args[3], args.slice(4).join(' '))
    else if (sub === 'team') cmdEditTeam(parseInt(args[2], 10), args[3], args.slice(4).join(' '))
    else if (sub === 'coach') cmdEditCoach(parseInt(args[2], 10), args[3], args.slice(4).join(' '))
    else if (sub === 'skill') cmdEditSkill(args[2], args[3], args[4])
    else console.error(`Unknown edit target: ${sub}. Use: player, team, coach, skill`)
    break
  }
  default:
    console.error(`Unknown command: ${cmd}. Run without arguments for help.`)
}
