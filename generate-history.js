#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generate 15 seasons of LFA historical data with the full league format:
//   Regular season: 11 matches per team (each opponent once)
//     Top 6 from previous season: 6 home / 5 away
//     Bottom 6 from previous season: 5 home / 6 away
//   Playoffs: top 8 qualify
//     Quarterfinals: best-of-3 (home-away-home, higher seed has games 1 & 3)
//     Semifinals: one match, neutral site
//     Final: one match, neutral site — Guy Kilne trophy
//
// Run: node generate-history.js
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')
const { getSkillsAtAge, getRatingAtAge } = require('./player-development')

const league = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'league.json'), 'utf8'))
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))
const NUM_SEASONS = 15
const CURRENT_SEASON = 16

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ---------------------------------------------------------------------------
// Captain selection — prefer longest-tenured non-GK starter ("home player")
// ---------------------------------------------------------------------------
// For history generation, we simulate tenure by assigning each player a
// random number of seasons with the club. The captain is the non-GK starter
// with the highest tenure. This is initialised once and persists across seasons.
const playerTenure = new Map()
for (const team of league.teams) {
  for (const player of team.players) {
    // Starters get higher tenure range (they've been around longer)
    const isStarter = team.players.indexOf(player) < 6
    playerTenure.set(`${team.name}:${player.name}`,
      isStarter ? rand(3, 15) : rand(1, 6))
  }
}

function pickCaptain(team) {
  // Starters sorted by tenure descending, then alphabetical for ties
  // GKs are eligible — captains can be any position
  const candidates = team.players.slice(0, 6)
  candidates.sort((a, b) => {
    const tA = playerTenure.get(`${team.name}:${a.name}`) || 0
    const tB = playerTenure.get(`${team.name}:${b.name}`) || 0
    if (tB !== tA) return tB - tA
    return a.name.localeCompare(b.name)
  })
  return candidates[0].name
}

// ---------------------------------------------------------------------------
// Coach style modifiers for quick simulation
// offBoost: extra goals scored, defBoost: fewer goals conceded
// Scaled by coach rating: (coachRating - 55) / 400 as multiplier
const STYLE_MODIFIERS = {
  'attacking':      { off: 0.35, def: -0.10 },
  'defensive':      { off: -0.10, def: 0.30 },
  'balanced':       { off: 0.10, def: 0.10 },
  'possession':     { off: 0.15, def: 0.15 },
  'counter-attack': { off: 0.25, def: 0.05 }
}

function coachBoosts(coach) {
  if (!coach || !coach.rating) return { off: 0, def: 0 }
  const cr = parseInt(coach.rating, 10)
  const base = (cr - 55) / 400  // -0.05 to +0.09
  const mods = STYLE_MODIFIERS[coach.style] || { off: 0, def: 0 }
  return { off: mods.off * (0.5 + base * 5), def: mods.def * (0.5 + base * 5) }
}

// Match simulation (quick, for history generation)
// ---------------------------------------------------------------------------
// Race-to-5 simulation
function scoreProb(teamRating, oppRating, homeBonus, offBoost, defPenalty) {
  const base = 0.42 + (teamRating - oppRating) / 250 + homeBonus / 10 + (offBoost || 0) / 5 - (defPenalty || 0) / 5
  return Math.max(0.15, Math.min(0.70, base))
}

