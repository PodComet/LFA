const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { developPlayer, playerPotential } = require('./player-development')
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))

const PORT = 3456
const siteDir = path.join(__dirname, 'site')
const dataDir = path.join(__dirname, 'data')

function readJSON(file) { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) }
function writeJSON(file, data) { fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2)) }

// ---------------------------------------------------------------------------
// Match simulation using the engine (quick version for API)
// ---------------------------------------------------------------------------
// Coach style modifiers for quick simulation
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
  const base = (cr - 55) / 400
  const mods = STYLE_MODIFIERS[coach.style] || { off: 0, def: 0 }
  return { off: mods.off * (0.5 + base * 5), def: mods.def * (0.5 + base * 5) }
}

function simulateMatchWithEngine(homeTeam, awayTeam) {
  const league = readJSON('league.json')
  const home = league.teams.find(t => t.name === homeTeam)
  const away = league.teams.find(t => t.name === awayTeam)
  if (!home || !away) return null

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

  // Race-to-5 simulation: alternate scoring chances until a team reaches 5
  // At 4-4 extended play: first to 6 wins, or 5-5 draw
  const r1 = parseInt(home.rating, 10), r2 = parseInt(away.rating, 10)
  const cb1 = coachBoosts(home.coach), cb2 = coachBoosts(away.coach)

  // Scoring probability per "round" based on rating advantage + coach boosts
  function scoreProb(teamRating, oppRating, homeBonus, offBoost, defPenalty) {
    const base = 0.42 + (teamRating - oppRating) / 250 + homeBonus / 10 + (offBoost || 0) / 5 - (defPenalty || 0) / 5
    return Math.max(0.15, Math.min(0.70, base))
  }

  const p1 = scoreProb(r1, r2, 0.3, cb1.off, cb2.def)
  const p2 = scoreProb(r2, r1, -0.15, cb2.off, cb1.def)

  // Valid scores: 5-0..5-3 (first-to-5), 6-4, 6-5 (extended after 4-4), 5-5 (draw)
  let g1 = 0, g2 = 0
  const MAX_ROUNDS = 50

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (Math.random() < p1) g1++
    if (Math.random() < p2) g2++

    const extended = (g1 >= 4 && g2 >= 4) // 4-4 triggers extended play

    if (!extended) {
      // Normal: first to 5 wins (opponent must be <=3)
      if (g1 >= 5 && g2 <= 3) break
      if (g2 >= 5 && g1 <= 3) break
    } else {
      // Extended: first to 6 wins, or 5-5 draw
      if (g1 === 5 && g2 === 5) break         // 5-5 draw
      if (g1 >= 6 && g1 > g2) break           // 6-4 or 6-5
      if (g2 >= 6 && g2 > g1) break           // 4-6 or 5-6
    }
  }

  // Safety: enforce valid final score
  if (g1 < 5 && g2 < 5) { if (g1 >= g2) g1 = 5; else g2 = 5 }
  if (g1 >= 4 && g2 >= 4) {
    // In extended play, cap at 6
    if (g1 > 6) g1 = 6; if (g2 > 6) g2 = 6
    // Can't have 5-4 or 4-5 — must be 5-5, 6-4, 6-5
    if ((g1 === 5 && g2 === 4) || (g1 === 4 && g2 === 5)) {
      if (g1 > g2) g1 = 6; else g2 = 6
    }
  }
  if (g1 > 6) g1 = 6; if (g2 > 6) g2 = 6

  // Generate goal events for a team
  function generateGoalEvents(team, goalsFor, oppTeam) {
    const players = team.players.slice(0, 6)
    const outfield = players.filter(p => p.position !== 'GK')
    const events = []

    // Penalty chance per goal: ~15%
    // Missed penalty chance: ~25% of penalty attempts
    const penaltyTakers = players.filter(p => parseInt(p.skill.penalty_taking || '50', 10) >= 40)
    const bestPenTaker = penaltyTakers.length > 0
      ? penaltyTakers.sort((a, b) => parseInt(b.skill.penalty_taking || '50', 10) - parseInt(a.skill.penalty_taking || '50', 10))[0]
      : outfield[0]

    // Generate missed penalties (0-1 per match, ~12% chance)
    const missedPenalties = Math.random() < 0.12 ? 1 : 0
    for (let i = 0; i < missedPenalties; i++) {
      events.push({ scorer: bestPenTaker.name, assister: null, penalty: true, missed: true })
    }

    for (let i = 0; i < goalsFor; i++) {
      const isPenalty = Math.random() < 0.15

      if (isPenalty) {
        events.push({ scorer: bestPenTaker.name, assister: null, penalty: true, missed: false })
      } else {
        // Pick scorer weighted by position
        const weights = outfield.map(p => {
          const r = parseInt(p.rating, 10)
          if (p.position === 'ST') return r * 3
          if (p.position === 'CM') return r * 1.5
          return r * 0.4
        })
        const totalW = weights.reduce((a, b) => a + b, 0)
        let roll = Math.random() * totalW
        let scorer = outfield[0]
        for (let j = 0; j < outfield.length; j++) {
          roll -= weights[j]
          if (roll <= 0) { scorer = outfield[j]; break }
        }

        // Pick assister (~70% of goals have an assist)
        let assister = null
        if (Math.random() < 0.70) {
          const eligible = players.filter(p => p.name !== scorer.name)
          const aWeights = eligible.map(p => {
            const r = parseInt(p.rating, 10)
            if (p.position === 'CM') return r * 2.5
            if (p.position === 'ST') return r * 1.5
            if (p.position === 'GK') return r * 0.1
            return r * 0.8
          })
          const aTotal = aWeights.reduce((a, b) => a + b, 0)
          let aRoll = Math.random() * aTotal
          for (let j = 0; j < eligible.length; j++) {
            aRoll -= aWeights[j]
            if (aRoll <= 0) { assister = eligible[j]; break }
          }
        }

        events.push({ scorer: scorer.name, assister: assister ? assister.name : null, penalty: false, missed: false })
      }
    }
    return events
  }

  // Generate player stats for each team
  function genPlayerStats(team, goalEvents, goalsFor, goalsAgainst) {
    const stats = []
    const players = team.players.slice(0, 6)

    // Tally goals/assists from events
    const goalCounts = {}, assistCounts = {}
    for (const ev of goalEvents) {
      if (!ev.missed) {
        goalCounts[ev.scorer] = (goalCounts[ev.scorer] || 0) + 1
        if (ev.assister) assistCounts[ev.assister] = (assistCounts[ev.assister] || 0) + 1
      }
    }

    for (const p of players) {
      const pos = p.position
      const goals = goalCounts[p.name] || 0
      const assists = assistCounts[p.name] || 0
      let saves = undefined

      if (pos === 'GK') {
        saves = Math.round(rand(2, 8) * (goalsAgainst > 3 ? 1.3 : 1))
      }

      const passTotal = rand(15, 45)
      const passOn = Math.round(passTotal * (rand(50, 85) / 100))
      const tackleTotal = pos === 'GK' ? rand(0, 2) : rand(3, 12)
      const tackleOn = Math.round(tackleTotal * (rand(40, 75) / 100))
      const shotTotal = pos === 'GK' ? rand(0, 1) : pos === 'ST' ? rand(3, 10) : rand(1, 6)
      const shotOn = Math.round(shotTotal * (rand(35, 75) / 100))

      // Grade: 1-5 stars based on performance
      let grade = 2.5
      grade += (goals * 0.8)
      grade += (assists * 0.4)
      if (saves !== undefined) grade += saves * 0.12
      grade += (parseInt(p.rating, 10) - 80) * 0.03
      const passAcc = passTotal > 0 ? passOn / passTotal : 0.5
      grade += (passAcc - 0.6) * 2
      if (goalsFor > goalsAgainst) grade += 0.3
      grade = Math.max(1, Math.min(5, Math.round(grade * 2) / 2))

      const stat = {
        name: p.name, position: pos, rating: p.rating,
        goals, assists,
        shots: { total: shotTotal, on: shotOn, off: shotTotal - shotOn },
        passes: { total: passTotal, on: passOn, off: passTotal - passOn },
        tackles: { total: tackleTotal, on: tackleOn, off: tackleTotal - tackleOn, fouls: rand(0, 2) },
        grade
      }
      if (saves !== undefined) stat.saves = saves
      stats.push(stat)
    }

    return stats
  }

  const homeGoalEvents = generateGoalEvents(home, g1, away)
  const awayGoalEvents = generateGoalEvents(away, g2, home)
  const homeStats = genPlayerStats(home, homeGoalEvents, g1, g2)
  const awayStats = genPlayerStats(away, awayGoalEvents, g2, g1)

  return {
    score: [g1, g2],
    homePlayerStats: homeStats,
    awayPlayerStats: awayStats,
    goalEvents: { home: homeGoalEvents, away: awayGoalEvents }
  }
}

