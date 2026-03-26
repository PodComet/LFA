const fs = require('fs')
const path = require('path')
const engine = require('./engine/engine')
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_SUBS_PER_TEAM = 2
const GOALS_TO_WIN = 5          // first to 5 wins
const EXTENDED_GOALS = 6        // at 4-4, play to 6
const TIE_SCORE = 5             // 5-5 ends in a draw
const SUB_CHECK_INTERVAL = 800  // check subs every N iterations
const MAX_ITERATIONS = 100000   // safety cap

// ---------------------------------------------------------------------------
// Load league data and select teams
// ---------------------------------------------------------------------------
const leaguePath = path.join(__dirname, 'data', 'league.json')
if (!fs.existsSync(leaguePath)) {
  console.error(`Error: league.json not found at ${leaguePath}`)
  console.error('Please create data/league.json with the format: { "teams": [...] }')
  process.exit(1)
}
const league = JSON.parse(fs.readFileSync(leaguePath, 'utf8'))

const team1Index = parseInt(process.argv[2], 10) || 0
const team2Index = parseInt(process.argv[3], 10) || 1

if (team1Index >= league.teams.length || team2Index >= league.teams.length) {
  console.error(`Error: Invalid team index. League has ${league.teams.length} teams (0-${league.teams.length - 1}).`)
  process.exit(1)
}
if (team1Index === team2Index) {
  console.error('Error: A team cannot play against itself.')
  process.exit(1)
}

const pitch = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'pitch.json'), 'utf8'))

// ---------------------------------------------------------------------------
// Coach influence (2-star impact)
// Coach rating 50-95 maps to a skill modifier of -5% to +9%
// Style bonuses: specific skills get an extra nudge based on coaching style
// ---------------------------------------------------------------------------
function applyCoachInfluence(players, coach) {
  if (!coach || !coach.rating) return players

  const coachRating = parseInt(coach.rating, 10)
  // Base modifier: coach rating 50 → -0.05, 75 → +0.02, 95 → +0.09
  const baseModifier = (coachRating - 55) / 400

  // Style-specific skill bonuses (small additional nudge)
  const styleBonus = {
    'attacking':      { shooting: 0.04, passing: 0.03, set_piece_taking: 0.02 },
    'defensive':      { tackling: 0.04, marking: 0.04, saving: 0.02 },
    'balanced':       { passing: 0.02, tackling: 0.02, agility: 0.02 },
    'possession':     { passing: 0.04, agility: 0.02, speed: 0.02 },
    'counter-attack': { speed: 0.04, passing: 0.02, shooting: 0.02 }
  }

  const bonuses = styleBonus[coach.style] || {}

  return players.map(p => {
    const newSkill = { ...p.skill }
    for (const [attr, val] of Object.entries(newSkill)) {
      const base = parseInt(val, 10)
      const styleMod = bonuses[attr] || 0
      const adjusted = Math.round(base * (1 + baseModifier + styleMod))
      newSkill[attr] = String(Math.max(1, Math.min(99, adjusted)))
    }
    return { ...p, skill: newSkill }
  })
}

// ---------------------------------------------------------------------------
// Prepare teams: split starters (first 6) from substitutes (last 4)
// ---------------------------------------------------------------------------
function prepareTeam(teamData) {
  const team = JSON.parse(JSON.stringify(teamData))
  const coach = team.coach || null

  // Apply coach influence to all players (starters + subs)
  const boostedPlayers = applyCoachInfluence(team.players, coach)

  const starters = boostedPlayers.slice(0, 6).map(p => ({ ...p, starter: true }))
  const substitutes = boostedPlayers.slice(6, 10).map(p => ({ ...p, starter: false }))

  // The engine team only gets the 6 starters
  const engineTeam = {
    name: team.name,
    rating: team.rating,
    players: starters
  }

  return { engineTeam, substitutes, teamData: team, coach }
}

const prep1 = prepareTeam(league.teams[team1Index])
const prep2 = prepareTeam(league.teams[team2Index])

// Substitution tracking
const subState = {
  home: { made: 0, max: MAX_SUBS_PER_TEAM, subs: [...prep1.substitutes], log: [] },
  away: { made: 0, max: MAX_SUBS_PER_TEAM, subs: [...prep2.substitutes], log: [] }
}

