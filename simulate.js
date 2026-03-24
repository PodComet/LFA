const fs = require('fs')
const path = require('path')
const engine = require('./engine/engine')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ITERATIONS_PER_HALF = 2700
const MAX_SUBS_PER_TEAM = 2
const SECOND_HALF_SUB_CHECK_ITERATION = 1350 // ~halfway through 2nd half

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
// Prepare teams: split starters (first 6) from substitutes (last 4)
// ---------------------------------------------------------------------------
function prepareTeam(teamData) {
  const team = JSON.parse(JSON.stringify(teamData))
  const starters = team.players.slice(0, 6).map(p => ({ ...p, starter: true }))
  const substitutes = team.players.slice(6, 10).map(p => ({ ...p, starter: false }))

  // The engine team only gets the 6 starters
  const engineTeam = {
    name: team.name,
    rating: team.rating,
    players: starters
  }

  return { engineTeam, substitutes, teamData: team }
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
    shots: { total: 0, on: 0, off: 0 },
    cards: { yellow: 0, red: 0 },
    passes: { total: 0, on: 0, off: 0 },
    tackles: { total: 0, on: 0, off: 0, fouls: 0 }
  }
  if (sub.position === 'GK') sub.stats.saves = 0
  return sub
}

function performSubstitutions(teamPlayers, subStateEntry, teamName, minuteStr, participantsList) {
  if (subStateEntry.made >= subStateEntry.max) return 0
  if (subStateEntry.subs.length === 0) return 0

  let subsMade = 0
  for (let i = 0; i < teamPlayers.length; i++) {
    if (subStateEntry.made >= subStateEntry.max) break
    if (subStateEntry.subs.length === 0) break

    const player = teamPlayers[i]
    if (player.fitness < 60 || player.injured) {
      const sub = findBestSub(subStateEntry.subs, player.position)
      if (!sub) continue

      // Remove sub from available pool
      subStateEntry.subs.splice(subStateEntry.subs.indexOf(sub), 1)

      // Record the outgoing player's stats before replacing
      const outgoingRecord = participantsList.find(p => p.name === player.name)
      if (outgoingRecord) {
        outgoingRecord.subbedOff = true
        outgoingRecord.subbedOffMinute = minuteStr
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
        subbedOnMinute: minuteStr
      })

      const reason = player.injured ? 'injury' : 'low fitness'
      const logMsg = `SUB [${minuteStr}]: ${teamName} -- ${player.name} OFF -> ${sub.name} ON (${reason})`
      subStateEntry.log.push(logMsg)
      subStateEntry.made++
      subsMade++
    }
  }
  return subsMade
}

function performSubstitutionsLowThreshold(teamPlayers, subStateEntry, teamName, minuteStr, participantsList) {
  // Same logic but with threshold 50 for second-half mid check
  if (subStateEntry.made >= subStateEntry.max) return 0
  if (subStateEntry.subs.length === 0) return 0

  let subsMade = 0
  for (let i = 0; i < teamPlayers.length; i++) {
    if (subStateEntry.made >= subStateEntry.max) break
    if (subStateEntry.subs.length === 0) break

    const player = teamPlayers[i]
    if (player.fitness < 50 || player.injured) {
      const sub = findBestSub(subStateEntry.subs, player.position)
      if (!sub) continue

      subStateEntry.subs.splice(subStateEntry.subs.indexOf(sub), 1)

      const outgoingRecord = participantsList.find(p => p.name === player.name)
      if (outgoingRecord) {
        outgoingRecord.subbedOff = true
        outgoingRecord.subbedOffMinute = minuteStr
        if (player.stats) outgoingRecord.finalStats = JSON.parse(JSON.stringify(player.stats))
      }

      initSubEngineFields(sub, player)
      teamPlayers[i] = sub

      participantsList.push({
        ...JSON.parse(JSON.stringify(sub)),
        subbedOff: false,
        subbedOn: true,
        subbedOnMinute: minuteStr
      })

      const reason = player.injured ? 'injury' : 'low fitness'
      const logMsg = `SUB [${minuteStr}]: ${teamName} -- ${player.name} OFF -> ${sub.name} ON (${reason})`
      subStateEntry.log.push(logMsg)
      subStateEntry.made++
      subsMade++
    }
  }
  return subsMade
}