function simulateMatch(team1, team2, homeTeamIdx) {
  // homeTeamIdx: 0 = team1 is home, 1 = team2 is home, -1 = neutral
  const r1 = parseInt(team1.rating, 10)
  const r2 = parseInt(team2.rating, 10)
  const hb1 = homeTeamIdx === 0 ? 0.3 : (homeTeamIdx === 1 ? -0.15 : 0)
  const hb2 = homeTeamIdx === 1 ? 0.3 : (homeTeamIdx === 0 ? -0.15 : 0)
  const cb1 = coachBoosts(team1.coach)
  const cb2 = coachBoosts(team2.coach)

  const p1 = scoreProb(r1, r2, hb1, cb1.off, cb2.def)
  const p2 = scoreProb(r2, r1, hb2, cb2.off, cb1.def)

  // Valid scores: 5-0..5-3 (first-to-5), 6-4, 6-5 (extended after 4-4), 5-5 (draw)
  let g1 = 0, g2 = 0
  const MAX_ROUNDS = 50

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (Math.random() < p1) g1++
    if (Math.random() < p2) g2++

    const extended = (g1 >= 4 && g2 >= 4)

    if (!extended) {
      if (g1 >= 5 && g2 <= 3) break
      if (g2 >= 5 && g1 <= 3) break
    } else {
      if (g1 === 5 && g2 === 5) break
      if (g1 >= 6 && g1 > g2) break
      if (g2 >= 6 && g2 > g1) break
    }
  }

  if (g1 < 5 && g2 < 5) { if (g1 >= g2) g1 = 5; else g2 = 5 }
  if (g1 >= 4 && g2 >= 4) {
    if (g1 > 6) g1 = 6; if (g2 > 6) g2 = 6
    if ((g1 === 5 && g2 === 4) || (g1 === 4 && g2 === 5)) {
      if (g1 > g2) g1 = 6; else g2 = 6
    }
  }
  if (g1 > 6) g1 = 6; if (g2 > 6) g2 = 6

  return { g1, g2 }
}

// Simulate a decisive match (no draws — for playoff elimination)
function simulateDecisiveMatch(team1, team2, homeTeamIdx) {
  let result
  do {
    result = simulateMatch(team1, team2, homeTeamIdx)
  } while (result.g1 === result.g2)
  return result
}

// ---------------------------------------------------------------------------
// Player stats generation
// ---------------------------------------------------------------------------
function generatePlayerSeasonStats(player, appearances, teamGoalsFor, maxApp) {
  const pos = player.position
  const rating = parseInt(player.rating, 10)
  const factor = rating / 80
  const appRatio = appearances / Math.max(maxApp, 1)

  let goals = 0, assists = 0, saves = undefined
  let shotsTotal = 0, passesTotal = 0, tacklesTotal = 0

  if (pos === 'GK') {
    saves = Math.round(rand(25, 60) * factor * appRatio)
    shotsTotal = rand(0, 2)
    goals = Math.random() < 0.03 ? 1 : 0
    assists = rand(0, Math.round(2 * appRatio))
    passesTotal = Math.round(rand(50, 130) * appRatio)
    tacklesTotal = rand(0, Math.round(4 * appRatio))
  } else if (pos === 'CB') {
    shotsTotal = Math.round(rand(3, 15) * factor * appRatio)
    goals = Math.round(rand(0, 3) * factor * appRatio)
    assists = Math.round(rand(0, 4) * factor * appRatio)
    passesTotal = Math.round(rand(80, 200) * factor * appRatio)
    tacklesTotal = Math.round(rand(20, 55) * factor * appRatio)
  } else if (pos === 'CM') {
    shotsTotal = Math.round(rand(10, 40) * factor * appRatio)
    goals = Math.round(rand(1, 10) * factor * appRatio)
    assists = Math.round(rand(2, 10) * factor * appRatio)
    passesTotal = Math.round(rand(130, 340) * factor * appRatio)
    tacklesTotal = Math.round(rand(15, 40) * factor * appRatio)
  } else if (pos === 'ST') {
    shotsTotal = Math.round(rand(20, 80) * factor * appRatio)
    goals = Math.round(rand(3, 20) * factor * appRatio)
    assists = Math.round(rand(1, 7) * factor * appRatio)
    passesTotal = Math.round(rand(60, 200) * factor * appRatio)
    tacklesTotal = Math.round(rand(3, 16) * factor * appRatio)
  }

  goals = Math.min(goals, Math.round(teamGoalsFor * 0.4))

  const shotsOn = Math.round(shotsTotal * (rand(40, 85) / 100))
  const passesOn = Math.round(passesTotal * (rand(50, 85) / 100))
  const tacklesOn = Math.round(tacklesTotal * (rand(30, 70) / 100))
  const tacklesFouls = Math.round(tacklesTotal * (rand(5, 15) / 100))
  const tacklesOff = Math.max(0, tacklesTotal - tacklesOn - tacklesFouls)

  const stat = {
    appearances, goals, assists,
    shots: { total: shotsTotal, on: shotsOn, off: shotsTotal - shotsOn },
    passes: { total: passesTotal, on: passesOn, off: passesTotal - passesOn },
    tackles: { total: tacklesTotal, on: tacklesOn, off: tacklesOff, fouls: tacklesFouls }
  }
  if (saves !== undefined) stat.saves = saves
  return stat
}

