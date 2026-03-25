#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generate matchday schedule for the current LFA season
// Circle method round-robin: 11 matchdays, 6 matches each
// Top 6 from previous season: 6 home / 5 away
// Bottom 6: 5 home / 6 away
// Run: node schedule.js
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')

const league = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'league.json'), 'utf8'))
const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'history.json'), 'utf8'))

const teams = league.teams.map(t => t.name)
const N = teams.length // 12

// Previous season standings for home/away allocation
const prevSeason = history.seasons.find(s => s.number === history.currentSeason - 1)
const topTeams = new Set()
if (prevSeason) {
  prevSeason.standings.slice(0, 6).forEach(s => topTeams.add(s.team))
} else {
  const sorted = [...league.teams].sort((a, b) => parseInt(b.rating, 10) - parseInt(a.rating, 10))
  sorted.slice(0, 6).forEach(t => topTeams.add(t.name))
}

// Circle method: fix team 0, rotate the rest
function generateRoundRobin(n) {
  const rounds = []
  // Rotating list of indices 1..n-1
  const rot = []
  for (let i = 1; i < n; i++) rot.push(i)

  for (let round = 0; round < n - 1; round++) {
    const matches = []
    // Fixed team vs top of rotation
    matches.push([0, rot[0]])
    // Pair from outer edges inward
    for (let i = 1; i < n / 2; i++) {
      matches.push([rot[i], rot[rot.length - i]])
    }
    rounds.push(matches)
    // Rotate right: last element goes to front
    rot.unshift(rot.pop())
  }
  return rounds
}

const indexRounds = generateRoundRobin(N)

// Verify: each pair appears exactly once
const pairSet = new Set()
let valid = true
for (const round of indexRounds) {
  for (const [a, b] of round) {
    const key = Math.min(a, b) + '-' + Math.max(a, b)
    if (pairSet.has(key)) { console.error('Duplicate pair:', teams[a], 'vs', teams[b]); valid = false }
    pairSet.add(key)
    if (a === b) { console.error('Self-match:', teams[a]); valid = false }
  }
}
const expected = N * (N - 1) / 2
if (pairSet.size !== expected) {
  console.error(`Expected ${expected} unique pairs, got ${pairSet.size}`)
  valid = false
}
if (!valid) { console.error('Schedule validation failed!'); process.exit(1) }

// Assign home/away
const homeCounts = {}
teams.forEach(t => { homeCounts[t] = 0 })

const matchdays = indexRounds.map((pairs, roundIdx) => {
  const matches = pairs.map(([ai, bi]) => {
    const t1 = teams[ai], t2 = teams[bi]
    const t1Top = topTeams.has(t1), t2Top = topTeams.has(t2)
    const t1Target = t1Top ? 6 : 5, t2Target = t2Top ? 6 : 5

    let home, away
    // Prefer giving home to the team further from target
    const t1Need = t1Target - homeCounts[t1]
    const t2Need = t2Target - homeCounts[t2]
    if (t1Need > t2Need) { home = t1; away = t2 }
    else if (t2Need > t1Need) { home = t2; away = t1 }
    else if (t1Top && !t2Top) { home = t1; away = t2 }
    else if (t2Top && !t1Top) { home = t2; away = t1 }
    else { home = roundIdx % 2 === 0 ? t1 : t2; away = home === t1 ? t2 : t1 }

    homeCounts[home]++
    return {
      home, away,
      status: 'pending',
      score: null,
      method: null,
      playerStats: null,
      playerGrades: null
    }
  })
  return { number: roundIdx + 1, matches }
})

// Second pass: fix any team that's over/under target by swapping
for (let pass = 0; pass < 5; pass++) {
  let swapped = false
  for (const md of matchdays) {
    for (const m of md.matches) {
      const hTarget = topTeams.has(m.home) ? 6 : 5
      const aTarget = topTeams.has(m.away) ? 6 : 5
      if (homeCounts[m.home] > hTarget && homeCounts[m.away] < aTarget) {
        homeCounts[m.home]--
        homeCounts[m.away]++
        const tmp = m.home; m.home = m.away; m.away = tmp
        swapped = true
      }
    }
  }
  if (!swapped) break
}

const schedule = {
  season: history.currentSeason,
  matchdays,
  playoffs: {
    status: 'pending',
    quarterFinals: null,
    semiFinals: null,
    final: null
  }
}

const outPath = path.join(__dirname, 'data', 'schedule.json')
fs.writeFileSync(outPath, JSON.stringify(schedule, null, 2))

console.log(`Schedule generated for Season ${schedule.season}`)
console.log(`${matchdays.length} matchdays, ${matchdays.reduce((n, md) => n + md.matches.length, 0)} matches`)
console.log('\nHome game counts:')
for (const [team, count] of Object.entries(homeCounts).sort((a, b) => b[1] - a[1])) {
  const target = topTeams.has(team) ? 6 : 5
  console.log(`  ${team.padEnd(22)} ${count}/${target} home${count === target ? ' OK' : ' (!)'}`)
}
console.log('\nMatchday 1:')
matchdays[0].matches.forEach(m => console.log(`  ${m.home} vs ${m.away}`))