// ---------------------------------------------------------------------------
// Update history.json after a match
// ---------------------------------------------------------------------------
function updateHistory(homeName, awayName, homeGoals, awayGoals, homePlayerStats, awayPlayerStats) {
  const history = readJSON('history.json')
  const current = history.seasons.find(s => s.number === history.currentSeason)
  if (!current) return

  // Update standings
  function updateStanding(team, gf, ga) {
    let s = current.standings.find(s => s.team === team)
    if (!s) { s = { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }; current.standings.push(s) }
    s.played++; s.gf += gf; s.ga += ga
    if (gf > ga) { s.won++; s.points += 3 } else if (gf === ga) { s.drawn++; s.points += 1 } else { s.lost++ }
  }
  updateStanding(homeName, homeGoals, awayGoals)
  updateStanding(awayName, awayGoals, homeGoals)
  current.standings.sort((a, b) => (b.points - a.points) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf))

  // Update match results
  if (!current.matchResults) current.matchResults = []
  current.matchResults.push({ home: homeName, away: awayName, score: [homeGoals, awayGoals] })

  // Update player season stats
  function updatePlayerSeasonStats(teamName, playerStats) {
    if (!playerStats) return
    for (const ps of playerStats) {
      let rec = current.playerSeasonStats.find(r => r.name === ps.name && r.team === teamName)
      if (!rec) {
        rec = { team: teamName, name: ps.name, position: ps.position, rating: ps.rating, appearances: 0, goals: 0, assists: 0, shots: { total: 0, on: 0, off: 0 }, passes: { total: 0, on: 0, off: 0 }, tackles: { total: 0, on: 0, off: 0, fouls: 0 } }
        if (ps.position === 'GK') rec.saves = 0
        current.playerSeasonStats.push(rec)
      }
      rec.appearances++
      rec.goals += ps.goals || 0
      rec.assists += ps.assists || 0
      if (ps.shots) { rec.shots.total += ps.shots.total; rec.shots.on += ps.shots.on; rec.shots.off += ps.shots.off }
      if (ps.passes) { rec.passes.total += ps.passes.total; rec.passes.on += ps.passes.on; rec.passes.off += ps.passes.off }
      if (ps.tackles) { rec.tackles.total += ps.tackles.total; rec.tackles.on += ps.tackles.on; rec.tackles.off += ps.tackles.off; rec.tackles.fouls += ps.tackles.fouls }
      if (rec.saves !== undefined && ps.saves !== undefined) rec.saves += ps.saves
    }
  }
  updatePlayerSeasonStats(homeName, homePlayerStats)
  updatePlayerSeasonStats(awayName, awayPlayerStats)

  // Update coach season stats
  function updateCoachSeason(teamName, gf, ga) {
    let cs = current.coachSeasonStats.find(c => c.team === teamName)
    if (cs) {
      cs.played++
      if (gf > ga) { cs.won++; cs.points += 3 } else if (gf === ga) { cs.drawn++; cs.points += 1 } else { cs.lost++ }
    }
  }
  updateCoachSeason(homeName, homeGoals, awayGoals)
  updateCoachSeason(awayName, awayGoals, homeGoals)

  writeJSON('history.json', history)
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
  })
}