// ---------------------------------------------------------------------------
// Season generation
// ---------------------------------------------------------------------------
function generateSeason(seasonNum, teams, prevStandings) {
  // --- Determine home/away schedule ---
  // Top 6 from previous season get 6 home, 5 away
  // Bottom 6 get 5 home, 6 away
  const topTeams = new Set()
  if (prevStandings) {
    prevStandings.slice(0, 6).forEach(s => topTeams.add(s.team))
  } else {
    // First season: use team rating to seed
    const sorted = [...teams].sort((a, b) => parseInt(b.rating, 10) - parseInt(a.rating, 10))
    sorted.slice(0, 6).forEach(t => topTeams.add(t.name))
  }

  const standings = teams.map(t => ({
    team: t.name,
    played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
  }))
  const sMap = {}
  standings.forEach(s => { sMap[s.team] = s })

  // Each pair plays once. Determine who is home.
  const matches = []
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const t1 = teams[i], t2 = teams[j]
      // Decide home team: both top-6 or both bottom-6 → coin flip
      // One top, one bottom → top team is home
      const t1Top = topTeams.has(t1.name)
      const t2Top = topTeams.has(t2.name)
      let homeIdx
      if (t1Top && !t2Top) homeIdx = 0
      else if (t2Top && !t1Top) homeIdx = 1
      else homeIdx = rand(0, 1)
      matches.push({ t1, t2, homeIdx })
    }
  }

  // Verify home counts and balance them
  const homeCounts = {}
  teams.forEach(t => { homeCounts[t.name] = 0 })
  for (const m of matches) {
    const homeName = m.homeIdx === 0 ? m.t1.name : m.t2.name
    homeCounts[homeName]++
  }
  // Swap if needed to hit targets (top-6: 6 home, bottom-6: 5 home)
  // Simple pass — not perfect but close enough for history
  for (const m of matches) {
    const h = m.homeIdx === 0 ? m.t1.name : m.t2.name
    const a = m.homeIdx === 0 ? m.t2.name : m.t1.name
    const hTarget = topTeams.has(h) ? 6 : 5
    const aTarget = topTeams.has(a) ? 6 : 5
    if (homeCounts[h] > hTarget && homeCounts[a] < aTarget) {
      m.homeIdx = m.homeIdx === 0 ? 1 : 0
      homeCounts[h]--
      homeCounts[a]++
    }
  }

  // Simulate regular season
  const matchResults = []
  for (const m of matches) {
    const { g1, g2 } = simulateMatch(m.t1, m.t2, m.homeIdx)
    const s1 = sMap[m.t1.name], s2 = sMap[m.t2.name]
    s1.played++; s2.played++
    s1.gf += g1; s1.ga += g2
    s2.gf += g2; s2.ga += g1
    if (g1 > g2) { s1.won++; s1.points += 3; s2.lost++ }
    else if (g2 > g1) { s2.won++; s2.points += 3; s1.lost++ }
    else { s1.drawn++; s1.points += 1; s2.drawn++; s2.points += 1 }
    matchResults.push({
      home: m.homeIdx === 0 ? m.t1.name : m.t2.name,
      away: m.homeIdx === 0 ? m.t2.name : m.t1.name,
      score: [g1, g2],
      homeIdx: m.homeIdx
    })
  }

  // Sort standings
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga
    if (gdB !== gdA) return gdB - gdA
    return b.gf - a.gf
  })

  // --- Playoffs: top 8 qualify ---
  const playoffTeams = standings.slice(0, 8).map(s => {
    return teams.find(t => t.name === s.team)
  })

  // Quarterfinals: #1v#8, #2v#7, #3v#6, #4v#5 — best of 3
  const qfMatchups = [[0, 7], [1, 6], [2, 5], [3, 4]]
  const quarterFinals = []
  const qfWinners = []

  for (const [hi, lo] of qfMatchups) {
    const higher = playoffTeams[hi]
    const lower = playoffTeams[lo]
    const games = []
    let winsH = 0, winsL = 0

    // Game 1: at higher seed
    let r = simulateDecisiveMatch(higher, lower, 0)
    games.push({ home: higher.name, away: lower.name, score: [r.g1, r.g2] })
    if (r.g1 > r.g2) winsH++; else winsL++

    // Game 2: at lower seed
    r = simulateDecisiveMatch(lower, higher, 0)
    games.push({ home: lower.name, away: higher.name, score: [r.g1, r.g2] })
    if (r.g1 > r.g2) winsL++; else winsH++

    // Game 3 if needed: at higher seed
    if (winsH < 2 && winsL < 2) {
      r = simulateDecisiveMatch(higher, lower, 0)
      games.push({ home: higher.name, away: lower.name, score: [r.g1, r.g2] })
      if (r.g1 > r.g2) winsH++; else winsL++
    }

    const winner = winsH >= 2 ? higher : lower
    qfWinners.push(winner)
    quarterFinals.push({
      higherSeed: higher.name,
      lowerSeed: lower.name,
      seedNums: [hi + 1, lo + 1],
      games,
      winner: winner.name,
      seriesScore: winsH >= 2 ? `${winsH}-${winsL}` : `${winsL}-${winsH}`
    })
  }

  // Semifinals: neutral site, single match
  // SF1: QF1 winner vs QF4 winner, SF2: QF2 winner vs QF3 winner
  const sfMatchups = [[0, 3], [1, 2]]
  const semiFinals = []
  const sfWinners = []

  for (const [a, b] of sfMatchups) {
    const t1 = qfWinners[a], t2 = qfWinners[b]
    const r = simulateDecisiveMatch(t1, t2, -1)
    const winner = r.g1 > r.g2 ? t1 : t2
    sfWinners.push(winner)
    semiFinals.push({
      team1: t1.name, team2: t2.name,
      score: [r.g1, r.g2],
      winner: winner.name,
      venue: 'neutral'
    })
  }

  // Final: neutral site
  const ft1 = sfWinners[0], ft2 = sfWinners[1]
  const fr = simulateDecisiveMatch(ft1, ft2, -1)
  const champion = fr.g1 > fr.g2 ? ft1 : ft2
  const captainName = pickCaptain(champion)

  const final = {
    team1: ft1.name, team2: ft2.name,
    score: [fr.g1, fr.g2],
    winner: champion.name,
    captain: captainName,
    venue: 'neutral'
  }

  // --- Player stats ---
  const maxApp = 11 + 7  // regular (11) + max playoff (7: 3+1+1 + possible subs) — simplified to ~14
  const playerSeasonStats = []
  for (const team of teams) {
    const ts = sMap[team.name]
    // Check if team made playoffs and how far
    let playoffApps = 0
    const inPlayoffs = standings.slice(0, 8).some(s => s.team === team.name)
    if (inPlayoffs) {
      const qf = quarterFinals.find(q => q.higherSeed === team.name || q.lowerSeed === team.name)
      if (qf) {
        playoffApps += qf.games.length
        if (qf.winner === team.name) {
          const sf = semiFinals.find(s => s.team1 === team.name || s.team2 === team.name)
          if (sf) {
            playoffApps += 1
            if (sf.winner === team.name) playoffApps += 1  // final
          }
        }
      }
    }
    const totalTeamMatches = ts.played + playoffApps
    const totalGf = ts.gf + playoffApps * 3  // rough estimate for playoff goals

    for (const player of team.players) {
      const isStarter = team.players.indexOf(player) < 6
      const regApp = isStarter ? rand(8, 11) : rand(1, 7)
      const pApp = isStarter ? playoffApps : Math.min(playoffApps, rand(0, playoffApps))
      const appearances = regApp + pApp

      const stats = generatePlayerSeasonStats(player, appearances, totalGf, maxApp)
      playerSeasonStats.push({
        team: team.name,
        name: player.name,
        position: player.position,
        rating: player.rating,
        ...stats
      })
    }
  }

  // Coach records
  const coachSeasonStats = teams.map(t => {
    const s = sMap[t.name]
    return {
      team: t.name,
      coach: t.coach ? t.coach.name : 'Unknown',
      style: t.coach ? t.coach.style : 'balanced',
      rating: t.coach ? t.coach.rating : '50',
      played: s.played, won: s.won, drawn: s.drawn, lost: s.lost, points: s.points
    }
  })

  // ---------------------------------------------------------------------------
  // Awards calculation
  // ---------------------------------------------------------------------------
  const playoffTeamNames = new Set(standings.slice(0, 8).map(s => s.team))

  // Player grade: composite score based on goals, assists, rating, appearances
  function playerGrade(ps) {
    const rating = parseInt(ps.rating, 10)
    const goalWeight = ps.position === 'GK' ? 5 : (ps.position === 'ST' ? 1.2 : 2)
    const saveWeight = ps.position === 'GK' ? 0.15 : 0
    const assistWeight = 1.5
    const passAccuracy = ps.passes.total > 0 ? ps.passes.on / ps.passes.total : 0.5
    const tackleAccuracy = ps.tackles.total > 0 ? ps.tackles.on / ps.tackles.total : 0.5

    return (rating * 0.3) +
           (ps.goals * goalWeight) +
           (ps.assists * assistWeight) +
           ((ps.saves || 0) * saveWeight) +
           (passAccuracy * 10) +
           (tackleAccuracy * 8) +
           (ps.appearances * 0.5)
  }

  // MVP: highest grade from a playoff team (all positions)
  const playoffPlayerStats = playerSeasonStats.filter(
    p => playoffTeamNames.has(p.team) && p.appearances >= 5
  )
  const mvpCandidates = [...playoffPlayerStats].sort((a, b) => playerGrade(b) - playerGrade(a))
  const mvp = mvpCandidates[0] || null

  // LFA Promise: best under-23 player
  // Player age at this season: currentAge - (CURRENT_SEASON - seasonNum)
  const ageDelta = CURRENT_SEASON - seasonNum
  const promiseCandidates = playerSeasonStats.filter(p => {
    const team = teams.find(t => t.name === p.team)
    const pl = team ? team.players.find(pp => pp.name === p.name) : null
    if (!pl || !pl.age) return false
    const ageAtSeason = pl.age - ageDelta
    return ageAtSeason <= 22 && ageAtSeason >= 16 && p.appearances >= 3
  }).sort((a, b) => playerGrade(b) - playerGrade(a))
  const promise = promiseCandidates[0] || null

  // Goalkeeper of the Season: formula with team wins, saves, rating
  const gkStats = playerSeasonStats.filter(p => p.position === 'GK' && p.appearances >= 5)
  const gkCandidates = gkStats.map(gk => {
    const team = teams.find(t => t.name === gk.team)
    const ts = sMap[gk.team]
    const rating = parseInt(gk.rating, 10)
    const score = (ts.won * 3) + ((gk.saves || 0) * 0.2) + (rating * 0.4)
    return { ...gk, gkScore: score }
  }).sort((a, b) => b.gkScore - a.gkScore)
  const gkOfSeason = gkCandidates[0] || null

  // Field Player of the Year: only awarded if MVP is a GK
  let fieldPlayerOfYear = null
  if (mvp && mvp.position === 'GK') {
    const fieldCandidates = playoffPlayerStats
      .filter(p => p.position !== 'GK')
      .sort((a, b) => playerGrade(b) - playerGrade(a))
    fieldPlayerOfYear = fieldCandidates[0] || null
  }

  // Coach of the Year: biggest overperformance OR coach of #1 team
  const coachCandidates = coachSeasonStats.map(cs => {
    const team = teams.find(t => t.name === cs.team)
    const teamRating = parseInt(team.rating, 10)
    // Expected position based on rating (lower rating = expected to be worse)
    const ratingRank = [...teams].sort((a, b) =>
      parseInt(b.rating, 10) - parseInt(a.rating, 10)
    ).findIndex(t => t.name === cs.team) + 1
    const actualRank = standings.findIndex(s => s.team === cs.team) + 1
    // Overperformance = expected rank - actual rank (positive = better than expected)
    const overperf = ratingRank - actualRank
    const score = overperf * 3 + cs.points + (actualRank === 1 ? 10 : 0)
    return { ...cs, coachScore: score }
  }).sort((a, b) => b.coachScore - a.coachScore)
  const coachOfYear = coachCandidates[0] || null

  // Fichichi: top scorer, assists as tiebreaker
  const fichichiCandidates = [...playerSeasonStats]
    .sort((a, b) => b.goals !== a.goals ? b.goals - a.goals : b.assists - a.assists)
  const fichichi = fichichiCandidates[0] || null

  // Assist King: most assists per match (minimum 5 appearances)
  const assistCandidates = playerSeasonStats
    .filter(p => p.appearances >= 5)
    .map(p => ({ ...p, assistsPerMatch: p.assists / p.appearances }))
    .sort((a, b) => b.assistsPerMatch - a.assistsPerMatch)
  const assistKing = assistCandidates[0] || null

  const awards = {
    mvp: mvp ? { name: mvp.name, team: mvp.team, position: mvp.position, grade: Math.round(playerGrade(mvp) * 10) / 10 } : null,
    lfaPromise: promise ? { name: promise.name, team: promise.team, position: promise.position, age: (teams.find(t => t.name === promise.team).players.find(p => p.name === promise.name).age || 0) - ageDelta } : null,
    goalkeeperOfSeason: gkOfSeason ? { name: gkOfSeason.name, team: gkOfSeason.team, saves: gkOfSeason.saves || 0 } : null,
    fieldPlayerOfYear: fieldPlayerOfYear ? { name: fieldPlayerOfYear.name, team: fieldPlayerOfYear.team, position: fieldPlayerOfYear.position } : null,
    coachOfYear: coachOfYear ? { name: coachOfYear.coach, team: coachOfYear.team, style: coachOfYear.style } : null,
    fichichi: fichichi ? { name: fichichi.name, team: fichichi.team, goals: fichichi.goals, assists: fichichi.assists } : null,
    assistKing: assistKing ? { name: assistKing.name, team: assistKing.team, assists: assistKing.assists, perMatch: Math.round(assistKing.assistsPerMatch * 100) / 100 } : null
  }

  return {
    number: seasonNum,
    champion: champion.name,
    guyKilneTrophy: { captain: captainName, team: champion.name },
    standings,
    matchResults,
    playoffs: { quarterFinals, semiFinals, final },
    playerSeasonStats,
    coachSeasonStats,
    awards
  }
}