// Track all players who participated (for end-of-match stats)
const allParticipants = {
  home: [...prep1.engineTeam.players.map(p => ({ ...p, subbedOff: false, subbedOn: false }))],
  away: [...prep2.engineTeam.players.map(p => ({ ...p, subbedOff: false, subbedOn: false }))]
}

// ---------------------------------------------------------------------------
// Team colors helper
// ---------------------------------------------------------------------------
function getTeamColors(team) {
  if (team.colors) {
    const primary = team.colors.primary || 'Unknown'
    const secondary = team.colors.secondary || 'Unknown'
    return `${primary}/${secondary}`
  }
  return 'Default'
}

function getTeamJerseyDesc(team) {
  if (team.colors && team.colors.description) {
    return team.colors.description
  }
  if (team.colors) {
    return `${team.colors.primary || 'Unknown'} body with ${team.colors.secondary || 'unknown'} sleeves`
  }
  return 'Default kit'
}

// ---------------------------------------------------------------------------
// Substitution logic
// ---------------------------------------------------------------------------
function findBestSub(availableSubs, targetPosition) {
  // Exact position match first
  let best = availableSubs.find(s => s.position === targetPosition)
  if (best) return best

  // Positional affinity map
  const affinity = {
    'GK': ['GK'],
    'CB': ['CB', 'LB', 'RB', 'CM'],
    'LB': ['LB', 'RB', 'CB', 'CM'],
    'RB': ['RB', 'LB', 'CB', 'CM'],
    'CM': ['CM', 'ST', 'CB'],
    'ST': ['ST', 'CM']
  }
  const order = affinity[targetPosition] || [targetPosition]
  for (const pos of order) {
    best = availableSubs.find(s => s.position === pos)
    if (best) return best
  }

  // Fallback: first available non-GK (unless replacing GK)
  if (targetPosition === 'GK') return availableSubs[0] || null
  return availableSubs.find(s => s.position !== 'GK') || availableSubs[0] || null
}

function initSubEngineFields(sub, replacedPlayer) {
  sub.playerID = Math.floor(Math.random() * 99999999999999) + 1000000000000
  sub.originPOS = replacedPlayer.originPOS.slice()
  sub.currentPOS = (replacedPlayer.currentPOS[0] === 'NP')
    ? replacedPlayer.originPOS.slice()
    : replacedPlayer.currentPOS.slice()
  sub.intentPOS = sub.currentPOS.slice()
  sub.action = 'none'
  sub.offside = false
  sub.hasBall = false
  sub.fitness = 100
  sub.injured = false
  sub.stats = {
    goals: 0,
    assists: 0,
    shots: { total: 0, on: 0, off: 0 },
    cards: { yellow: 0, red: 0 },  // kept for engine compatibility
    passes: { total: 0, on: 0, off: 0 },
    tackles: { total: 0, on: 0, off: 0, fouls: 0 }
  }
  if (sub.position === 'GK') sub.stats.saves = 0
  return sub
}

function performSubstitutions(teamPlayers, subStateEntry, teamName, scoreStr, participantsList) {
  if (subStateEntry.made >= subStateEntry.max) return 0
  if (subStateEntry.subs.length === 0) return 0

  let subsMade = 0
  for (let i = 0; i < teamPlayers.length; i++) {
    if (subStateEntry.made >= subStateEntry.max) break
    if (subStateEntry.subs.length === 0) break

    const player = teamPlayers[i]
    if (player.fitness < 55) {
      const sub = findBestSub(subStateEntry.subs, player.position)
      if (!sub) continue

      // Remove sub from available pool
      subStateEntry.subs.splice(subStateEntry.subs.indexOf(sub), 1)

      // Record the outgoing player's stats before replacing
      const outgoingRecord = participantsList.find(p => p.name === player.name)
      if (outgoingRecord) {
        outgoingRecord.subbedOff = true
        outgoingRecord.subbedOffScore = scoreStr
        if (player.stats) outgoingRecord.finalStats = JSON.parse(JSON.stringify(player.stats))
      }

      // Initialize substitution
      initSubEngineFields(sub, player)

      // Replace in the team array
      teamPlayers[i] = sub

      // Track the incoming player
      participantsList.push({
        ...JSON.parse(JSON.stringify(sub)),
        subbedOff: false,
        subbedOn: true,
        subbedOnScore: scoreStr
      })

      const logMsg = `SUB [${scoreStr}]: ${teamName} -- ${player.name} OFF -> ${sub.name} ON (low fitness)`
      subStateEntry.log.push(logMsg)
      subStateEntry.made++
      subsMade++
    }
  }
  return subsMade
}

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------
function getScoreStr(matchDetails) {
  const koGoals = matchDetails.kickOffTeamStatistics.goals
  const stGoals = matchDetails.secondTeamStatistics.goals
  return `${koGoals}-${stGoals}`
}

