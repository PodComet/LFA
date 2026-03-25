#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generate 15 seasons of plausible historical data for the LFA league.
// Run once: node generate-history.js
// Output: data/history.json
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')

const league = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'league.json'), 'utf8'))
const NUM_SEASONS = 15
const CURRENT_SEASON = 16

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickWeighted(teamRating, oppRating) {
  // Higher-rated team more likely to score more goals
  const diff = (teamRating - oppRating) / 10
  const base = 2.2 + diff * 0.3
  return Math.max(0, Math.round(base + (Math.random() - 0.5) * 3))
}

function simulateMatch(team1, team2) {
  const r1 = parseInt(team1.rating, 10)
  const r2 = parseInt(team2.rating, 10)

  let g1 = pickWeighted(r1, r2)
  let g2 = pickWeighted(r2, r1)

  // First-to-5 logic: cap at 5 unless both reach 4+
  if (g1 >= 5 && g2 < 4) { g1 = 5 }
  else if (g2 >= 5 && g1 < 4) { g2 = 5 }
  else if (g1 >= 4 && g2 >= 4) {
    // Extended play scenario
    if (g1 === g2 && g1 >= 5) { g1 = 5; g2 = 5 } // 5-5 draw
    else if (g1 > g2) { g1 = 6; g2 = rand(4, 5) }
    else if (g2 > g1) { g2 = 6; g1 = rand(4, 5) }
    else { // tied at 4
      const coin = rand(0, 2)
      if (coin === 0) { g1 = 5; g2 = 5 } // draw
      else if (coin === 1) { g1 = 6; g2 = 4 }
      else { g1 = 4; g2 = 6 }
    }
  }
  else if (g1 >= 5) g1 = 5
  else if (g2 >= 5) g2 = 5

  return { g1, g2 }
}

function generatePlayerSeasonStats(player, appearances, teamGoalsFor) {
  const pos = player.position
  const rating = parseInt(player.rating, 10)
  const factor = rating / 80

  let goals = 0, assists = 0, saves = undefined
  let shotsTotal = 0, shotsOn = 0, shotsOff = 0
  let passesTotal = 0, passesOn = 0, passesOff = 0
  let tacklesTotal = 0, tacklesOn = 0, tacklesOff = 0, tacklesFouls = 0

  if (pos === 'GK') {
    saves = Math.round(rand(40, 90) * factor * (appearances / 22))
    shotsTotal = rand(0, 3)
    goals = rand(0, 1) < 0.05 ? 1 : 0
    assists = rand(0, 2)
    passesTotal = Math.round(rand(80, 200) * (appearances / 22))
    tacklesTotal = rand(0, 5)
  } else if (pos === 'CB') {
    shotsTotal = Math.round(rand(5, 25) * factor * (appearances / 22))
    goals = Math.round(rand(0, 4) * factor * (appearances / 22))
    assists = Math.round(rand(0, 5) * factor * (appearances / 22))
    passesTotal = Math.round(rand(120, 300) * factor * (appearances / 22))
    tacklesTotal = Math.round(rand(30, 80) * factor * (appearances / 22))
  } else if (pos === 'CM') {
    shotsTotal = Math.round(rand(15, 60) * factor * (appearances / 22))
    goals = Math.round(rand(2, 15) * factor * (appearances / 22))
    assists = Math.round(rand(3, 15) * factor * (appearances / 22))
    passesTotal = Math.round(rand(200, 500) * factor * (appearances / 22))
    tacklesTotal = Math.round(rand(20, 60) * factor * (appearances / 22))
  } else if (pos === 'ST') {
    shotsTotal = Math.round(rand(30, 120) * factor * (appearances / 22))
    goals = Math.round(rand(5, 30) * factor * (appearances / 22))
    assists = Math.round(rand(2, 10) * factor * (appearances / 22))
    passesTotal = Math.round(rand(100, 300) * factor * (appearances / 22))
    tacklesTotal = Math.round(rand(5, 25) * factor * (appearances / 22))
  }

  // Cap goals to reasonable share of team goals
  goals = Math.min(goals, Math.round(teamGoalsFor * 0.4))

  shotsOn = Math.round(shotsTotal * (rand(40, 85) / 100))
  shotsOff = shotsTotal - shotsOn
  passesOn = Math.round(passesTotal * (rand(50, 85) / 100))
  passesOff = passesTotal - passesOn
  tacklesOn = Math.round(tacklesTotal * (rand(30, 70) / 100))
  tacklesOff = tacklesTotal - tacklesOn - Math.round(tacklesTotal * 0.1)
  tacklesFouls = Math.max(0, tacklesTotal - tacklesOn - tacklesOff)

  const stat = {
    appearances,
    goals,
    assists,
    shots: { total: shotsTotal, on: shotsOn, off: shotsOff },
    passes: { total: passesTotal, on: passesOn, off: passesOff },
    tackles: { total: tacklesTotal, on: tacklesOn, off: tacklesOff, fouls: tacklesFouls }
  }
  if (saves !== undefined) stat.saves = saves

  return stat
}