// ---------------------------------------------------------------------------
// Generate all seasons
// ---------------------------------------------------------------------------
console.log(`Generating ${NUM_SEASONS} seasons of historical data...`)

const seasons = []
let prevStandings = null

// Store original skills/ratings so we can adjust per-season and restore
const originalPlayerData = league.teams.map(t => t.players.map(p => ({
  skill: { ...p.skill },
  rating: p.rating
})))

for (let s = 1; s <= NUM_SEASONS; s++) {
  const ageDelta = CURRENT_SEASON - s

  // Adjust each player's skills to what they would have been at this season's age
  for (let ti = 0; ti < league.teams.length; ti++) {
    const team = league.teams[ti]
    for (let pi = 0; pi < team.players.length; pi++) {
      const player = team.players[pi]
      const ageAtSeason = player.age - ageDelta
      if (ageAtSeason >= 1) {
        player.skill = getSkillsAtAge({ ...player, skill: originalPlayerData[ti][pi].skill, age: player.age }, ageAtSeason)
        player.rating = String(getRatingAtAge({ ...player, skill: originalPlayerData[ti][pi].skill, rating: originalPlayerData[ti][pi].rating, age: player.age }, ageAtSeason))
      }
    }
  }

  const season = generateSeason(s, league.teams, prevStandings)
  seasons.push(season)
  prevStandings = season.standings
  process.stdout.write(`  Season ${s} `)

  // Restore original skills for next season's recalc
  for (let ti = 0; ti < league.teams.length; ti++) {
    for (let pi = 0; pi < league.teams[ti].players.length; pi++) {
      league.teams[ti].players[pi].skill = { ...originalPlayerData[ti][pi].skill }
      league.teams[ti].players[pi].rating = originalPlayerData[ti][pi].rating
    }
  }
}
console.log('')