// ---------------------------------------------------------------------------
// Minute calculation
// ---------------------------------------------------------------------------
function getMinute(iteration, isSecondHalf) {
  const minute = Math.floor(iteration / ITERATIONS_PER_HALF * 45) + (isSecondHalf ? 46 : 1)
  return `${minute}'`
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------
function extractEvents(iterationLog, minuteStr) {
  const events = []
  for (const entry of iterationLog) {
    if (entry.startsWith('Goal Scored by')) {
      events.push(`  \u26BD ${entry}  [${minuteStr}]`)
    } else if (entry.startsWith('penalty to:')) {
      events.push(`  \u26A0 ${entry}  [${minuteStr}]`)
    } else if (entry.startsWith('Player Injured')) {
      events.push(`  \u{1F3E5} ${entry}  [${minuteStr}]`)
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------
function printHeader(t1Data, t2Data) {
  const t1Colors = getTeamColors(t1Data)
  const t2Colors = getTeamColors(t2Data)
  const w = 54

  console.log('')
  console.log('\u2554' + '\u2550'.repeat(w) + '\u2557')
  console.log('\u2551' + '              LFA 6v6 MATCH SIMULATOR'.padEnd(w) + '\u2551')
  console.log('\u2560' + '\u2550'.repeat(w) + '\u2563')
  console.log('\u2551' + `  ${t1Data.name}  vs  ${t2Data.name}`.padEnd(w) + '\u2551')
  console.log('\u2551' + `  Colors: ${t1Colors}  vs  ${t2Colors}`.padEnd(w) + '\u2551')
  console.log('\u2551' + `  Pitch: ${pitch.pitchWidth} x ${pitch.pitchHeight} | Formation: 1-1-2-2`.padEnd(w) + '\u2551')
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

function printFullTime(matchDetails, team1Name, team2Name, t1Data, t2Data) {
  const koStats = matchDetails.kickOffTeamStatistics
  const stStats = matchDetails.secondTeamStatistics
  const koTeam = matchDetails.kickOffTeam
  const stTeam = matchDetails.secondTeam

  console.log('')
  console.log('\u2550'.repeat(55))
  console.log('                  FULL TIME')
  console.log(`       ${team1Name}  ${koStats.goals}  -  ${stStats.goals}  ${team2Name}`)
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

      const parts = []
      if (s.goals > 0) parts.push(`Goals: ${s.goals}`)
      parts.push(`Shots: ${s.shots.total} (on: ${s.shots.on}, off: ${s.shots.off})`)
      parts.push(`Passes: ${s.passes.total} (on: ${s.passes.on}, off: ${s.passes.off})`)
      parts.push(`Tackles: ${s.tackles.total} (on: ${s.tackles.on}, off: ${s.tackles.off}, fouls: ${s.tackles.fouls})`)
      if (s.cards.yellow > 0 || s.cards.red > 0) {
        parts.push(`Cards: Y${s.cards.yellow} R${s.cards.red}`)
      }
      if (s.saves !== undefined) parts.push(`Saves: ${s.saves}`)

      let suffix = ''
      if (p.subbedOff) suffix = ` [OFF ${p.subbedOffMinute || ''}]`
      if (p.subbedOn) suffix = ` [ON ${p.subbedOnMinute || ''}]`

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

  // ---- First Half ----
  console.log(`\u23F1  First Half...`)

  for (let i = 0; i < ITERATIONS_PER_HALF; i++) {
    matchDetails = await engine.playIteration(matchDetails)
    const minuteStr = getMinute(i, false)
    const events = extractEvents(matchDetails.iterationLog, minuteStr)
    for (const ev of events) {
      console.log(ev)
    }
  }

  // ---- Half Time ----
  console.log('')
  console.log(`--- HALF TIME ---  ${team1Name} ${matchDetails.kickOffTeamStatistics.goals} - ${matchDetails.secondTeamStatistics.goals} ${team2Name}`)

  // Half-time substitutions (fitness < 60 or injured)
  const htHomePlayers = homeIsKickOff ? matchDetails.kickOffTeam.players : matchDetails.secondTeam.players
  const htAwayPlayers = homeIsKickOff ? matchDetails.secondTeam.players : matchDetails.kickOffTeam.players

  const htHomeSubs = performSubstitutions(htHomePlayers, subState.home, t1Data.name, 'HT', allParticipants.home)
  const htAwaySubs = performSubstitutions(htAwayPlayers, subState.away, t2Data.name, 'HT', allParticipants.away)

  for (const msg of subState.home.log) {
    if (msg.includes('[HT]')) console.log(`  \u{1F504} ${msg}`)
  }
  for (const msg of subState.away.log) {
    if (msg.includes('[HT]')) console.log(`  \u{1F504} ${msg}`)
  }

  console.log('')

  // ---- Second Half ----
  matchDetails = await engine.startSecondHalf(matchDetails)
  console.log(`\u23F1  Second Half...`)

  let secondHalfSubCheckDone = false

  for (let i = 0; i < ITERATIONS_PER_HALF; i++) {
    matchDetails = await engine.playIteration(matchDetails)
    const minuteStr = getMinute(i, true)
    const events = extractEvents(matchDetails.iterationLog, minuteStr)
    for (const ev of events) {
      console.log(ev)
    }

    // Mid second-half substitution check
    if (!secondHalfSubCheckDone && i >= SECOND_HALF_SUB_CHECK_ITERATION) {
      secondHalfSubCheckDone = true

      const shHomePlayers = homeIsKickOff ? matchDetails.kickOffTeam.players : matchDetails.secondTeam.players
      const shAwayPlayers = homeIsKickOff ? matchDetails.secondTeam.players : matchDetails.kickOffTeam.players

      const prevHomeLogLen = subState.home.log.length
      const prevAwayLogLen = subState.away.log.length

      performSubstitutionsLowThreshold(shHomePlayers, subState.home, t1Data.name, minuteStr, allParticipants.home)
      performSubstitutionsLowThreshold(shAwayPlayers, subState.away, t2Data.name, minuteStr, allParticipants.away)

      for (let j = prevHomeLogLen; j < subState.home.log.length; j++) {
        console.log(`  \u{1F504} ${subState.home.log[j]}`)
      }
      for (let j = prevAwayLogLen; j < subState.away.log.length; j++) {
        console.log(`  \u{1F504} ${subState.away.log[j]}`)
      }
    }
  }

  // ---- Full Time ----
  // Update final stats for participants still on the pitch
  updateFinalStats(matchDetails.kickOffTeam.players, homeIsKickOff ? allParticipants.home : allParticipants.away)
  updateFinalStats(matchDetails.secondTeam.players, homeIsKickOff ? allParticipants.away : allParticipants.home)

  printFullTime(matchDetails, team1Name, team2Name, t1Data, t2Data)
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