function getGoals(matchDetails) {
  return {
    ko: matchDetails.kickOffTeamStatistics.goals,
    st: matchDetails.secondTeamStatistics.goals
  }
}

function isMatchOver(koGoals, stGoals) {
  // 5-5 → draw
  if (koGoals === TIE_SCORE && stGoals === TIE_SCORE) return true
  // Normal win: first to 5 (opponent < 4, or opponent = 4 but winner has 5 which only
  // happens if they didn't both reach 4 simultaneously — but actually if one reaches 5
  // and the other has < 5 and they weren't both at 4-4, it's a win)
  // Extended: if 4-4 was reached, first to 6
  // Simplification: a team wins at 5 if opponent has <= 3,
  //   at 4-4 the target becomes 6, so a team wins at 6 if opponent <= 5 (but 5-5 is tie above)
  if (koGoals >= GOALS_TO_WIN && stGoals <= koGoals - 1 && stGoals < 4) return true
  if (stGoals >= GOALS_TO_WIN && koGoals <= stGoals - 1 && koGoals < 4) return true
  // Extended play (was 4-4 at some point)
  if (koGoals >= EXTENDED_GOALS && stGoals < koGoals) return true
  if (stGoals >= EXTENDED_GOALS && koGoals < stGoals) return true
  // Also: 5-4 is a valid win (one team reached 5 before the other got to 4...
  // but what if it was 4-3 then 5-3? That's first-to-5 win.
  // What if it was 4-4 then 5-4? User says play to 6. So 5-4 after 4-4 is NOT over.
  // But 5-4 where 4-4 never happened IS over.)
  // We need to track if 4-4 was reached. Let's handle this in the main loop.
  return false
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------
function extractEvents(iterationLog, scoreStr) {
  const events = []
  for (const entry of iterationLog) {
    if (entry.startsWith('Goal Scored by')) {
      events.push(`  \u26BD ${entry}  [${scoreStr}]`)
    } else if (entry.startsWith('penalty to:')) {
      events.push(`  \u26A0 ${entry}  [${scoreStr}]`)
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------
function coachWinPct(coach) {
  if (!coach || !coach.career || coach.career.matches === 0) return 'NEW'
  const maxPoints = coach.career.matches * 3
  return `${Math.round(coach.career.points / maxPoints * 100)}%`
}

function printHeader(t1Data, t2Data) {
  const t1Colors = getTeamColors(t1Data)
  const t2Colors = getTeamColors(t2Data)
  const t1Coach = t1Data.coach ? `${t1Data.coach.name} (${t1Data.coach.style}, ${coachWinPct(t1Data.coach)})` : 'N/A'
  const t2Coach = t2Data.coach ? `${t2Data.coach.name} (${t2Data.coach.style}, ${coachWinPct(t2Data.coach)})` : 'N/A'
  const w = 54

  console.log('')
  console.log('\u2554' + '\u2550'.repeat(w) + '\u2557')
  console.log('\u2551' + ('              ' + CONFIG.league.shortName + ' ' + CONFIG.league.format + ' MATCH SIMULATOR').padEnd(w) + '\u2551')
  console.log('\u2560' + '\u2550'.repeat(w) + '\u2563')
  console.log('\u2551' + `  ${t1Data.name}  vs  ${t2Data.name}`.padEnd(w) + '\u2551')
  console.log('\u2551' + `  Colors: ${t1Colors}  vs  ${t2Colors}`.padEnd(w) + '\u2551')
  console.log('\u2551' + `  Coach: ${t1Coach}`.padEnd(w) + '\u2551')
  console.log('\u2551' + `  Coach: ${t2Coach}`.padEnd(w) + '\u2551')
  console.log('\u2551' + `  Pitch: ${pitch.pitchWidth} x ${pitch.pitchHeight} | First to ${GOALS_TO_WIN}`.padEnd(w) + '\u2551')
  console.log('\u255A' + '\u2550'.repeat(w) + '\u255D')
  console.log('')
}

function printLineups(engineTeam, subs, teamData, label) {
  const jerseyDesc = getTeamJerseyDesc(teamData)
  console.log(`  [${engineTeam.name}] (${label}: ${jerseyDesc})`)

  // Group by position for 1-1-2-2 display
  const gk = engineTeam.players.filter(p => p.position === 'GK')
  const cb = engineTeam.players.filter(p => ['CB', 'LB', 'RB'].includes(p.position))
  const cm = engineTeam.players.filter(p => p.position === 'CM')
  const st = engineTeam.players.filter(p => p.position === 'ST')

  for (const p of gk) {
    console.log(`    GK  ${p.name} (${p.rating})`)
  }
  for (const p of cb) {
    console.log(`    CB  ${p.name} (${p.rating})`)
  }
  if (cm.length > 0) {
    console.log(`    CM  ${cm.map(p => `${p.name} (${p.rating})`).join(' | CM  ')}`)
  }
  if (st.length > 0) {
    console.log(`    ST  ${st.map(p => `${p.name} (${p.rating})`).join(' | ST  ')}`)
  }

  if (subs.length > 0) {
    console.log(`  Subs: ${subs.map(s => `${s.name} (${s.position})`).join(', ')}`)
  }
}

function printFinal(matchDetails, team1Name, team2Name) {
  const koStats = matchDetails.kickOffTeamStatistics
  const stStats = matchDetails.secondTeamStatistics
  const koTeam = matchDetails.kickOffTeam
  const stTeam = matchDetails.secondTeam

  const koGoals = koStats.goals
  const stGoals = stStats.goals
  const isDraw = (koGoals === stGoals)
  const banner = isDraw ? 'DRAW' : 'FINAL'

  console.log('')
  console.log('\u2550'.repeat(55))
  console.log(`                  ${banner}`)
  console.log(`       ${team1Name}  ${koGoals}  -  ${stGoals}  ${team2Name}`)
  console.log('\u2550'.repeat(55))
  console.log('')

  // Team Statistics
  console.log('\u{1F4CA} TEAM STATISTICS')
  console.log('-'.repeat(55))
  const statLabel = (label) => label.padEnd(20)
  const statLine = (label, v1, v2) => {
    console.log(`  ${String(v1).padStart(6)}  ${statLabel(label)}  ${String(v2).padEnd(6)}`)
  }
  console.log(`  ${team1Name.padStart(6 + team1Name.length > 20 ? 6 : 6)}${''.padStart(22)}${team2Name}`)
  statLine('Shots (total)', koStats.shots.total, stStats.shots.total)
  statLine('Shots on target', koStats.shots.on, stStats.shots.on)
  statLine('Shots off target', koStats.shots.off, stStats.shots.off)
  statLine('Corners', koStats.corners, stStats.corners)
  statLine('Free Kicks', koStats.freekicks, stStats.freekicks)
  statLine('Penalties', koStats.penalties, stStats.penalties)
  statLine('Fouls', koStats.fouls, stStats.fouls)
  console.log('')

  // Player Statistics
  console.log('\u{1F464} PLAYER STATISTICS')
  console.log('-'.repeat(55))

  const printTeamPlayers = (teamName, participants, currentPlayers) => {
    console.log(`  [ ${teamName} ]`)
    for (const p of participants) {
      const s = p.finalStats || (currentPlayers.find(cp => cp.name === p.name) || {}).stats || p.stats
      if (!s) continue

      const pct = (on, total) => total > 0 ? `${Math.round(on / total * 100)}%` : '-'

      const parts = []
      if (s.goals > 0) parts.push(`Goals: ${s.goals}`)
      if (s.assists > 0) parts.push(`Assists: ${s.assists}`)
      parts.push(`Shots: ${s.shots.total} (on: ${s.shots.on}, off: ${s.shots.off}, ${pct(s.shots.on, s.shots.total)})`)
      parts.push(`Passes: ${s.passes.total} (on: ${s.passes.on}, off: ${s.passes.off}, ${pct(s.passes.on, s.passes.total)})`)
      parts.push(`Tackles: ${s.tackles.total} (on: ${s.tackles.on}, off: ${s.tackles.off}, fouls: ${s.tackles.fouls}, ${pct(s.tackles.on, s.tackles.total)})`)
      if (s.saves !== undefined) parts.push(`Saves: ${s.saves}`)

      let suffix = ''
      if (p.subbedOff) suffix = ` [OFF @ ${p.subbedOffScore || ''}]`
      if (p.subbedOn) suffix = ` [ON @ ${p.subbedOnScore || ''}]`

      console.log(`    ${p.name} (${p.position})${suffix}`)
      console.log(`      ${parts.join(' | ')}`)
    }
  }

  printTeamPlayers(koTeam.name, allParticipants.home, koTeam.players)
  console.log('')
  printTeamPlayers(stTeam.name, allParticipants.away, stTeam.players)
  console.log('')
}

// ---------------------------------------------------------------------------
// Main match runner
// ---------------------------------------------------------------------------
async function runMatch() {
  const t1Data = league.teams[team1Index]
  const t2Data = league.teams[team2Index]

  printHeader(t1Data, t2Data)

  // Print lineups
  console.log('\u{1F4CB} STARTING LINEUPS')
  printLineups(prep1.engineTeam, prep1.substitutes, t1Data, 'Home')
  console.log('')
  printLineups(prep2.engineTeam, prep2.substitutes, t2Data, 'Away')
  console.log('')

  // Deep copy engine teams
  const t1 = JSON.parse(JSON.stringify(prep1.engineTeam))
  const t2 = JSON.parse(JSON.stringify(prep2.engineTeam))

  let matchDetails = await engine.initiateGame(t1, t2, pitch)

  const team1Name = matchDetails.kickOffTeam.name
  const team2Name = matchDetails.secondTeam.name

  // Determine which is home/away in engine terms
  const homeIsKickOff = (matchDetails.kickOffTeam.name === t1Data.name)

  // ---------------------------------------------------------------------------
  // Assist tracking: track the last DIFFERENT player who touched the ball.
  // ---------------------------------------------------------------------------
  let currentToucher = { playerName: '', playerID: '', teamID: '' }
  let previousToucher = { playerName: '', playerID: '', teamID: '' }

  function updateTouchChain() {
    const lt = matchDetails.ball.lastTouch
    if (lt.playerName && lt.playerName !== currentToucher.playerName) {
      previousToucher = { ...currentToucher }
      currentToucher = { playerName: lt.playerName, playerID: lt.playerID, teamID: lt.teamID }
    }
  }

  function creditAssist(scoreStr) {
    for (const entry of matchDetails.iterationLog) {
      if (!entry.startsWith('Goal Scored by')) continue

      const scorerMatch = entry.match(/Goal Scored by - (.+?) - \((.+?)\)/)
      if (!scorerMatch) continue
      const scorerName = scorerMatch[1]
      const scoringTeamName = scorerMatch[2]

      if (!previousToucher.playerName || previousToucher.playerName === scorerName) continue

      const scoringTeam = (matchDetails.kickOffTeam.name === scoringTeamName)
        ? matchDetails.kickOffTeam : matchDetails.secondTeam

      if (String(previousToucher.teamID) !== String(scoringTeam.teamID)) continue

      const assister = scoringTeam.players.find(p => p.name === previousToucher.playerName)
      if (assister && assister.stats) {
        assister.stats.assists++
        console.log(`  \u{1F91D} Assist by ${previousToucher.playerName} for ${scorerName}  [${scoreStr}]`)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Match loop — play until win condition or safety cap
  // ---------------------------------------------------------------------------
  console.log(`\u26BD  Match started — first to ${GOALS_TO_WIN}...`)
  console.log('')

  let extended = false   // true once 4-4 is reached
  let iteration = 0
  let lastSubCheck = 0

  while (iteration < MAX_ITERATIONS) {
    updateTouchChain()
    matchDetails = await engine.playIteration(matchDetails)
    iteration++

    const { ko, st } = getGoals(matchDetails)
    const scoreStr = `${ko}-${st}`

    creditAssist(scoreStr)

    const events = extractEvents(matchDetails.iterationLog, scoreStr)
    for (const ev of events) {
      console.log(ev)
    }

    // Check if 4-4 was reached (triggers extended play)
    if (ko >= 4 && st >= 4 && !extended) {
      extended = true
      console.log(`\n  \u{1F525} 4-4 — Extended play! First to ${EXTENDED_GOALS} wins, or ${TIE_SCORE}-${TIE_SCORE} is a draw.\n`)
    }

    // Check match end conditions
    if (ko === TIE_SCORE && st === TIE_SCORE) {
      // 5-5 draw
      break
    }
    if (!extended) {
      // Normal: first to 5
      if (ko >= GOALS_TO_WIN || st >= GOALS_TO_WIN) break
    } else {
      // Extended: first to 6
      if (ko >= EXTENDED_GOALS || st >= EXTENDED_GOALS) break
    }

    // Periodic substitution checks
    if (iteration - lastSubCheck >= SUB_CHECK_INTERVAL) {
      lastSubCheck = iteration

      const homePlayers = homeIsKickOff ? matchDetails.kickOffTeam.players : matchDetails.secondTeam.players
      const awayPlayers = homeIsKickOff ? matchDetails.secondTeam.players : matchDetails.kickOffTeam.players

      const prevHomeLogLen = subState.home.log.length
      const prevAwayLogLen = subState.away.log.length

      performSubstitutions(homePlayers, subState.home, t1Data.name, scoreStr, allParticipants.home)
      performSubstitutions(awayPlayers, subState.away, t2Data.name, scoreStr, allParticipants.away)

      for (let j = prevHomeLogLen; j < subState.home.log.length; j++) {
        console.log(`  \u{1F504} ${subState.home.log[j]}`)
      }
      for (let j = prevAwayLogLen; j < subState.away.log.length; j++) {
        console.log(`  \u{1F504} ${subState.away.log[j]}`)
      }
    }
  }

  // ---- Final ----
  updateFinalStats(matchDetails.kickOffTeam.players, homeIsKickOff ? allParticipants.home : allParticipants.away)
  updateFinalStats(matchDetails.secondTeam.players, homeIsKickOff ? allParticipants.away : allParticipants.home)

  printFinal(matchDetails, team1Name, team2Name)

  // ---- Update coach career stats and persist to league.json ----
  const koGoals = matchDetails.kickOffTeamStatistics.goals
  const stGoals = matchDetails.secondTeamStatistics.goals

  const homeGoals = homeIsKickOff ? koGoals : stGoals
  const awayGoals = homeIsKickOff ? stGoals : koGoals

  function updateCoachCareer(teamIdx, goalsFor, goalsAgainst) {
    const coach = league.teams[teamIdx].coach
    if (!coach) return
    if (!coach.career) coach.career = { matches: 0, points: 0 }
    coach.career.matches++
    if (goalsFor > goalsAgainst) coach.career.points += 3
    else if (goalsFor === goalsAgainst) coach.career.points += 1
  }

  updateCoachCareer(team1Index, homeGoals, awayGoals)
  updateCoachCareer(team2Index, awayGoals, homeGoals)

  fs.writeFileSync(leaguePath, JSON.stringify(league, null, 2))

  // ---- Update season history ----
  const historyPath = path.join(__dirname, 'data', 'history.json')
  if (fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    const currentSeason = history.seasons.find(s => s.number === history.currentSeason)
    if (currentSeason) {
      // Update standings
      function updateStanding(teamName, gf, ga) {
        let s = currentSeason.standings.find(s => s.team === teamName)
        if (!s) {
          s = { team: teamName, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }
          currentSeason.standings.push(s)
        }
        s.played++
        s.gf += gf; s.ga += ga
        if (gf > ga) { s.won++; s.points += 3 }
        else if (gf === ga) { s.drawn++; s.points += 1 }
        else { s.lost++ }
      }
      updateStanding(t1Data.name, homeGoals, awayGoals)
      updateStanding(t2Data.name, awayGoals, homeGoals)

      // Sort standings
      currentSeason.standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points
        const gdA = a.gf - a.ga, gdB = b.gf - b.ga
        if (gdB !== gdA) return gdB - gdA
        return b.gf - a.gf
      })

      // Update player season stats
      function updatePlayerStats(teamName, participants, enginePlayers) {
        for (const p of participants) {
          const s = p.finalStats || (enginePlayers.find(cp => cp.name === p.name) || {}).stats || p.stats
          if (!s) continue
          let ps = currentSeason.playerSeasonStats.find(
            ps => ps.name === p.name && ps.team === teamName
          )
          if (!ps) {
            ps = {
              team: teamName, name: p.name, position: p.position,
              rating: p.rating, appearances: 0, goals: 0, assists: 0,
              shots: { total: 0, on: 0, off: 0 },
              passes: { total: 0, on: 0, off: 0 },
              tackles: { total: 0, on: 0, off: 0, fouls: 0 }
            }
            if (p.position === 'GK') ps.saves = 0
            currentSeason.playerSeasonStats.push(ps)
          }
          ps.appearances++
          ps.goals += s.goals || 0
          ps.assists += s.assists || 0
          ps.shots.total += s.shots ? s.shots.total : 0
          ps.shots.on += s.shots ? s.shots.on : 0
          ps.shots.off += s.shots ? s.shots.off : 0
          ps.passes.total += s.passes ? s.passes.total : 0
          ps.passes.on += s.passes ? s.passes.on : 0
          ps.passes.off += s.passes ? s.passes.off : 0
          ps.tackles.total += s.tackles ? s.tackles.total : 0
          ps.tackles.on += s.tackles ? s.tackles.on : 0
          ps.tackles.off += s.tackles ? s.tackles.off : 0
          ps.tackles.fouls += s.tackles ? s.tackles.fouls : 0
          if (ps.saves !== undefined && s.saves !== undefined) ps.saves += s.saves
        }
      }

      const koPlayers = matchDetails.kickOffTeam.players
      const stPlayers = matchDetails.secondTeam.players
      if (homeIsKickOff) {
        updatePlayerStats(t1Data.name, allParticipants.home, koPlayers)
        updatePlayerStats(t2Data.name, allParticipants.away, stPlayers)
      } else {
        updatePlayerStats(t2Data.name, allParticipants.away, koPlayers)
        updatePlayerStats(t1Data.name, allParticipants.home, stPlayers)
      }

      // Update coach season stats
      function updateCoachSeason(teamName, gf, ga) {
        let cs = currentSeason.coachSeasonStats.find(c => c.team === teamName)
        if (!cs) {
          const team = league.teams.find(t => t.name === teamName)
          cs = {
            team: teamName,
            coach: team && team.coach ? team.coach.name : 'Unknown',
            style: team && team.coach ? team.coach.style : 'balanced',
            played: 0, won: 0, drawn: 0, lost: 0, points: 0
          }
          currentSeason.coachSeasonStats.push(cs)
        }
        cs.played++
        if (gf > ga) { cs.won++; cs.points += 3 }
        else if (gf === ga) { cs.drawn++; cs.points += 1 }
        else { cs.lost++ }
      }
      updateCoachSeason(t1Data.name, homeGoals, awayGoals)
      updateCoachSeason(t2Data.name, awayGoals, homeGoals)

      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2))
    }
  }
}

function updateFinalStats(currentPlayers, participants) {
  for (const cp of currentPlayers) {
    const record = participants.find(p => p.name === cp.name && !p.subbedOff)
    if (record && cp.stats) {
      record.finalStats = JSON.parse(JSON.stringify(cp.stats))
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
runMatch().catch(err => {
  console.error('Match simulation error:', err.message)
  console.error(err.stack)
  process.exit(1)
})