// Empty current season
seasons.push({
  number: CURRENT_SEASON,
  champion: null,
  guyKilneTrophy: null,
  standings: league.teams.map(t => ({
    team: t.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
  })),
  matchResults: [],
  playoffs: null,
  playerSeasonStats: league.teams.flatMap(t =>
    t.players.map(p => ({
      team: t.name, name: p.name, position: p.position, rating: p.rating,
      appearances: 0, goals: 0, assists: 0,
      shots: { total: 0, on: 0, off: 0 },
      passes: { total: 0, on: 0, off: 0 },
      tackles: { total: 0, on: 0, off: 0, fouls: 0 },
      ...(p.position === 'GK' ? { saves: 0 } : {})
    }))
  ),
  coachSeasonStats: league.teams.map(t => ({
    team: t.name, coach: t.coach ? t.coach.name : 'Unknown',
    style: t.coach ? t.coach.style : 'balanced',
    rating: t.coach ? t.coach.rating : '50',
    played: 0, won: 0, drawn: 0, lost: 0, points: 0
  })),
  awards: null
})

const history = { currentSeason: CURRENT_SEASON, seasons }
const outPath = path.join(__dirname, 'data', 'history.json')
fs.writeFileSync(outPath, JSON.stringify(history, null, 2))

const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2)
console.log(`Written to ${outPath} (${sizeMB} MB)`)
console.log(`${seasons.length} seasons, ${seasons.length * 120} player-season records`)

