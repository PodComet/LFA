const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { developPlayer, playerPotential } = require('./player-development')

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
  function pickGoals(teamRating, oppRating, homeBonus, offBoost, defPenalty) {
    offBoost = offBoost || 0; defPenalty = defPenalty || 0
    const diff = (teamRating - oppRating) / 10
    const base = 2.0 + diff * 0.3 + homeBonus + offBoost - defPenalty
    return Math.max(0, Math.round(base + (Math.random() - 0.5) * 3))
  }

  const r1 = parseInt(home.rating, 10), r2 = parseInt(away.rating, 10)
  const cb1 = coachBoosts(home.coach), cb2 = coachBoosts(away.coach)
  let g1 = pickGoals(r1, r2, 0.3, cb1.off, cb2.def)
  let g2 = pickGoals(r2, r1, -0.15, cb2.off, cb1.def)

  // First-to-5 rules
  if (g1 >= 5 && g2 < 4) g1 = 5
  else if (g2 >= 5 && g1 < 4) g2 = 5
  else if (g1 >= 4 && g2 >= 4) {
    if (g1 === g2 && g1 >= 5) { g1 = 5; g2 = 5 }
    else if (g1 > g2) { g1 = 6; g2 = rand(4, 5) }
    else if (g2 > g1) { g2 = 6; g1 = rand(4, 5) }
    else { const c = rand(0, 2); if (c === 0) { g1 = 5; g2 = 5 } else if (c === 1) { g1 = 6; g2 = 4 } else { g1 = 4; g2 = 6 } }
  }
  else if (g1 >= 5) g1 = 5
  else if (g2 >= 5) g2 = 5

  // Generate player stats for each player
  function genPlayerStats(team, goalsFor, goalsAgainst, isHome) {
    const stats = []
    const goalPool = goalsFor
    let goalsLeft = goalPool
    const players = team.players.slice(0, 6) // starters only

    for (const p of players) {
      const rating = parseInt(p.rating, 10)
      const factor = rating / 85
      let goals = 0, assists = 0, saves = undefined
      const pos = p.position

      if (pos === 'GK') {
        saves = Math.round(rand(2, 8) * (goalsAgainst > 3 ? 1.3 : 1))
        goals = 0
        assists = Math.random() < 0.1 ? 1 : 0
      } else if (pos === 'ST') {
        goals = goalsLeft > 0 ? Math.min(rand(0, Math.ceil(goalPool * 0.5)), goalsLeft) : 0
        goalsLeft -= goals
        assists = rand(0, 2)
      } else if (pos === 'CM') {
        goals = goalsLeft > 0 ? Math.min(rand(0, Math.ceil(goalPool * 0.3)), goalsLeft) : 0
        goalsLeft -= goals
        assists = rand(0, 3)
      } else {
        goals = goalsLeft > 0 && Math.random() < 0.15 ? 1 : 0
        goalsLeft -= goals
        assists = rand(0, 2)
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
      grade += (rating - 80) * 0.03
      const passAcc = passTotal > 0 ? passOn / passTotal : 0.5
      grade += (passAcc - 0.6) * 2
      if (goalsFor > goalsAgainst) grade += 0.3  // winning bonus
      grade = Math.max(1, Math.min(5, Math.round(grade * 2) / 2)) // round to .5

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

    // Redistribute remaining goals to ensure total matches
    if (goalsLeft > 0) {
      const scorers = stats.filter(s => s.position !== 'GK')
      for (let i = 0; i < goalsLeft; i++) {
        const s = scorers[rand(0, scorers.length - 1)]
        s.goals++
        s.grade = Math.min(5, s.grade + 0.5)
      }
    }

    return stats
  }

  const homeStats = genPlayerStats(home, g1, g2, true)
  const awayStats = genPlayerStats(away, g2, g1, false)

  return {
    score: [g1, g2],
    homePlayerStats: homeStats,
    awayPlayerStats: awayStats
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
}).listen(PORT, () => console.log(`LFA server: http://localhost:${PORT}`))