function jsonRes(res, data, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
    res.end(); return
  }

  // --- API Routes ---
  if (pathname === '/api/schedule') {
    const schedPath = path.join(dataDir, 'schedule.json')
    if (!fs.existsSync(schedPath)) return jsonRes(res, { error: 'No schedule. Run: node schedule.js' }, 404)
    return jsonRes(res, readJSON('schedule.json'))
  }

  if (pathname === '/api/league') {
    return jsonRes(res, readJSON('league.json'))
  }

  if (pathname === '/api/history') {
    return jsonRes(res, readJSON('history.json'))
  }

  if (pathname.startsWith('/api/simulate/') && req.method === 'POST') {
    const parts = pathname.split('/')
    const mdNum = parseInt(parts[3], 10)
    const matchIdx = parseInt(parts[4], 10)

    const schedule = readJSON('schedule.json')
    const md = schedule.matchdays.find(m => m.number === mdNum)
    if (!md || matchIdx >= md.matches.length) return jsonRes(res, { error: 'Invalid matchday/match' }, 400)

    const match = md.matches[matchIdx]
    if (match.status === 'completed') return jsonRes(res, { error: 'Match already played' }, 400)

    const result = simulateMatchWithEngine(match.home, match.away)
    if (!result) return jsonRes(res, { error: 'Simulation failed' }, 500)

    match.status = 'completed'
    match.score = result.score
    match.method = 'simulated'
    match.playerStats = { home: result.homePlayerStats, away: result.awayPlayerStats }
    match.playerGrades = {
      home: result.homePlayerStats.map(p => ({ name: p.name, grade: p.grade })),
      away: result.awayPlayerStats.map(p => ({ name: p.name, grade: p.grade }))
    }
    match.goalEvents = result.goalEvents
    writeJSON('schedule.json', schedule)
    updateHistory(match.home, match.away, result.score[0], result.score[1], result.homePlayerStats, result.awayPlayerStats)

    return jsonRes(res, { success: true, match })
  }

  if (pathname.startsWith('/api/enter-score/') && req.method === 'POST') {
    const parts = pathname.split('/')
    const mdNum = parseInt(parts[3], 10)
    const matchIdx = parseInt(parts[4], 10)
    const body = await parseBody(req)

    if (!body.score || !Array.isArray(body.score)) return jsonRes(res, { error: 'Missing score array' }, 400)

    const schedule = readJSON('schedule.json')
    const md = schedule.matchdays.find(m => m.number === mdNum)
    if (!md || matchIdx >= md.matches.length) return jsonRes(res, { error: 'Invalid matchday/match' }, 400)

    const match = md.matches[matchIdx]
    if (match.status === 'completed') return jsonRes(res, { error: 'Match already played' }, 400)

    match.status = 'completed'
    match.score = [body.score[0], body.score[1]]
    match.method = 'manual'
    match.playerStats = null
    match.playerGrades = null
    writeJSON('schedule.json', schedule)
    updateHistory(match.home, match.away, body.score[0], body.score[1], null, null)

    return jsonRes(res, { success: true, match })
  }

  // --- Change coach style ---
  if (pathname.startsWith('/api/coach-style/') && req.method === 'POST') {
    const teamName = decodeURIComponent(pathname.split('/')[3])
    const body = await parseBody(req)
    const validStyles = ['attacking', 'defensive', 'balanced', 'possession', 'counter-attack']
    if (!body.style || !validStyles.includes(body.style)) return jsonRes(res, { error: 'Invalid style. Must be one of: ' + validStyles.join(', ') }, 400)

    const league = readJSON('league.json')
    const team = league.teams.find(t => t.name === teamName)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)

    team.coach.style = body.style
    writeJSON('league.json', league)
    return jsonRes(res, { success: true, team: team.name, coach: team.coach.name, style: body.style })
  }

  // --- End of season: apply player development ---
  if (pathname === '/api/develop-season' && req.method === 'POST') {
    const league = readJSON('league.json')
    const results = []

    for (const team of league.teams) {
      for (const player of team.players) {
        const result = developPlayer(player, player.age)
        result.team = team.name
        result.potential = playerPotential(player)
        results.push(result)
        player.age += 1
      }
      // Recalculate team rating from starters
      const starterRatings = team.players.slice(0, 6).map(p => parseInt(p.rating, 10))
      team.rating = String(Math.round(starterRatings.reduce((a, b) => a + b, 0) / starterRatings.length))
    }

    writeJSON('league.json', league)

    // Sort by rating delta for the summary
    const improvers = [...results].sort((a, b) => b.ratingDelta - a.ratingDelta).slice(0, 10)
    const decliners = [...results].sort((a, b) => a.ratingDelta - b.ratingDelta).slice(0, 10)

    return jsonRes(res, { success: true, results, improvers, decliners })
  }

  // --- Season Editor: get season data ---
  if (pathname.startsWith('/api/season-editor/') && req.method === 'GET') {
    const seasonNum = parseInt(pathname.split('/')[3], 10)
    const league = readJSON('league.json')
    const history = readJSON('history.json')
    const season = history.seasons.find(s => s.number === seasonNum)
    if (!season) return jsonRes(res, { error: 'Season not found' }, 404)
    // Return league teams data for the requested season
    return jsonRes(res, { season: seasonNum, teams: league.teams, currentSeason: history.currentSeason })
  }

  // --- Season Editor: save changes ---
  if (pathname === '/api/season-editor/save' && req.method === 'POST') {
    const body = await parseBody(req)
    if (!body.teams || !Array.isArray(body.teams)) return jsonRes(res, { error: 'Missing teams array' }, 400)

    const league = readJSON('league.json')
    // Update each team from submitted data
    for (const submitted of body.teams) {
      const existing = league.teams.find(t => t.name === submitted.originalName || t.name === submitted.name)
      if (!existing) continue

      existing.name = submitted.name
      existing.abbreviation = submitted.abbreviation || undefined
      existing.colors.primary = submitted.colors.primary
      existing.colors.secondary = submitted.colors.secondary
      existing.rating = submitted.rating

      if (submitted.coach) {
        existing.coach.name = submitted.coach.name
        existing.coach.rating = submitted.coach.rating
        existing.coach.style = submitted.coach.style
      }

      if (submitted.players && Array.isArray(submitted.players)) {
        for (let i = 0; i < submitted.players.length && i < existing.players.length; i++) {
          const sp = submitted.players[i]
          const ep = existing.players[i]
          if (sp.name) ep.name = sp.name
          if (sp.position) ep.position = sp.position
          if (sp.rating) ep.rating = sp.rating
          if (sp.age !== undefined) ep.age = parseInt(sp.age, 10)
        }
        // If new players were added beyond current roster
        for (let i = existing.players.length; i < submitted.players.length; i++) {
          existing.players.push(submitted.players[i])
        }
        // If players were removed (shorter array)
        if (submitted.players.length < existing.players.length) {
          existing.players.length = submitted.players.length
        }
      }

      // Recalculate team rating from starters
      const starterRatings = existing.players.slice(0, 6).map(p => parseInt(p.rating, 10))
      if (starterRatings.length > 0) {
        existing.rating = String(Math.round(starterRatings.reduce((a, b) => a + b, 0) / starterRatings.length))
      }
    }

    writeJSON('league.json', league)

    // Rebuild the site
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }

    return jsonRes(res, { success: true, teams: league.teams })
  }

  // --- Start New Season ---
  if (pathname === '/api/start-new-season' && req.method === 'POST') {
    const history = readJSON('history.json')
    const league = readJSON('league.json')
    const newSeasonNum = history.currentSeason + 1

    // Check if current season already exists as incomplete
    const currentSeason = history.seasons.find(s => s.number === history.currentSeason)

    // Create new season entry in history
    const newSeason = {
      number: newSeasonNum,
      champion: null,
      guyKilneTrophy: null,
      standings: league.teams.map(t => ({
        team: t.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
      })),
      matchResults: [],
      playerSeasonStats: [],
      coachSeasonStats: league.teams.map(t => ({
        team: t.name, coach: t.coach.name, style: t.coach.style, rating: t.coach.rating,
        played: 0, won: 0, drawn: 0, lost: 0, points: 0
      })),
      awards: null
    }
    history.seasons.push(newSeason)
    history.currentSeason = newSeasonNum
    writeJSON('history.json', history)

    // Generate schedule for new season
    const teams = league.teams.map(t => t.name)
    const matchdays = []
    const n = teams.length
    const rounds = n - 1
    const half = n / 2
    const roster = [...teams]
    const fixed = roster.shift()

    for (let r = 0; r < rounds; r++) {
      const md = { number: r + 1, matches: [] }
      for (let i = 0; i < half; i++) {
        const home = i === 0 ? fixed : roster[i - 1]
        const away = roster[roster.length - i - 1]
        // Alternate home/away each round
        if (r % 2 === 0) md.matches.push({ home, away, status: 'pending', score: null, method: null, playerStats: null, playerGrades: null, goalEvents: null })
        else md.matches.push({ home: away, away: home, status: 'pending', score: null, method: null, playerStats: null, playerGrades: null, goalEvents: null })
      }
      matchdays.push(md)
      // Rotate roster
      roster.push(roster.shift())
    }

    // Second half: reverse fixtures
    const firstHalf = matchdays.length
    for (let r = 0; r < firstHalf; r++) {
      const md = { number: firstHalf + r + 1, matches: [] }
      for (const m of matchdays[r].matches) {
        md.matches.push({ home: m.away, away: m.home, status: 'pending', score: null, method: null, playerStats: null, playerGrades: null, goalEvents: null })
      }
      matchdays.push(md)
    }

    writeJSON('schedule.json', { season: newSeasonNum, matchdays })

    // Rebuild site
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }

    return jsonRes(res, { success: true, season: newSeasonNum })
  }

  // --- Transfer player between teams ---
  if (pathname === '/api/transfer-player' && req.method === 'POST') {
    const body = await parseBody(req)
    const { playerName, fromTeam, toTeam } = body
    if (!playerName || !fromTeam || !toTeam) return jsonRes(res, { error: 'Missing playerName, fromTeam, or toTeam' }, 400)

    const league = readJSON('league.json')
    const src = league.teams.find(t => t.name === fromTeam)
    const dst = league.teams.find(t => t.name === toTeam)
    if (!src || !dst) return jsonRes(res, { error: 'Team not found' }, 404)

    const pIdx = src.players.findIndex(p => p.name === playerName)
    if (pIdx === -1) return jsonRes(res, { error: 'Player not found on source team' }, 404)

    const player = src.players.splice(pIdx, 1)[0]
    dst.players.push(player)

    // Recalculate ratings
    for (const t of [src, dst]) {
      const sr = t.players.slice(0, 6).map(p => parseInt(p.rating, 10))
      if (sr.length > 0) t.rating = String(Math.round(sr.reduce((a, b) => a + b, 0) / sr.length))
    }

    writeJSON('league.json', league)
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }

    return jsonRes(res, { success: true, player: playerName, from: fromTeam, to: toTeam })
  }

  // --- Static files ---
  let filePath = pathname === '/' ? '/index.html' : pathname
  filePath = path.join(siteDir, decodeURIComponent(filePath))
  if (!filePath.startsWith(siteDir)) { res.writeHead(403); res.end(); return }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    const ext = path.extname(filePath)
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }
    res.writeHead(200, { 'Content-Type': (types[ext] || 'text/html') + '; charset=utf-8' })
    res.end(data)
  })
}).listen(PORT, () => console.log(`${CONFIG.league.shortName} server: http://localhost:${PORT}`))