console.log('\n' + CONFIG.trophy.name + ' Winners:')
for (const s of seasons) {
  if (s.guyKilneTrophy) {
    console.log(`  Season ${s.number}: ${s.guyKilneTrophy.captain} (${s.guyKilneTrophy.team})`)
  } else {
    console.log(`  Season ${s.number}: (in progress)`)
  }
}

console.log('\nSeason Awards:')
for (const s of seasons) {
  if (!s.awards) continue
  const a = s.awards
  console.log(`  Season ${s.number}:`)
  if (a.mvp) console.log(`    MVP: ${a.mvp.name} (${a.mvp.team}, ${a.mvp.position})`)
  if (a.lfaPromise) console.log(`    ${CONFIG.awards.lfaPromise}: ${a.lfaPromise.name} (${a.lfaPromise.team}, age ${a.lfaPromise.age})`)
  if (a.goalkeeperOfSeason) console.log(`    GK of Season: ${a.goalkeeperOfSeason.name} (${a.goalkeeperOfSeason.team}, ${a.goalkeeperOfSeason.saves} saves)`)
  if (a.fieldPlayerOfYear) console.log(`    Field Player: ${a.fieldPlayerOfYear.name} (${a.fieldPlayerOfYear.team})`)
  if (a.coachOfYear) console.log(`    Coach of Year: ${a.coachOfYear.name} (${a.coachOfYear.team})`)
  if (a.fichichi) console.log(`    ${CONFIG.awards.fichichi}: ${a.fichichi.name} (${a.fichichi.team}, ${a.fichichi.goals} goals)`)
  if (a.assistKing) console.log(`    ${CONFIG.awards.assistKing}: ${a.assistKing.name} (${a.assistKing.team}, ${a.assistKing.perMatch}/match)`)
}