function generateSeason(seasonNum, teams) {
  // Each team plays every other team twice (home & away) = 22 matches
  const standings = teams.map(t => ({
    team: t.name,
    played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
  }))

  const standingsMap = {}
  standings.forEach(s => { standingsMap[s.team] = s })

  // Simulate all 132 matches
  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue
      const { g1, g2 } = simulateMatch(teams[i], teams[j])
      const s1 = standingsMap[teams[i].name]
      const s2 = standingsMap[teams[j].name]

      s1.played++; s2.played++
      s1.gf += g1; s1.ga += g2
      s2.gf += g2; s2.ga += g1

      if (g1 > g2) { s1.won++; s1.points += 3; s2.lost++ }
      else if (g2 > g1) { s2.won++; s2.points += 3; s1.lost++ }
      else { s1.drawn++; s1.points += 1; s2.drawn++; s2.points += 1 }
    }
  }

  // Sort standings by points, then goal difference, then goals for
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga
    if (gdB !== gdA) return gdB - gdA
    return b.gf - a.gf
  })

  // Generate player stats for the season
  const playerSeasonStats = []
  for (const team of teams) {
    const teamStanding = standingsMap[team.name]
    for (const player of team.players) {
      // Starters play most matches, subs play fewer
      const isStarter = team.players.indexOf(player) < 6
      const appearances = isStarter
        ? rand(17, 22)
        : rand(3, 14)

      const stats = generatePlayerSeasonStats(player, appearances, teamStanding.gf)
      playerSeasonStats.push({
        team: team.name,
        name: player.name,
        position: player.position,
        rating: player.rating,
        ...stats
      })
    }
  }

  // Coach records for this season
  const coachSeasonStats = teams.map(t => {
    const s = standingsMap[t.name]
    return {
      team: t.name,
      coach: t.coach ? t.coach.name : 'Unknown',
      style: t.coach ? t.coach.style : 'balanced',
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      points: s.points
    }
  })

  return {
    number: seasonNum,
    champion: standings[0].team,
    standings,
    playerSeasonStats,
    coachSeasonStats
  }
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
console.log(`Generating ${NUM_SEASONS} seasons of historical data...`)

const seasons = []
for (let s = 1; s <= NUM_SEASONS; s++) {
  seasons.push(generateSeason(s, league.teams))
  process.stdout.write(`  Season ${s} `)
}
console.log('')

// Add empty current season (16)
seasons.push({
  number: CURRENT_SEASON,
  champion: null,
  standings: league.teams.map(t => ({
    team: t.name,
    played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
  })),
  playerSeasonStats: league.teams.flatMap(t =>
    t.players.map(p => ({
      team: t.name,
      name: p.name,
      position: p.position,
      rating: p.rating,
      appearances: 0,
      goals: 0,
      assists: 0,
      shots: { total: 0, on: 0, off: 0 },
      passes: { total: 0, on: 0, off: 0 },
      tackles: { total: 0, on: 0, off: 0, fouls: 0 },
      ...(p.position === 'GK' ? { saves: 0 } : {})
    }))
  ),
  coachSeasonStats: league.teams.map(t => ({
    team: t.name,
    coach: t.coach ? t.coach.name : 'Unknown',
    style: t.coach ? t.coach.style : 'balanced',
    played: 0, won: 0, drawn: 0, lost: 0, points: 0
  }))
})

const history = {
  currentSeason: CURRENT_SEASON,
  seasons
}

const outPath = path.join(__dirname, 'data', 'history.json')
fs.writeFileSync(outPath, JSON.stringify(history, null, 2))

const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2)
console.log(`Written to ${outPath} (${sizeMB} MB)`)
console.log(`${seasons.length} seasons, ${seasons.length * 120} player-season records`)

// Print champions
console.log('\nChampions:')
for (const s of seasons) {
  if (s.champion) console.log(`  Season ${s.number}: ${s.champion}`)
  else console.log(`  Season ${s.number}: (in progress)`)
}
