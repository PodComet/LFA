const dns = require('dns')
dns.setDefaultResultOrder('ipv4first')  // Force IPv4 — IPv6 connections to Anthropic API fail on this network

const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { developPlayer, playerPotential } = require('./player-development')
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))

// Load .env file for API keys
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  envFile.split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  })
} catch (e) { /* no .env file */ }

// Anthropic AI for match reports
let Anthropic = null
try {
  Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
} catch (e) { /* SDK not installed — AI reports unavailable */ }

const PORT = 3456
const siteDir = path.join(__dirname, 'site')
const dataDir = path.join(__dirname, 'data')

function readJSON(file) { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) }
function writeJSON(file, data) { fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2)) }

// Reusable helper: recalculate a team's overall rating from its first 6 players (starters)
function recalcTeamRating(team) {
  const sr = team.players.slice(0, 6).map(p => parseInt(p.rating, 10))
  if (sr.length > 0) team.rating = String(Math.round(sr.reduce((a, b) => a + b, 0) / sr.length))
}

// Reusable helper: build standings table from schedule matchdays
function buildStandingsFromSchedule(schedule) {
  const schedTeams = new Set()
  for (const md of schedule.matchdays) { for (const m of md.matches) { schedTeams.add(m.home); schedTeams.add(m.away) } }
  const tbl = {}
  for (const name of schedTeams) tbl[name] = { team: name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
  for (const md of schedule.matchdays) {
    for (const m of md.matches) {
      if (m.status !== 'completed') continue
      const hh = tbl[m.home], aa = tbl[m.away]
      if (!hh || !aa) continue
      hh.p++; aa.p++
      hh.gf += m.score[0]; hh.ga += m.score[1]
      aa.gf += m.score[1]; aa.ga += m.score[0]
      if (m.score[0] > m.score[1]) { hh.w++; hh.pts += 3; aa.l++ }
      else if (m.score[1] > m.score[0]) { aa.w++; aa.pts += 3; hh.l++ }
      else { hh.d++; aa.d++; hh.pts++; aa.pts++ }
    }
  }
  return Object.values(tbl).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)
}

// Reusable helper: generate round-robin schedule with balanced home/away
function generateRoundRobin(teams, topHalf) {
  const n = teams.length
  const rounds = n - 1
  const half = n / 2
  const roster = [...teams]
  const fixed = roster.shift()
  const homeCount = {}
  teams.forEach(t => homeCount[t] = 0)
  const maxHome = Math.ceil((n - 1) / 2)
  const minHome = Math.floor((n - 1) / 2)
  const targetHome = {}
  teams.forEach(t => targetHome[t] = (topHalf && topHalf.has(t)) ? maxHome : (topHalf ? minHome : maxHome))

  const allPairings = []
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = i === 0 ? fixed : roster[i - 1]
      const b = roster[roster.length - i - 1]
      allPairings.push({ a, b, md: r })
    }
    roster.push(roster.shift())
  }

  const matchdays = Array.from({ length: rounds }, (_, i) => ({ number: i + 1, matches: [] }))
  for (const pair of allPairings) {
    let home, away
    const aHome = homeCount[pair.a], bHome = homeCount[pair.b]
    const aTarget = targetHome[pair.a], bTarget = targetHome[pair.b]
    if (aHome < aTarget && bHome >= bTarget) { home = pair.a; away = pair.b }
    else if (bHome < bTarget && aHome >= aTarget) { home = pair.b; away = pair.a }
    else if (aHome <= bHome) { home = pair.a; away = pair.b }
    else { home = pair.b; away = pair.a }
    homeCount[home]++
    matchdays[pair.md].matches.push({ home, away, status: 'pending', score: null, method: null, playerStats: null, playerGrades: null, goalEvents: null })
  }
  return matchdays
}

// Reusable helper: find Man of the Matchday across completed matches
function findMOTM(matches) {
  let motm = { name: 'Unknown', team: 'Unknown', grade: 0, goals: 0, assists: 0, saves: 0 }
  matches.forEach(m => {
    if (!m.playerStats) return
    const all = [...(m.playerStats.home || []), ...(m.playerStats.away || [])]
    all.forEach(p => {
      const score = (p.grade || 0) * 2 + (p.goals || 0) * 3 + (p.assists || 0) * 2 + (p.saves || 0) * 0.5
      const best = motm.grade * 2 + motm.goals * 3 + motm.assists * 2 + motm.saves * 0.5
      if (score > best) {
        motm = { name: p.name, team: m.playerStats.home.find(x => x.name === p.name) ? m.home : m.away, grade: p.grade || 0, goals: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0 }
      }
    })
  })
  return motm
}

// Debounced site rebuild — avoids redundant rebuilds during rapid API calls
let _rebuildTimer = null
function rebuildSite() {
  if (_rebuildTimer) clearTimeout(_rebuildTimer)
  _rebuildTimer = setTimeout(() => {
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }
    _rebuildTimer = null
  }, 300)
}
// Immediate rebuild (for endpoints where the user expects instant feedback)
function rebuildSiteNow() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }
}

// Cache Anthropic client at module level (API key doesn't change at runtime)
let _anthropicClient = null
function getAnthropicClient() {
  if (!Anthropic) throw new Error('Anthropic SDK not available')
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  if (!_anthropicClient) _anthropicClient = new Anthropic({ apiKey })
  return _anthropicClient
}

// ---------------------------------------------------------------------------
// Animated SVG match illustration generator
// ---------------------------------------------------------------------------
// Formation: GK - CB - 2CM - 2ST (6v6)
// Home attacks right, Away attacks left
const HOME_POS = [
  { x: 70, y: 200, role: 'GK' },
  { x: 150, y: 200, role: 'CB' },
  { x: 230, y: 155, role: 'CM' },
  { x: 230, y: 245, role: 'CM' },
  { x: 310, y: 155, role: 'ST' },
  { x: 310, y: 245, role: 'ST' }
]
const AWAY_POS = [
  { x: 530, y: 200, role: 'GK' },
  { x: 450, y: 200, role: 'CB' },
  { x: 370, y: 155, role: 'CM' },
  { x: 370, y: 245, role: 'CM' },
  { x: 290, y: 155, role: 'ST' },
  { x: 290, y: 245, role: 'ST' }
]

// Random goal scenario templates — each has 4+ passes before the shot
// 7 keyframe positions: 4 passes between outfield players, then shot in flight, then goal
// defShifts animates the defending GK diving the WRONG way (dy only, dx=0 so mirroring is irrelevant)
const GOAL_SCENES = [
  // Build-up: CB→CM1→ST1→CM2→ST2→shoot→GOAL  (GK dives up, ball goes low)
  { name: 'build-up',
    ball:  '150;230;310;230;310;440;560', ballY: '200;155;160;245;240;225;220',
    scorer: 5, assister: 3,
    shifts: {
      2:{dx:[0,10,30,40,50,55,55], dy:[0,0,5,10,15,15,15]},
      3:{dx:[0,10,20,20,30,35,35], dy:[0,0,-10,-10,-15,-15,-15]},
      4:{dx:[0,10,30,50,70,90,95], dy:[0,5,10,20,30,40,42]},
      5:{dx:[0,0,10,20,50,80,100], dy:[0,-5,-10,-20,-35,-25,-20]}
    },
    defShifts: {0:{dx:[0,0,0,0,0,0,0], dy:[0,0,0,0,0,-20,-48]}}
  },
  // Tiki-taka: GK→CB→CM2→CM1→ST1→shoot→GOAL  (GK dives down, ball goes high)
  { name: 'tiki-taka',
    ball:  '70;150;230;230;310;430;560', ballY: '200;200;245;155;155;178;180',
    scorer: 4, assister: 2,
    shifts: {
      1:{dx:[0,5,10,15,20,22,22], dy:[0,0,0,5,5,5,5]},
      2:{dx:[0,0,10,20,30,40,45], dy:[0,0,-10,-15,-10,-8,-5]},
      3:{dx:[0,0,5,10,15,18,18], dy:[0,0,-5,-10,-12,-12,-12]},
      4:{dx:[0,0,10,20,60,100,130], dy:[0,0,5,5,0,-15,-20]}
    },
    defShifts: {0:{dx:[0,0,0,0,0,0,0], dy:[0,0,0,0,0,22,50]}}
  },
  // Switch play: CB→CM1→CM2→ST2→ST1→shoot→GOAL  (GK dives down, ball goes up)
  { name: 'switch-play',
    ball:  '150;230;230;310;310;430;560', ballY: '200;155;245;240;155;168;170',
    scorer: 4, assister: 5,
    shifts: {
      2:{dx:[0,10,15,20,25,28,28], dy:[0,0,-5,-5,-8,-8,-8]},
      4:{dx:[0,0,10,20,50,85,115], dy:[0,0,5,10,5,-15,-30]},
      5:{dx:[0,0,10,20,40,50,55], dy:[0,-5,-10,-15,0,10,15]}
    },
    defShifts: {0:{dx:[0,0,0,0,0,0,0], dy:[0,0,0,0,0,20,45]}}
  },
  // Recycle: CM1→CB→CM2→ST2→CM1→shoot→GOAL  (GK dives up, ball centre)
  { name: 'recycle',
    ball:  '230;150;230;310;280;420;560', ballY: '155;200;245;240;165;195;200',
    scorer: 2, assister: 5,
    shifts: {
      2:{dx:[0,-30,-10,10,50,120,165], dy:[0,20,50,50,10,30,45]},
      3:{dx:[0,5,10,12,15,18,18], dy:[0,0,-5,-8,-10,-10,-10]},
      5:{dx:[0,0,10,20,30,35,40], dy:[0,5,-5,-10,-10,-12,-15]}
    },
    defShifts: {0:{dx:[0,0,0,0,0,0,0], dy:[0,0,0,0,0,-22,-46]}}
  },
  // Overload wing: CB→CM2→ST2→CM2→ST1→shoot→GOAL  (GK dives down, ball goes low-centre)
  { name: 'overload',
    ball:  '150;230;310;250;310;430;560', ballY: '200;245;240;230;155;195;210',
    scorer: 4, assister: 3,
    shifts: {
      3:{dx:[0,10,20,10,20,22,22], dy:[0,0,-5,0,-15,-15,-15]},
      4:{dx:[0,0,20,30,50,90,125], dy:[0,5,10,20,5,40,55]},
      5:{dx:[0,0,10,15,30,40,48], dy:[0,-5,-10,-20,-25,-28,-30]}
    },
    defShifts: {0:{dx:[0,0,0,0,0,0,0], dy:[0,0,0,0,0,18,42]}}
  },
  // Give-and-go: CM1→ST1→CM2→ST2→CM1→shoot→GOAL  (GK dives up, ball mid-low)
  { name: 'give-and-go',
    ball:  '230;310;230;310;280;420;560', ballY: '155;160;245;240;180;195;205',
    scorer: 2, assister: 5,
    shifts: {
      2:{dx:[0,20,10,30,50,130,180], dy:[0,5,30,40,25,35,45]},
      4:{dx:[0,10,20,25,28,30,30], dy:[0,5,10,15,15,15,15]},
      5:{dx:[0,0,10,20,30,35,40], dy:[0,-5,-10,-15,-15,-12,-10]}
    },
    defShifts: {0:{dx:[0,0,0,0,0,0,0], dy:[0,0,0,0,0,-18,-44]}}
  }
]

function generateMatchSVG(match, homeTeam, awayTeam) {
  const hc = homeTeam ? homeTeam.colors.primary : '#4488ff'
  const hc2 = homeTeam ? homeTeam.colors.secondary : '#ffffff'
  const ac = awayTeam ? awayTeam.colors.primary : '#ff4444'
  const ac2 = awayTeam ? awayTeam.colors.secondary : '#ffffff'
  const s = match.score || [0, 0]
  const homeGoals = match.goalEvents ? match.goalEvents.home : []
  const awayGoals = match.goalEvents ? match.goalEvents.away : []
  const hName = match.home
  const aName = match.away
  const isDraw = s[0] === s[1]
  const isHighScoring = s[0] + s[1] >= 8
  const isShutout = s[0] === 0 || s[1] === 0
  const winner = s[0] > s[1] ? 'home' : s[1] > s[0] ? 'away' : null
  const scorerNames = [...homeGoals.map(g => g.scorer), ...awayGoals.map(g => g.scorer)].slice(0, 4)
  const uid = Math.random().toString(36).slice(2, 8)

  // Pick a random goal scene
  const scene = GOAL_SCENES[Math.floor(Math.random() * GOAL_SCENES.length)]
  // If away scored more, mirror the scene
  const attackHome = winner !== 'away'
  const dur = '8s'

  // Build player positions with goal animation shifts
  // Attacking team uses scene.shifts, defending team uses scene.defShifts (GK dive)
  function buildPlayers(positions, color, color2, isAttacking) {
    const activeShifts = isAttacking ? scene.shifts : (scene.defShifts || {})
    return positions.map((p, i) => {
      const shift = activeShifts[i]
      const r = p.role === 'GK' ? 10 : 8
      const gkExtra = p.role === 'GK' ? ` stroke-dasharray="2,2"` : ''
      if (shift) {
        const dxs = shift.dx, dys = shift.dy
        const cxVals = dxs.map(d => p.x + (attackHome ? d : -d)).join(';')
        const cyVals = dys.map(d => p.y + d).join(';')
        return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="${color2}" stroke-width="1.5"${gkExtra}>
          <animate attributeName="cx" values="${cxVals}" dur="${dur}" repeatCount="indefinite"/>
          <animate attributeName="cy" values="${cyVals}" dur="${dur}" repeatCount="indefinite"/>
        </circle>`
      }
      // Idle sway
      const sx = Math.floor(Math.random() * 6) - 3
      const sy = Math.floor(Math.random() * 6) - 3
      return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="${color2}" stroke-width="1.5"${gkExtra}>
        <animate attributeName="cx" values="${p.x};${p.x + sx};${p.x}" dur="${2 + Math.random()}s" repeatCount="indefinite"/>
        <animate attributeName="cy" values="${p.y};${p.y + sy};${p.y}" dur="${2.5 + Math.random()}s" repeatCount="indefinite"/>
      </circle>`
    }).join('\n  ')
  }

  // Ball path
  const ballXraw = scene.ball.split(';').map(Number)
  const ballYraw = scene.ballY.split(';').map(Number)
  const ballX = attackHome ? ballXraw : ballXraw.map(x => 600 - x)
  const ballY = ballYraw

  // Goal net flash position
  const goalX = attackHome ? 520 : 40
  const flashColor = attackHome ? hc : ac

  // Scorer name for the "GOAL!" text
  const goalScorer = attackHome
    ? (homeGoals.length ? homeGoals[Math.floor(Math.random() * homeGoals.length)].scorer : 'GOAL!')
    : (awayGoals.length ? awayGoals[Math.floor(Math.random() * awayGoals.length)].scorer : 'GOAL!')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340" style="width:100%;border-radius:12px;overflow:hidden">
  <defs>
    <linearGradient id="p${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a472a"/><stop offset="50%" stop-color="#2d6b3f"/><stop offset="100%" stop-color="#1a472a"/>
    </linearGradient>
    <linearGradient id="s${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1628"/><stop offset="100%" stop-color="#1a2d4a"/>
    </linearGradient>
    <filter id="g${uid}"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="bg${uid}"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>

  <rect width="600" height="340" fill="url(#s${uid})"/>

  <!-- Stadium lights -->
  <circle cx="80" cy="30" r="4" fill="#ffe066" opacity="0.9"><animate attributeName="opacity" values="0.9;0.6;0.9" dur="2s" repeatCount="indefinite"/></circle>
  <circle cx="520" cy="30" r="4" fill="#ffe066" opacity="0.9"><animate attributeName="opacity" values="0.6;0.9;0.6" dur="2s" repeatCount="indefinite"/></circle>
  <line x1="80" y1="34" x2="80" y2="100" stroke="#555" stroke-width="2"/>
  <line x1="520" y1="34" x2="520" y2="100" stroke="#555" stroke-width="2"/>

  <!-- Pitch -->
  <rect x="40" y="100" width="520" height="200" rx="4" fill="url(#p${uid})" stroke="#3a8a52" stroke-width="1.5"/>
  <line x1="300" y1="100" x2="300" y2="300" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
  <circle cx="300" cy="200" r="40" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  <circle cx="300" cy="200" r="3" fill="rgba(255,255,255,0.3)"/>
  <!-- Penalty areas -->
  <rect x="40" y="150" width="70" height="100" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  <rect x="490" y="150" width="70" height="100" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  <!-- Goal boxes -->
  <rect x="40" y="175" width="30" height="50" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <rect x="530" y="175" width="30" height="50" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>

  <!-- Home players (GK-CB-2CM-2ST) -->
  ${buildPlayers(HOME_POS, hc, hc2, attackHome)}

  <!-- Away players (GK-CB-2CM-2ST) -->
  ${buildPlayers(AWAY_POS, ac, ac2, !attackHome)}

  <!-- Ball with goal animation -->
  <circle r="5" fill="white" filter="url(#g${uid})">
    <animate attributeName="cx" values="${ballX.join(';')}" dur="${dur}" repeatCount="indefinite"/>
    <animate attributeName="cy" values="${ballY.join(';')}" dur="${dur}" repeatCount="indefinite"/>
  </circle>

  <!-- Net ripple on goal -->
  <rect x="${goalX}" y="150" width="${attackHome ? 40 : 40}" height="100" rx="2" fill="${flashColor}" opacity="0">
    <animate attributeName="opacity" values="0;0;0;0;0;0.5;0.3" dur="${dur}" repeatCount="indefinite"/>
  </rect>

  <!-- GOAL! text flash -->
  <text x="300" y="88" text-anchor="middle" fill="${flashColor}" font-size="22" font-weight="900" font-family="system-ui" filter="url(#bg${uid})" opacity="0">
    \u26BD ${goalScorer.toUpperCase()}!
    <animate attributeName="opacity" values="0;0;0;0;0;1;0.8" dur="${dur}" repeatCount="indefinite"/>
  </text>

  <!-- Scoreboard -->
  <rect x="180" y="8" width="240" height="52" rx="8" fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <rect x="180" y="8" width="120" height="52" rx="8" fill="${hc}22"/>
  <rect x="300" y="8" width="120" height="52" rx="8" fill="${ac}22"/>
  <text x="240" y="30" text-anchor="middle" fill="${hc}" font-size="11" font-weight="700" font-family="system-ui">${hName.length > 14 ? hName.slice(0, 12) + '..' : hName}</text>
  <text x="360" y="30" text-anchor="middle" fill="${ac}" font-size="11" font-weight="700" font-family="system-ui">${aName.length > 14 ? aName.slice(0, 12) + '..' : aName}</text>
  <text x="300" y="52" text-anchor="middle" fill="white" font-size="22" font-weight="800" font-family="system-ui">${s[0]}  -  ${s[1]}</text>

  <!-- Ticker -->
  <rect x="40" y="310" width="520" height="24" rx="4" fill="rgba(0,0,0,0.7)"/>
  <text x="300" y="326" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="10" font-family="system-ui">${isHighScoring ? '\u26A1 GOAL FEST! ' : isShutout ? '\u{1F6E1} CLEAN SHEET! ' : isDraw ? '\u{1F91D} HONORS EVEN ' : ''}${scorerNames.length ? '\u26BD ' + scorerNames.join(' \u26BD ') : 'Full Time'}</text>

  <!-- Crowd -->
  ${Array.from({ length: 30 }, (_, i) => {
    const x = 50 + Math.floor(i * 17), y = 94 + Math.floor(Math.random() * 6)
    const c = i % 3 === 0 ? hc : i % 3 === 1 ? ac : '#888'
    return `<rect x="${x}" y="${y}" width="3" height="5" rx="1" fill="${c}" opacity="0.5"><animate attributeName="y" values="${y};${y - 3};${y}" dur="${1 + Math.random()}s" repeatCount="indefinite"/></rect>`
  }).join('')}
</svg>`
}

// Generate a ground-level action "photograph" SVG of a match moment
function generateMatchStill(match, homeTeam, awayTeam, momentType) {
  const hc = homeTeam ? homeTeam.colors.primary : '#4488ff'
  const hc2 = homeTeam ? homeTeam.colors.secondary : '#ffffff'
  const ac = awayTeam ? awayTeam.colors.primary : '#ff4444'
  const ac2 = awayTeam ? awayTeam.colors.secondary : '#ffffff'
  const s = match.score || [0, 0]
  const hName = match.home
  const aName = match.away
  const uid = Math.random().toString(36).slice(2, 8)
  const homeGoals = match.goalEvents ? match.goalEvents.home : []
  const awayGoals = match.goalEvents ? match.goalEvents.away : []
  const winner = s[0] > s[1] ? 'home' : s[1] > s[0] ? 'away' : null
  const types = ['shot', 'celebration', 'tackle', 'save', 'header', 'dribble']
  const type = momentType || types[Math.floor(Math.random() * types.length)]

  // Cinematic ground-level perspective constants
  const groundY = 240        // low camera: ground line pushed down
  const horizon = 95         // lower horizon = more sky/stadium visible
  const pitchH = 300 - horizon

  // ── Diverse appearance palettes ─────────────────────────────────────
  // Broad realistic skin-tone spectrum (pale → deep)
  const skins = [
    '#f6d9bd', '#ecc6a4', '#e4b088', '#d9a377', '#cc9064',
    '#b97b4e', '#a4683d', '#8a5230', '#6e3e22', '#553018',
    '#3d2210', '#f4c7a0', '#d4a373', '#c68642', '#8d5524'
  ]
  // Hair colors: black/brown spectrum plus blondes, reds, greys
  const hairColors = [
    '#0a0605', '#14090a', '#1a0e05', '#2b1b0f', '#3d2410',
    '#4a2d17', '#6b3e1a', '#8b5a2b', '#a67342', '#c79b52',
    '#d4a574', '#e8c67a', '#f0d89c', '#9c3424', '#b84040',
    '#4a4a4a', '#6c6c6c', '#9a9a9a', '#d4d4d4'
  ]
  // Hairstyles (bald is weighted 2x by appearing twice)
  const hairStyles = ['buzz', 'short', 'fade', 'medium', 'long', 'ponytail', 'curly', 'afro', 'bald', 'bald', 'bun', 'locks']
  // Build multipliers (thickness of body and limbs)
  const builds = [0.82, 0.88, 0.94, 1.0, 1.0, 1.06, 1.12, 1.2]
  // Face-shape subtle variants
  const faceShapes = ['oval', 'oval', 'round', 'square', 'long']

  // Roll a full appearance (per figure, per scene)
  function rAppearance() {
    return {
      skin: skins[Math.floor(Math.random() * skins.length)],
      hair: hairColors[Math.floor(Math.random() * hairColors.length)],
      style: hairStyles[Math.floor(Math.random() * hairStyles.length)],
      build: builds[Math.floor(Math.random() * builds.length)],
      beard: Math.random() < 0.22,
      stubble: Math.random() < 0.18,
      face: faceShapes[Math.floor(Math.random() * faceShapes.length)],
      heightMod: 0.91 + Math.random() * 0.18,  // ±9% height variance
      eyeColor: ['#2a1808', '#3d2410', '#5b3a1a', '#2a5a8a', '#3a7050', '#555'][Math.floor(Math.random() * 6)]
    }
  }

  // Render a head with facial features + hair + optional beard/stubble
  // cx/cy = head center, r = head radius, app = appearance object, tilt = optional rotation
  function renderHead(cx, cy, r, app, tilt) {
    const skin = app.skin
    const hair = app.hair
    const style = app.style || 'short'
    const face = app.face || 'oval'
    const eye = app.eyeColor || '#2a1808'

    // Face geometry varies with shape
    let rx = r, ry = r
    if (face === 'long') { ry = r * 1.12; rx = r * 0.92 }
    else if (face === 'round') { rx = r * 1.05; ry = r * 0.98 }
    else if (face === 'square') { rx = r * 1.0; ry = r * 1.02 }

    let svg = ''
    const wrap = s => tilt ? `<g transform="rotate(${tilt} ${cx} ${cy})">${s}</g>` : s

    // Head base
    svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}"/>`
    // Subtle side shading (light from top-left)
    svg += `<ellipse cx="${cx + rx * 0.35}" cy="${cy + ry * 0.1}" rx="${rx * 0.55}" ry="${ry * 0.75}" fill="rgba(0,0,0,0.12)"/>`
    svg += `<ellipse cx="${cx - rx * 0.35}" cy="${cy - ry * 0.35}" rx="${rx * 0.4}" ry="${ry * 0.3}" fill="rgba(255,255,255,0.08)"/>`
    // Neck shading at bottom
    svg += `<ellipse cx="${cx}" cy="${cy + ry * 0.95}" rx="${rx * 0.55}" ry="${ry * 0.18}" fill="rgba(0,0,0,0.18)"/>`

    // Eyebrows (small darker hair strokes)
    if (r >= 4.5) {
      svg += `<rect x="${cx - rx * 0.6}" y="${cy - ry * 0.05}" width="${rx * 0.35}" height="${Math.max(1, r * 0.1)}" fill="${hair}" rx="0.5" opacity="0.9"/>`
      svg += `<rect x="${cx + rx * 0.25}" y="${cy - ry * 0.05}" width="${rx * 0.35}" height="${Math.max(1, r * 0.1)}" fill="${hair}" rx="0.5" opacity="0.9"/>`
    }

    // Eyes (only if head big enough to draw)
    if (r >= 4) {
      svg += `<circle cx="${cx - rx * 0.38}" cy="${cy + ry * 0.08}" r="${Math.max(0.7, r * 0.11)}" fill="${eye}"/>`
      svg += `<circle cx="${cx + rx * 0.38}" cy="${cy + ry * 0.08}" r="${Math.max(0.7, r * 0.11)}" fill="${eye}"/>`
      // Eye highlights (tiny white dot)
      if (r >= 5) {
        svg += `<circle cx="${cx - rx * 0.38 + 0.6}" cy="${cy + ry * 0.08 - 0.4}" r="${r * 0.04}" fill="rgba(255,255,255,0.8)"/>`
        svg += `<circle cx="${cx + rx * 0.38 + 0.6}" cy="${cy + ry * 0.08 - 0.4}" r="${r * 0.04}" fill="rgba(255,255,255,0.8)"/>`
      }
    }

    // Nose hint
    if (r >= 5) {
      svg += `<path d="M${cx - rx * 0.08} ${cy + ry * 0.2} Q${cx} ${cy + ry * 0.45} ${cx + rx * 0.08} ${cy + ry * 0.35}" stroke="rgba(0,0,0,0.25)" stroke-width="${r * 0.06}" fill="none" stroke-linecap="round"/>`
    }

    // Mouth
    if (r >= 4.5) {
      svg += `<path d="M${cx - rx * 0.22} ${cy + ry * 0.55} Q${cx} ${cy + ry * 0.62} ${cx + rx * 0.22} ${cy + ry * 0.55}" stroke="rgba(70,25,25,0.55)" stroke-width="${Math.max(0.6, r * 0.07)}" fill="none" stroke-linecap="round"/>`
    }

    // Ears (small, subtle)
    if (r >= 5 && style !== 'long' && style !== 'bun' && style !== 'curly' && style !== 'afro') {
      svg += `<ellipse cx="${cx - rx * 1.0}" cy="${cy + ry * 0.15}" rx="${rx * 0.12}" ry="${ry * 0.22}" fill="${skin}"/>`
      svg += `<ellipse cx="${cx + rx * 1.0}" cy="${cy + ry * 0.15}" rx="${rx * 0.12}" ry="${ry * 0.22}" fill="${skin}"/>`
      svg += `<ellipse cx="${cx - rx * 1.0}" cy="${cy + ry * 0.2}" rx="${rx * 0.06}" ry="${ry * 0.1}" fill="rgba(0,0,0,0.2)"/>`
      svg += `<ellipse cx="${cx + rx * 1.0}" cy="${cy + ry * 0.2}" rx="${rx * 0.06}" ry="${ry * 0.1}" fill="rgba(0,0,0,0.2)"/>`
    }

    // Stubble / beard
    if (app.beard) {
      svg += `<path d="M ${cx - rx * 0.78} ${cy + ry * 0.3} Q ${cx - rx * 0.55} ${cy + ry * 1.05} ${cx} ${cy + ry * 1.1} Q ${cx + rx * 0.55} ${cy + ry * 1.05} ${cx + rx * 0.78} ${cy + ry * 0.3} Q ${cx + rx * 0.45} ${cy + ry * 0.55} ${cx} ${cy + ry * 0.6} Q ${cx - rx * 0.45} ${cy + ry * 0.55} ${cx - rx * 0.78} ${cy + ry * 0.3} Z" fill="${hair}" opacity="0.88"/>`
      // Moustache
      svg += `<path d="M ${cx - rx * 0.3} ${cy + ry * 0.48} Q ${cx} ${cy + ry * 0.55} ${cx + rx * 0.3} ${cy + ry * 0.48}" stroke="${hair}" stroke-width="${Math.max(1, r * 0.14)}" fill="none" stroke-linecap="round" opacity="0.9"/>`
    } else if (app.stubble && r >= 4.5) {
      svg += `<ellipse cx="${cx}" cy="${cy + ry * 0.65}" rx="${rx * 0.7}" ry="${ry * 0.28}" fill="${hair}" opacity="0.22"/>`
    }

    // Hair — style-dependent
    if (style === 'bald') {
      // No hair — slight scalp highlight
      svg += `<ellipse cx="${cx}" cy="${cy - ry * 0.45}" rx="${rx * 0.45}" ry="${ry * 0.15}" fill="rgba(255,255,255,0.12)"/>`
    } else if (style === 'buzz') {
      svg += `<path d="M ${cx - rx * 0.95} ${cy - ry * 0.1} Q ${cx} ${cy - ry * 1.0} ${cx + rx * 0.95} ${cy - ry * 0.1} L ${cx + rx * 0.85} ${cy - ry * 0.25} Q ${cx} ${cy - ry * 0.55} ${cx - rx * 0.85} ${cy - ry * 0.25} Z" fill="${hair}" opacity="0.82"/>`
    } else if (style === 'fade') {
      svg += `<path d="M ${cx - rx * 0.95} ${cy - ry * 0.15} Q ${cx} ${cy - ry * 1.1} ${cx + rx * 0.95} ${cy - ry * 0.15} L ${cx + rx * 0.9} ${cy - ry * 0.3} Q ${cx} ${cy - ry * 0.6} ${cx - rx * 0.9} ${cy - ry * 0.3} Z" fill="${hair}"/>`
      // Tapered sides (fade)
      svg += `<path d="M ${cx - rx * 0.95} ${cy - ry * 0.15} L ${cx - rx * 0.85} ${cy + ry * 0.15}" stroke="${hair}" stroke-width="${r * 0.2}" opacity="0.3"/>`
      svg += `<path d="M ${cx + rx * 0.95} ${cy - ry * 0.15} L ${cx + rx * 0.85} ${cy + ry * 0.15}" stroke="${hair}" stroke-width="${r * 0.2}" opacity="0.3"/>`
    } else if (style === 'short') {
      svg += `<path d="M ${cx - rx * 1.02} ${cy - ry * 0.05} Q ${cx} ${cy - ry * 1.15} ${cx + rx * 1.02} ${cy - ry * 0.05} L ${cx + rx * 0.88} ${cy - ry * 0.35} Q ${cx} ${cy - ry * 0.55} ${cx - rx * 0.88} ${cy - ry * 0.35} Z" fill="${hair}"/>`
    } else if (style === 'medium') {
      svg += `<path d="M ${cx - rx * 1.1} ${cy + ry * 0.15} Q ${cx - rx * 1.2} ${cy - ry * 0.8} ${cx} ${cy - ry * 1.15} Q ${cx + rx * 1.2} ${cy - ry * 0.8} ${cx + rx * 1.1} ${cy + ry * 0.15} L ${cx + rx * 0.85} ${cy - ry * 0.15} Q ${cx} ${cy - ry * 0.4} ${cx - rx * 0.85} ${cy - ry * 0.15} Z" fill="${hair}"/>`
    } else if (style === 'long') {
      svg += `<path d="M ${cx - rx * 1.15} ${cy - ry * 0.3} Q ${cx - rx * 1.3} ${cy + ry * 0.9} ${cx - rx * 0.8} ${cy + ry * 1.1} L ${cx - rx * 0.55} ${cy - ry * 0.2} L ${cx + rx * 0.55} ${cy - ry * 0.2} L ${cx + rx * 0.8} ${cy + ry * 1.1} Q ${cx + rx * 1.3} ${cy + ry * 0.9} ${cx + rx * 1.15} ${cy - ry * 0.3} Q ${cx} ${cy - ry * 1.2} ${cx - rx * 1.15} ${cy - ry * 0.3} Z" fill="${hair}"/>`
    } else if (style === 'ponytail') {
      svg += `<path d="M ${cx - rx * 1.0} ${cy - ry * 0.1} Q ${cx} ${cy - ry * 1.1} ${cx + rx * 1.0} ${cy - ry * 0.1} L ${cx + rx * 0.88} ${cy - ry * 0.35} Q ${cx} ${cy - ry * 0.55} ${cx - rx * 0.88} ${cy - ry * 0.35} Z" fill="${hair}"/>`
      // Ponytail hanging at back-right
      svg += `<ellipse cx="${cx + rx * 0.95}" cy="${cy + ry * 0.35}" rx="${rx * 0.28}" ry="${ry * 0.55}" fill="${hair}"/>`
    } else if (style === 'bun') {
      svg += `<path d="M ${cx - rx * 1.0} ${cy - ry * 0.1} Q ${cx} ${cy - ry * 1.0} ${cx + rx * 1.0} ${cy - ry * 0.1} L ${cx + rx * 0.88} ${cy - ry * 0.3} Q ${cx} ${cy - ry * 0.5} ${cx - rx * 0.88} ${cy - ry * 0.3} Z" fill="${hair}"/>`
      // Bun on top
      svg += `<circle cx="${cx}" cy="${cy - ry * 1.25}" r="${rx * 0.45}" fill="${hair}"/>`
      svg += `<circle cx="${cx - rx * 0.12}" cy="${cy - ry * 1.35}" r="${rx * 0.08}" fill="rgba(255,255,255,0.15)"/>`
    } else if (style === 'curly') {
      // Cluster of circles for textured hair
      svg += `<circle cx="${cx}" cy="${cy - ry * 0.65}" r="${rx * 0.7}" fill="${hair}"/>`
      svg += `<circle cx="${cx - rx * 0.7}" cy="${cy - ry * 0.35}" r="${rx * 0.35}" fill="${hair}"/>`
      svg += `<circle cx="${cx + rx * 0.7}" cy="${cy - ry * 0.35}" r="${rx * 0.35}" fill="${hair}"/>`
      svg += `<circle cx="${cx - rx * 0.4}" cy="${cy - ry * 0.85}" r="${rx * 0.3}" fill="${hair}"/>`
      svg += `<circle cx="${cx + rx * 0.4}" cy="${cy - ry * 0.85}" r="${rx * 0.3}" fill="${hair}"/>`
    } else if (style === 'afro') {
      svg += `<circle cx="${cx}" cy="${cy - ry * 0.45}" r="${rx * 1.15}" fill="${hair}"/>`
      svg += `<circle cx="${cx - rx * 0.75}" cy="${cy - ry * 0.15}" r="${rx * 0.55}" fill="${hair}"/>`
      svg += `<circle cx="${cx + rx * 0.75}" cy="${cy - ry * 0.15}" r="${rx * 0.55}" fill="${hair}"/>`
      svg += `<circle cx="${cx}" cy="${cy - ry * 1.1}" r="${rx * 0.65}" fill="${hair}"/>`
      // Subtle texture highlights
      svg += `<circle cx="${cx - rx * 0.3}" cy="${cy - ry * 0.8}" r="${rx * 0.18}" fill="rgba(255,255,255,0.06)"/>`
    } else if (style === 'locks') {
      // Dreadlocks / braids
      svg += `<path d="M ${cx - rx * 1.0} ${cy - ry * 0.1} Q ${cx} ${cy - ry * 1.1} ${cx + rx * 1.0} ${cy - ry * 0.1} L ${cx + rx * 0.88} ${cy - ry * 0.35} Q ${cx} ${cy - ry * 0.55} ${cx - rx * 0.88} ${cy - ry * 0.35} Z" fill="${hair}"/>`
      // Individual locks hanging
      for (let li = -2; li <= 2; li++) {
        const lx = cx + li * rx * 0.4
        svg += `<rect x="${lx - rx * 0.12}" y="${cy - ry * 0.3}" width="${rx * 0.24}" height="${ry * 1.3}" rx="${rx * 0.12}" fill="${hair}" opacity="0.9"/>`
      }
    }

    return wrap(svg)
  }

  // Shadow helper (softer, elongated by depth)
  function groundShadow(cx, cy, h, depth) {
    // depth 0..1 — 0 = far, 1 = near. Shadows stretch more near the camera.
    const rx = h * (0.26 + depth * 0.06)
    const ry = h * (0.045 + depth * 0.015)
    const op = 0.28 + depth * 0.12
    return `<ellipse cx="${cx}" cy="${cy + 2}" rx="${rx}" ry="${ry}" fill="rgba(0,0,0,${op.toFixed(2)})"/>`
  }

  // Helper: draw a human figure — cinematic proportions with shadows and detail
  function person(x, gy, h, jersey, shorts, app, pose) {
    // Apply per-player height variance (diversity)
    h = h * (app && app.heightMod ? app.heightMod : 1)
    const build = app && app.build ? app.build : 1.0
    const headR = h * 0.085
    const torsoH = h * 0.34
    const legH = h * 0.40
    const armH = h * 0.28
    const headY = gy - h + headR
    const shoulderY = headY + headR * 2 + 1
    const hipY = shoulderY + torsoH
    const footY = gy
    const w = h * 0.2 * build  // shoulder width scales with build
    const sw = w * 0.65  // stroke width for limbs

    let arms = '', legs = '', torso = '', head = '', shadow = ''

    // Ground shadow — depth proxy: figures with larger h (closer) get denser shadows
    const depth = Math.min(1, h / 110)
    shadow = groundShadow(x, footY, h, depth)

    // Head with full facial detail + hair (default upright pose)
    head = renderHead(x, headY, headR, app)

    // Torso — jersey with collar detail and highlight
    torso = `<rect x="${x - w}" y="${shoulderY}" width="${w * 2}" height="${torsoH}" rx="3" fill="${jersey}"/>`
    torso += `<rect x="${x - w}" y="${shoulderY}" width="${w * 2}" height="${torsoH * 0.15}" rx="2" fill="rgba(255,255,255,0.12)"/>`
    torso += `<rect x="${x - w * 0.5}" y="${shoulderY}" width="${w}" height="2" rx="1" fill="${shorts}" opacity="0.5"/>`
    // Jersey number
    torso += `<text x="${x}" y="${shoulderY + torsoH * 0.55}" text-anchor="middle" font-size="${h * 0.1}" font-weight="900" font-family="system-ui" fill="${shorts}" opacity="0.4">${Math.floor(Math.random() * 20 + 1)}</text>`

    // Shorts
    torso += `<rect x="${x - w * 0.95}" y="${hipY - 1}" width="${w * 1.9}" height="${torsoH * 0.3}" rx="2" fill="${shorts}"/>`

    // Socks (mid-leg colored strip)
    const sockTop = hipY + legH * 0.55
    const sockBot = footY - headR * 0.5

    const skin = app.skin  // for limb fills
    if (pose === 'running') {
      legs = `<line x1="${x - 3}" y1="${hipY}" x2="${x - w - 5}" y2="${footY}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x - w - 5}" y1="${sockTop}" x2="${x - w - 5}" y2="${sockBot}" stroke="${jersey}" stroke-width="${sw + 1}" stroke-linecap="round" opacity="0.7"/>
              <line x1="${x + 3}" y1="${hipY}" x2="${x + w + 8}" y2="${footY - legH * 0.35}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <ellipse cx="${x - w - 5}" cy="${footY}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>
              <ellipse cx="${x + w + 8}" cy="${footY - legH * 0.35}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 3}" x2="${x - w - 12}" y2="${shoulderY + armH}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 3}" x2="${x + w + 10}" y2="${shoulderY + armH * 0.5}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    } else if (pose === 'kicking') {
      legs = `<line x1="${x - 2}" y1="${hipY}" x2="${x - w - 3}" y2="${footY}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x - w - 3}" y1="${sockTop}" x2="${x - w - 3}" y2="${sockBot}" stroke="${jersey}" stroke-width="${sw + 1}" stroke-linecap="round" opacity="0.7"/>
              <line x1="${x + 2}" y1="${hipY}" x2="${x + w + 20}" y2="${footY - legH * 0.65}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <ellipse cx="${x - w - 3}" cy="${footY}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>
              <ellipse cx="${x + w + 20}" cy="${footY - legH * 0.65}" rx="${headR * 0.8}" ry="${headR * 0.45}" fill="#111"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 3}" x2="${x - w - 16}" y2="${shoulderY + armH * 0.4}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 3}" x2="${x + w + 8}" y2="${shoulderY + armH * 0.75}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    } else if (pose === 'celebrating') {
      legs = `<line x1="${x - 4}" y1="${hipY}" x2="${x - 7}" y2="${footY}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x + 4}" y1="${hipY}" x2="${x + 7}" y2="${footY}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <ellipse cx="${x - 7}" cy="${footY}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>
              <ellipse cx="${x + 7}" cy="${footY}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 2}" x2="${x - w - 12}" y2="${shoulderY - armH * 0.8}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 2}" x2="${x + w + 12}" y2="${shoulderY - armH * 0.8}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    } else if (pose === 'diving') {
      const dy = gy - h * 0.38
      shadow = `<ellipse cx="${x}" cy="${gy + 2}" rx="${h * 0.42}" ry="${h * 0.045}" fill="rgba(0,0,0,${(0.28 + depth * 0.1).toFixed(2)})"/>`
      // Diving head (offset left, tilted)
      head = renderHead(x - h * 0.38, dy - 2, headR, app, -20)
      torso = `<rect x="${x - h * 0.28}" y="${dy}" width="${torsoH + 8}" height="${w * 2}" rx="3" fill="${jersey}"/>`
      torso += `<rect x="${x - h * 0.28}" y="${dy}" width="${torsoH + 8}" height="${w * 2}" rx="3" fill="rgba(255,255,255,0.06)"/>`
      legs = `<line x1="${x + torsoH * 0.35}" y1="${dy + w}" x2="${x + torsoH * 0.35 + legH}" y2="${dy + w + 8}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x + torsoH * 0.35}" y1="${dy + w}" x2="${x + torsoH * 0.35 + legH}" y2="${dy + w - 10}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>`
      arms = `<line x1="${x - h * 0.28}" y1="${dy + w * 0.4}" x2="${x - h * 0.28 - armH - 4}" y2="${dy - 12}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <circle cx="${x - h * 0.28 - armH - 4}" cy="${dy - 14}" r="${headR * 0.55}" fill="#ff6"/>
              <line x1="${x - h * 0.28}" y1="${dy + w * 1.2}" x2="${x - h * 0.28 - armH}" y2="${dy + w + 4}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    } else if (pose === 'heading') {
      const jumpH = h * 0.18
      shadow = `<ellipse cx="${x}" cy="${footY + 2}" rx="${h * 0.2}" ry="${h * 0.035}" fill="rgba(0,0,0,0.2)"/>`
      legs = `<line x1="${x - 4}" y1="${hipY - jumpH}" x2="${x - 10}" y2="${footY - jumpH * 0.4}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x + 4}" y1="${hipY - jumpH}" x2="${x + 8}" y2="${footY - jumpH * 0.2}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <ellipse cx="${x - 10}" cy="${footY - jumpH * 0.4}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>
              <ellipse cx="${x + 8}" cy="${footY - jumpH * 0.2}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>`
      head = renderHead(x, headY - jumpH, headR, app, -5)
      torso = `<rect x="${x - w}" y="${shoulderY - jumpH}" width="${w * 2}" height="${torsoH}" rx="3" fill="${jersey}"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY - jumpH + 3}" x2="${x - w - 10}" y2="${shoulderY - jumpH + armH * 0.5}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY - jumpH + 3}" x2="${x + w + 10}" y2="${shoulderY - jumpH + armH * 0.5}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    } else if (pose === 'sliding') {
      // Sliding tackle: body low and horizontal
      const sy = gy - h * 0.18
      shadow = `<ellipse cx="${x + h * 0.15}" cy="${gy + 2}" rx="${h * 0.45}" ry="${h * 0.04}" fill="rgba(0,0,0,0.3)"/>`
      head = renderHead(x - h * 0.2, sy - headR, headR, app, -15)
      torso = `<rect x="${x - h * 0.15}" y="${sy}" width="${torsoH}" height="${w * 1.8}" rx="3" fill="${jersey}" transform="rotate(-15 ${x} ${sy})"/>`
      legs = `<line x1="${x + torsoH * 0.2}" y1="${sy + w}" x2="${x + torsoH * 0.2 + legH + 5}" y2="${sy + w + 2}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x + torsoH * 0.2}" y1="${sy + w * 0.5}" x2="${x + torsoH * 0.2 + legH}" y2="${sy - 4}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <ellipse cx="${x + torsoH * 0.2 + legH + 5}" cy="${sy + w + 2}" rx="${headR * 0.7}" ry="${headR * 0.35}" fill="#111"/>`
      arms = `<line x1="${x - h * 0.1}" y1="${sy + w * 0.3}" x2="${x - h * 0.1 - armH}" y2="${sy - 6}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    } else {
      // Standing/default
      legs = `<line x1="${x - 4}" y1="${hipY}" x2="${x - 6}" y2="${footY}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x - 6}" y1="${sockTop}" x2="${x - 6}" y2="${sockBot}" stroke="${jersey}" stroke-width="${sw + 1}" stroke-linecap="round" opacity="0.7"/>
              <line x1="${x + 4}" y1="${hipY}" x2="${x + 6}" y2="${footY}" stroke="${shorts}" stroke-width="${sw}" stroke-linecap="round"/>
              <line x1="${x + 6}" y1="${sockTop}" x2="${x + 6}" y2="${sockBot}" stroke="${jersey}" stroke-width="${sw + 1}" stroke-linecap="round" opacity="0.7"/>
              <ellipse cx="${x - 6}" cy="${footY}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>
              <ellipse cx="${x + 6}" cy="${footY}" rx="${headR * 0.7}" ry="${headR * 0.4}" fill="#111"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 3}" x2="${x - w - 7}" y2="${shoulderY + armH}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 3}" x2="${x + w + 7}" y2="${shoulderY + armH}" stroke="${skin}" stroke-width="${w * 0.45}" stroke-linecap="round"/>`
    }

    return `<g>${shadow}${legs}${torso}${arms}${head}</g>`
  }

  // Helper: goal posts + net (perspective, viewed from side)
  function goalPost(x, gy, facing) {
    // facing: 'right' = goal mouth faces right (away goal), 'left' = faces left (home goal)
    const postH = 72  // post height
    const crossW = facing === 'right' ? 55 : -55  // crossbar width
    const netD = facing === 'right' ? 30 : -30  // net depth
    const topY = gy - postH
    const pc = '#ddd'  // post color

    // Net mesh (subtle diagonal lines)
    let net = ''
    const meshSpacing = 6
    const netStartX = x + crossW
    const netEndX = x + crossW + netD
    for (let ny = topY; ny <= gy; ny += meshSpacing) {
      net += `<line x1="${x + crossW}" y1="${ny}" x2="${netEndX}" y2="${ny + 4}" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>`
    }
    for (let nx = 0; nx <= Math.abs(netD); nx += meshSpacing) {
      const nxp = facing === 'right' ? x + crossW + nx : x + crossW - nx
      net += `<line x1="${nxp}" y1="${topY}" x2="${nxp}" y2="${gy}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`
    }
    // Net back vertical
    net += `<line x1="${netEndX}" y1="${topY}" x2="${netEndX}" y2="${gy}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`
    // Net roof
    net += `<line x1="${x + crossW}" y1="${topY}" x2="${netEndX}" y2="${topY + 3}" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>`

    // Posts and crossbar (white with subtle shadow)
    const posts = `
      <line x1="${x}" y1="${topY}" x2="${x}" y2="${gy}" stroke="${pc}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${x + crossW}" y1="${topY}" x2="${x + crossW}" y2="${gy}" stroke="${pc}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${x}" y1="${topY}" x2="${x + crossW}" y2="${topY}" stroke="${pc}" stroke-width="3" stroke-linecap="round"/>
      <line x1="${x + 1}" y1="${topY + 1}" x2="${x + crossW + 1}" y2="${topY + 1}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
    `
    return `<g>${net}${posts}</g>`
  }

  // Helper: detailed ball with pentagon pattern
  function ball(cx, cy, r) {
    r = r || 6
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="#bbb" stroke-width="0.5"/>
      <path d="M${cx} ${cy - r * 0.55} l${r * 0.35} ${r * 0.25} l${r * 0.12} ${r * 0.4} l-${r * 0.35} ${r * 0.18} l-${r * 0.35} -${r * 0.18} l${r * 0.12} -${r * 0.4}z" fill="#222" opacity="0.2"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,200,0.12)"/>
      <circle cx="${cx - r * 0.25}" cy="${cy - r * 0.3}" r="${r * 0.2}" fill="rgba(255,255,255,0.3)"/>`
  }

  // Helper: referee figure (black kit, smaller)
  function referee(x, gy, h) {
    return person(x, gy, h, '#111', '#111', rAppearance(), 'running')
  }

  // Helper: player name label (floating above figure)
  function nameLabel(x, gy, h, text) {
    if (!text) return ''
    const labelY = gy - h - 10
    return `<rect x="${x - 30}" y="${labelY - 8}" width="60" height="12" rx="3" fill="rgba(0,0,0,0.55)"/>
      <text x="${x}" y="${labelY}" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui" fill="white" letter-spacing="0.3">${text.length > 12 ? text.slice(0, 11) + '.' : text}</text>`
  }

  // Helper: corner flag
  function cornerFlag(x, gy) {
    return `<line x1="${x}" y1="${gy}" x2="${x}" y2="${gy - 20}" stroke="#ddd" stroke-width="1.2" stroke-linecap="round"/>
      <polygon points="${x},${gy - 20} ${x + 7},${gy - 17} ${x},${gy - 14}" fill="#f44" opacity="0.7"/>`
  }

  // Pick a random goal scorer name for captions
  const allGoals = [...homeGoals, ...awayGoals]
  const randomScorer = allGoals.length ? allGoals[Math.floor(Math.random() * allGoals.length)] : null
  const scorerName = randomScorer ? randomScorer.scorer : null

  let figures = '', ballSvg = '', caption = '', extraElements = '', sceneElements = ''

  if (type === 'shot') {
    const sn = scorerName || 'Striker'
    caption = sn + ' unleashes a powerful shot'
    // Goal in background on the right
    sceneElements += goalPost(520, groundY, 'right')
    figures += person(200, groundY, 100, hc, hc2, rAppearance(), 'kicking')
    figures += nameLabel(200, groundY, 100, sn)
    figures += person(440, groundY - 15, 58, ac, ac2, rAppearance(), 'diving')   // GK diving
    figures += person(330, groundY - 5, 72, ac, ac2, rAppearance(), 'running')   // defender
    figures += person(120, groundY + 8, 50, hc, hc2, rAppearance(), 'running')   // support
    figures += referee(500, groundY + 6, 38)  // ref in background
    ballSvg = ball(270, groundY - 20, 6)
    // Motion blur trail
    extraElements = `<ellipse cx="248" cy="${groundY - 18}" rx="22" ry="3.5" fill="rgba(255,255,255,0.12)"/>
                     <ellipse cx="235" cy="${groundY - 17}" rx="12" ry="2" fill="rgba(255,255,255,0.07)"/>
                     <ellipse cx="225" cy="${groundY - 16}" rx="6" ry="1.5" fill="rgba(255,255,255,0.04)"/>`
  } else if (type === 'celebration') {
    const scorer = scorerName || 'Goal scorer'
    const cTeam = winner === 'home' || !winner ? hc : ac
    const cTeam2 = winner === 'home' || !winner ? hc2 : ac2
    caption = scorer + ' celebrates with teammates!'
    // Goal visible in background
    sceneElements += goalPost(540, groundY + 3, 'right')
    figures += person(280, groundY, 105, cTeam, cTeam2, rAppearance(), 'celebrating')
    figures += nameLabel(280, groundY, 105, scorer)
    figures += person(170, groundY + 5, 78, cTeam, cTeam2, rAppearance(), 'running')
    figures += person(410, groundY + 3, 72, cTeam, cTeam2, rAppearance(), 'celebrating')
    figures += person(80, groundY + 10, 48, cTeam, cTeam2, rAppearance(), 'celebrating')
    figures += person(520, groundY - 8, 40, ac, ac2, rAppearance(), 'standing')  // dejected opponent
    ballSvg = ball(555, groundY - 2, 5)  // ball in net
  } else if (type === 'tackle') {
    caption = 'Crunching challenge in the midfield'
    sceneElements += cornerFlag(575, groundY - 5)  // corner flag in distance
    figures += person(240, groundY, 95, hc, hc2, rAppearance(), 'running')
    figures += person(300, groundY, 90, ac, ac2, rAppearance(), 'sliding')
    figures += person(140, groundY + 8, 52, hc, hc2, rAppearance(), 'running')
    figures += person(450, groundY + 5, 48, ac, ac2, rAppearance(), 'standing')
    figures += referee(480, groundY + 2, 42)  // ref watching
    ballSvg = ball(270, groundY - 8, 6)
    // Grass spray particles and dirt
    extraElements = Array.from({ length: 18 }, () => {
      const gx = 275 + Math.random() * 60 - 15, gy2 = groundY - Math.random() * 30
      const sz = 0.8 + Math.random() * 1.8
      return `<circle cx="${gx}" cy="${gy2}" r="${sz}" fill="${Math.random() > 0.4 ? '#4a8' : '#6b5'}" opacity="${0.15 + Math.random() * 0.4}"/>`
    }).join('') + Array.from({ length: 8 }, () => {
      const dx = 280 + Math.random() * 50, dy2 = groundY - 2 - Math.random() * 12
      return `<rect x="${dx}" y="${dy2}" width="${1 + Math.random() * 3}" height="1" fill="${Math.random() > 0.5 ? '#5b5' : '#a87'}" opacity="0.3" transform="rotate(${Math.random() * 360} ${dx} ${dy2})"/>`
    }).join('')
  } else if (type === 'save') {
    caption = 'Spectacular diving save denies ' + (scorerName || 'the striker')
    // Goal behind the goalkeeper
    sceneElements += goalPost(340, groundY, 'right')
    figures += person(290, groundY, 95, ac, ac2, rAppearance(), 'diving')   // GK diving
    figures += nameLabel(290, groundY, 95, awayTeam && awayTeam.players ? awayTeam.players[0].name : 'GK')
    figures += person(160, groundY + 5, 80, hc, hc2, rAppearance(), 'kicking')
    figures += person(80, groundY + 10, 48, hc, hc2, rAppearance(), 'running')
    figures += person(450, groundY + 5, 40, ac, ac2, rAppearance(), 'standing')
    ballSvg = ball(230, groundY - 48, 6)
    // Ball trail + flash
    extraElements = `<ellipse cx="240" cy="${groundY - 46}" rx="14" ry="3.5" fill="rgba(255,255,100,0.1)"/>
                     <ellipse cx="210" cy="${groundY - 40}" rx="8" ry="2" fill="rgba(255,255,255,0.06)"/>`
  } else if (type === 'header') {
    const sn = scorerName || 'The attacker'
    caption = sn + ' rises highest to meet the cross'
    sceneElements += goalPost(530, groundY + 2, 'right')  // goal in distance
    figures += person(270, groundY, 100, hc, hc2, rAppearance(), 'heading')
    figures += nameLabel(270, groundY, 100, sn)
    figures += person(310, groundY, 92, ac, ac2, rAppearance(), 'heading')
    figures += person(160, groundY + 8, 52, hc, hc2, rAppearance(), 'standing')
    figures += person(450, groundY + 5, 44, ac, ac2, rAppearance(), 'running')
    figures += referee(110, groundY + 10, 36)
    ballSvg = ball(285, groundY - 100, 6)
  } else { // dribble
    const sn = scorerName || 'The midfielder'
    caption = sn + ' weaves past the defender'
    sceneElements += cornerFlag(18, groundY - 3)  // corner flag near camera
    figures += person(240, groundY, 98, hc, hc2, rAppearance(), 'running')
    figures += nameLabel(240, groundY, 98, sn)
    figures += person(320, groundY + 2, 82, ac, ac2, rAppearance(), 'running')
    figures += person(130, groundY + 8, 50, hc, hc2, rAppearance(), 'running')
    figures += person(460, groundY + 5, 42, ac, ac2, rAppearance(), 'standing')
    figures += person(400, groundY - 3, 50, ac, ac2, rAppearance(), 'running')
    ballSvg = ball(258, groundY - 5, 6)
    // Subtle speed lines near dribbler
    extraElements = `<line x1="210" y1="${groundY - 20}" x2="195" y2="${groundY - 18}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
                     <line x1="212" y1="${groundY - 10}" x2="198" y2="${groundY - 9}" stroke="rgba(255,255,255,0.06)" stroke-width="0.8"/>`
  }

  // ── Rich stadium crowd (multiple tiers, varied density) ──
  const crowdRows = []
  // Upper tier (distant, small, dense)
  for (let i = 0; i < 100; i++) {
    const cx = Math.random() * 600
    const cy = 28 + Math.random() * 22
    const c = Math.random() > 0.4 ? hc : Math.random() > 0.3 ? ac : ['#e55', '#55e', '#ee5', '#fff', '#f90', '#f5a', '#5df'][Math.floor(Math.random() * 7)]
    crowdRows.push(`<rect x="${cx}" y="${cy}" width="${2.5 + Math.random()}" height="${3 + Math.random()}" fill="${c}" opacity="${0.2 + Math.random() * 0.2}" rx="0.5"/>`)
  }
  // Lower tier (closer, bigger, more distinct)
  for (let i = 0; i < 80; i++) {
    const cx = Math.random() * 600
    const cy = 52 + Math.random() * 30
    const c = Math.random() > 0.4 ? hc : Math.random() > 0.3 ? ac : ['#e55', '#55e', '#ee5', '#fff', '#f90'][Math.floor(Math.random() * 5)]
    const sz = 3 + Math.random() * 2
    crowdRows.push(`<circle cx="${cx}" cy="${cy}" r="${sz}" fill="${c}" opacity="${0.25 + Math.random() * 0.3}"/>`)
    // Occasional arm/scarf raised
    if (Math.random() > 0.8) {
      crowdRows.push(`<line x1="${cx}" y1="${cy - sz}" x2="${cx + (Math.random() > 0.5 ? 2 : -2)}" y2="${cy - sz - 4}" stroke="${c}" stroke-width="1" opacity="0.3"/>`)
    }
  }
  // Front row (near pitch, largest)
  for (let i = 0; i < 50; i++) {
    const cx = Math.random() * 600
    const cy = 82 + Math.random() * 12
    const c = Math.random() > 0.4 ? hc : Math.random() > 0.3 ? ac : '#ddd'
    crowdRows.push(`<circle cx="${cx}" cy="${cy}" r="${3.5 + Math.random() * 2}" fill="${c}" opacity="${0.2 + Math.random() * 0.25}"/>`)
  }

  // ── Floodlight positions with dramatic beams ──
  const floodlights = [
    { x: 40, y: 4 }, { x: 180, y: 2 }, { x: 420, y: 2 }, { x: 560, y: 4 }
  ]
  const floodSvg = floodlights.map((fl, fi) => {
    const beamW = 50 + Math.random() * 30
    return `<rect x="${fl.x - 1.5}" y="${fl.y}" width="3" height="20" fill="#667" rx="1"/>
            <rect x="${fl.x - 4}" y="${fl.y}" width="8" height="4" fill="#889" rx="1"/>
            <circle cx="${fl.x}" cy="${fl.y}" r="3" fill="#ffe066"/>
            <circle cx="${fl.x}" cy="${fl.y}" r="6" fill="#ffe066" opacity="0.3"/>
            <circle cx="${fl.x}" cy="${fl.y}" r="12" fill="#ffe066" opacity="0.08"/>`
  }).join('')

  // ── Bokeh circles (out-of-focus light orbs) ──
  const bokeh = Array.from({ length: 18 }, () => {
    const bx = Math.random() * 600
    const by = Math.random() * 110
    const br = 3 + Math.random() * 10
    const bop = 0.03 + Math.random() * 0.06
    const bc = Math.random() > 0.5 ? '#ffe066' : Math.random() > 0.5 ? '#ffa040' : '#aaccff'
    return `<circle cx="${bx}" cy="${by}" r="${br}" fill="${bc}" opacity="${bop}"/>`
  }).join('')

  // ── Foreground grass blades (shallow depth of field) ──
  const fgGrass = Array.from({ length: 20 }, () => {
    const gx = Math.random() * 600
    const gy2 = 270 + Math.random() * 30
    const gh = 8 + Math.random() * 18
    const gw = 1 + Math.random() * 2
    const lean = -5 + Math.random() * 10
    return `<line x1="${gx}" y1="${gy2}" x2="${gx + lean}" y2="${gy2 - gh}" stroke="#2a7a3a" stroke-width="${gw}" stroke-linecap="round" opacity="${0.15 + Math.random() * 0.25}"/>`
  }).join('')

  // ── Atmospheric haze layer ──
  const hazeLayers = `
    <rect x="0" y="${horizon - 8}" width="600" height="20" fill="rgba(180,200,220,0.06)"/>
    <rect x="0" y="${horizon - 3}" width="600" height="10" fill="rgba(255,255,220,0.04)"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" style="width:100%;border-radius:8px;overflow:hidden">
  <defs>
    <!-- Dramatic dusk sky gradient -->
    <linearGradient id="sky${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0e1a"/>
      <stop offset="30%" stop-color="#14203a"/>
      <stop offset="65%" stop-color="#1e3050"/>
      <stop offset="85%" stop-color="#2a4060"/>
      <stop offset="100%" stop-color="#3a4a55"/>
    </linearGradient>
    <!-- Lush pitch with warm/cool variation -->
    <linearGradient id="grass${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1f6b35"/>
      <stop offset="40%" stop-color="#237a3c"/>
      <stop offset="100%" stop-color="#1a5a28"/>
    </linearGradient>
    <!-- Heavy cinematic vignette -->
    <radialGradient id="vig${uid}" cx="50%" cy="48%" r="52%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="65%" stop-color="rgba(0,0,0,0.15)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.7)"/>
    </radialGradient>
    <!-- Warm spotlight from floodlights -->
    <radialGradient id="warm${uid}" cx="50%" cy="20%" r="60%">
      <stop offset="0%" stop-color="rgba(255,230,150,0.1)"/>
      <stop offset="50%" stop-color="rgba(255,200,100,0.03)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <!-- Cool fill from sky -->
    <radialGradient id="cool${uid}" cx="50%" cy="90%" r="60%">
      <stop offset="0%" stop-color="rgba(100,150,220,0.05)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <!-- Stadium roof shadow -->
    <linearGradient id="roofShade${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.4)"/>
      <stop offset="100%" stop-color="transparent"/>
    </linearGradient>
    <!-- Floodlight beam gradient -->
    <linearGradient id="beam${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,240,180,0.12)"/>
      <stop offset="100%" stop-color="rgba(255,240,180,0)"/>
    </linearGradient>
    <filter id="blur${uid}"><feGaussianBlur stdDeviation="2"/></filter>
    <filter id="dof${uid}"><feGaussianBlur stdDeviation="0.4"/></filter>
    <filter id="fgblur${uid}"><feGaussianBlur stdDeviation="2.5"/></filter>
    <filter id="glow${uid}"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="haze${uid}"><feGaussianBlur stdDeviation="1.2"/></filter>
    <clipPath id="stadClip${uid}"><rect x="0" y="0" width="600" height="${horizon}"/></clipPath>
  </defs>

  <!-- Sky -->
  <rect width="600" height="300" fill="url(#sky${uid})"/>

  <!-- Stadium architecture -->
  <g clip-path="url(#stadClip${uid})">
    <!-- Stadium roof structure -->
    <polygon points="0,18 300,8 600,18 600,26 0,26" fill="#181828"/>
    <line x1="0" y1="26" x2="600" y2="26" stroke="#252540" stroke-width="2"/>
    <!-- Roof overhang shadow -->
    <rect x="0" y="26" width="600" height="8" fill="url(#roofShade${uid})"/>
    <!-- Upper deck (dark seats) -->
    <rect x="0" y="26" width="600" height="28" fill="#151525"/>
    <!-- Upper crowd -->
    <g filter="url(#blur${uid})">${crowdRows.slice(0, 100).join('')}</g>
    <!-- Tier divider / balcony -->
    <rect x="0" y="50" width="600" height="3" fill="#2a2a40"/>
    <rect x="0" y="53" width="600" height="1" fill="#3a3a55" opacity="0.5"/>
    <!-- Lower deck -->
    <rect x="0" y="53" width="600" height="32" fill="#121222"/>
    <!-- Lower crowd -->
    <g filter="url(#blur${uid})" opacity="0.9">${crowdRows.slice(100, 180).join('')}</g>
    <!-- Front row / advertising boards -->
    <rect x="0" y="84" width="600" height="4" fill="#222238"/>
    <rect x="0" y="84" width="600" height="4" fill="rgba(255,255,255,0.03)"/>
    <!-- Ad boards - subtle colored strips -->
    ${Array.from({ length: 12 }, (_, i) => {
      const ax = i * 52 + Math.random() * 8
      const aclr = ['#c22', '#22c', '#2a2', '#cc2', '#c6c', '#2cc'][Math.floor(Math.random() * 6)]
      return `<rect x="${ax}" y="84" width="${30 + Math.random() * 15}" height="3.5" fill="${aclr}" opacity="0.15" rx="0.5"/>`
    }).join('')}
    <!-- Front row fans (closest) -->
    <g filter="url(#haze${uid})">${crowdRows.slice(180).join('')}</g>
  </g>

  <!-- Floodlights with glow halos -->
  ${floodSvg}

  <!-- Floodlight beams (dramatic light shafts) -->
  <polygon points="36,8 -20,${horizon + 40} 100,${horizon + 40}" fill="url(#beam${uid})" opacity="0.6"/>
  <polygon points="180,6 130,${horizon + 40} 230,${horizon + 40}" fill="url(#beam${uid})" opacity="0.4"/>
  <polygon points="420,6 370,${horizon + 40} 470,${horizon + 40}" fill="url(#beam${uid})" opacity="0.4"/>
  <polygon points="564,8 500,${horizon + 40} 620,${horizon + 40}" fill="url(#beam${uid})" opacity="0.6"/>

  <!-- Bokeh circles (lens effects) -->
  ${bokeh}

  <!-- Pitch surface -->
  <rect x="0" y="${horizon}" width="600" height="${pitchH}" fill="url(#grass${uid})"/>
  <!-- Mow stripes (perspective) -->
  ${Array.from({ length: 10 }, (_, i) => {
    const sx = i * 65 - 15
    return `<polygon points="${sx},${horizon} ${sx + 32},${horizon} ${sx + 28 + i * 2},300 ${sx - 4 + i * 2},300" fill="rgba(255,255,255,0.018)"/>`
  }).join('')}
  <!-- Pitch line markings -->
  <line x1="0" y1="${horizon + 3}" x2="600" y2="${horizon + 3}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  <!-- Touchline (sideline) -->
  <line x1="0" y1="${groundY + 20}" x2="600" y2="${groundY + 20}" stroke="rgba(255,255,255,0.045)" stroke-width="0.8"/>
  <!-- Halfway line (perspective) -->
  <line x1="300" y1="${horizon + 3}" x2="300" y2="${groundY + 20}" stroke="rgba(255,255,255,0.04)" stroke-width="0.7"/>
  <!-- Center circle (perspective: ellipse) -->
  <ellipse cx="300" cy="${horizon + (groundY + 20 - horizon) * 0.5}" rx="40" ry="${(groundY + 20 - horizon) * 0.18}" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="0.7"/>
  <!-- Left penalty box (perspective trapezoid) -->
  <polygon points="0,${horizon + 8} 95,${horizon + 10} 80,${groundY + 14} 0,${groundY + 16}" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="0.6"/>
  <!-- Right penalty box (perspective trapezoid) -->
  <polygon points="600,${horizon + 8} 505,${horizon + 10} 520,${groundY + 14} 600,${groundY + 16}" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="0.6"/>

  <!-- Scene elements (goal posts, corner flags, etc.) -->
  ${sceneElements}

  <!-- Atmospheric haze at pitch-crowd boundary -->
  ${hazeLayers}

  <!-- Warm floodlight wash -->
  <rect width="600" height="300" fill="url(#warm${uid})"/>
  <!-- Cool ambient fill -->
  <rect width="600" height="300" fill="url(#cool${uid})"/>

  <!-- Player figures with slight DOF -->
  <g filter="url(#dof${uid})">
  ${figures}
  </g>

  <!-- Ball -->
  ${ballSvg}

  <!-- Extra effects (motion blur, particles) -->
  ${extraElements}

  <!-- Foreground out-of-focus grass blades (shallow DOF) -->
  <g filter="url(#fgblur${uid})">${fgGrass}</g>

  <!-- Heavy cinematic vignette -->
  <rect width="600" height="300" fill="url(#vig${uid})"/>

  <!-- Film grain overlay (subtle noise texture) -->
  <rect width="600" height="300" fill="rgba(0,0,0,0)" opacity="0.03">
    <animate attributeName="opacity" values="0.02;0.04;0.02" dur="0.3s" repeatCount="indefinite"/>
  </rect>

  <!-- Cinematic caption bar with gradient -->
  <rect x="0" y="252" width="600" height="48" fill="rgba(0,0,0,0.85)"/>
  <rect x="0" y="250" width="600" height="4" fill="rgba(0,0,0,0.4)"/>
  <text x="18" y="274" fill="white" font-size="12" font-weight="800" font-family="system-ui" letter-spacing="0.5">${hName} ${s[0]} \u2013 ${s[1]} ${aName}</text>
  <text x="582" y="274" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="10" font-style="italic" font-family="system-ui">${caption}</text>
  <text x="18" y="291" fill="rgba(255,255,255,0.2)" font-size="7.5" font-family="monospace" letter-spacing="1">${CONFIG.league.shortName} SEASON ${match._season || ''} \u2022 MATCHDAY ${match._md || ''} \u2022 \u{1F4F7} ${CONFIG.league.shortName} MEDIA</text>
</svg>`
}

// ---------------------------------------------------------------------------
// AI-powered matchday report generator (Anthropic Claude)
// ---------------------------------------------------------------------------
async function generateAIReport(matches, standings, topScorers, league, mdNum, seasonNum) {
  const client = getAnthropicClient()

  // Build match data summaries for the prompt
  const matchSummaries = matches.map(m => {
    const s = m.score || [0, 0]
    const homeTeam = league.teams.find(t => t.name === m.home)
    const awayTeam = league.teams.find(t => t.name === m.away)
    const homeCoach = homeTeam && homeTeam.coach ? homeTeam.coach.name + ' (' + homeTeam.coach.style + ')' : 'unknown'
    const awayCoach = awayTeam && awayTeam.coach ? awayTeam.coach.name + ' (' + awayTeam.coach.style + ')' : 'unknown'
    const homeVenue = homeTeam && homeTeam.stadium ? homeTeam.stadium : 'home ground'

    // Goal events
    let goalDetail = ''
    if (m.goalEvents) {
      const allGoals = [
        ...(m.goalEvents.home || []).map(g => ({ ...g, team: m.home })),
        ...(m.goalEvents.away || []).map(g => ({ ...g, team: m.away }))
      ]
      goalDetail = allGoals.filter(g => !g.missed).map(g =>
        g.scorer + ' (' + g.team + ')' + (g.assister ? ' assisted by ' + g.assister : '') + (g.penalty ? ' [penalty]' : '')
      ).join('; ')
      const missed = allGoals.filter(g => g.missed)
      if (missed.length) goalDetail += ' | Missed penalties: ' + missed.map(g => g.scorer + ' (' + g.team + ')').join(', ')
    }

    // Top rated players
    let playerHighlights = ''
    if (m.playerStats) {
      const all = [...(m.playerStats.home || []), ...(m.playerStats.away || [])]
      const sorted = all.sort((a, b) => (b.grade || 0) - (a.grade || 0)).slice(0, 4)
      playerHighlights = sorted.map(p => p.name + ' (grade ' + (p.grade || 0).toFixed(1) + ', ' + (p.goals || 0) + 'g ' + (p.assists || 0) + 'a' + (p.saves ? ' ' + p.saves + ' saves' : '') + ')').join('; ')
    }

    return {
      home: m.home, away: m.away, score: s, venue: homeVenue,
      homeCoach, awayCoach,
      homeRating: homeTeam ? homeTeam.rating : '?',
      awayRating: awayTeam ? awayTeam.rating : '?',
      goals: goalDetail,
      playerHighlights
    }
  })

  const standingsStr = standings.slice(0, 10).map((s, i) =>
    (i + 1) + '. ' + s.team + ' - P' + s.played + ' W' + s.won + ' D' + s.drawn + ' L' + s.lost + ' GF' + s.gf + ' GA' + s.ga + ' Pts' + s.points
  ).join('\n')

  const topScorersStr = topScorers.slice(0, 5).map(p => p.name + ' (' + p.team + ') - ' + p.goals + ' goals').join(', ')

  const motm = findMOTM(matches)

  // Pick interview subject for each match
  const interviewInfo = matches.map(m => {
    const s = m.score || [0, 0]
    const winner = s[0] > s[1] ? m.home : s[1] > s[0] ? m.away : m.home
    const winnerTeam = league.teams.find(t => t.name === winner)
    const coach = winnerTeam && winnerTeam.coach ? winnerTeam.coach.name : 'the manager'
    let bestPlayer = null
    if (m.playerStats) {
      const side = winner === m.home ? 'home' : 'away'
      const stats = m.playerStats[side] || []
      if (stats.length) bestPlayer = [...stats].sort((a, b) => (b.grade || 0) - (a.grade || 0))[0]
    }
    const isCoach = !bestPlayer || Math.random() < 0.25
    return {
      match: m.home + ' vs ' + m.away,
      interviewee: isCoach ? coach : bestPlayer.name,
      role: isCoach ? 'coach' : 'player',
      team: winner
    }
  })

  const prompt = `You are a football journalist writing a matchday report for the ${CONFIG.league.name} (${CONFIG.league.shortName}), a fictional 6v6 football league in the nation of Labornis. This is a race-to-5 scoring system (first to 5 goals wins, extended play at 4-4, draw at 5-5).

Write a complete Matchday ${mdNum} report for Season ${seasonNum}.

MATCH DATA:
${matchSummaries.map(m => `- ${m.home} ${m.score[0]}-${m.score[1]} ${m.away} at ${m.venue}
  Home coach: ${m.homeCoach} (team rating: ${m.homeRating}) | Away coach: ${m.awayCoach} (team rating: ${m.awayRating})
  Goals: ${m.goals || 'none'}
  Key players: ${m.playerHighlights || 'none'}`).join('\n')}

CURRENT STANDINGS:
${standingsStr}

TOP SCORERS: ${topScorersStr || 'none yet'}

MAN OF THE MATCHDAY: ${motm.name} (${motm.team}) - grade ${motm.grade.toFixed(1)}, ${motm.goals}g ${motm.assists}a${motm.saves ? ' ' + motm.saves + ' saves' : ''}

POST-MATCH INTERVIEWS (write 2 questions + answers for each):
${interviewInfo.map(iv => `- ${iv.match}: Interview ${iv.interviewee} (${iv.role}, ${iv.team})`).join('\n')}

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no code fences, just raw JSON):
{
  "headline": "Catchy newspaper headline for the matchday",
  "subheadline": "One-line subtitle",
  "lede": "Opening paragraph (3-4 sentences) setting the scene for the entire matchday",
  "matchReports": [
    {
      "home": "Team A",
      "away": "Team B",
      "score": [5, 3],
      "venue": "Stadium Name",
      "title": "Newspaper-style match headline",
      "body": "3 paragraphs separated by \\n\\n. First paragraph: match narrative. Second: key goals and individual performances. Third: tactical analysis and coaching, table position context.",
      "interview": {
        "interviewee": "Person Name",
        "role": "coach or player",
        "team": "Their Team",
        "questions": [
          {"q": "Reporter question 1?", "a": "Detailed answer in first person, showing personality, 2-3 sentences."},
          {"q": "Reporter question 2?", "a": "Detailed answer in first person, 2-3 sentences."}
        ]
      }
    }
  ],
  "manOfMatchday": {
    "name": "${motm.name}",
    "team": "${motm.team}",
    "reason": "2-sentence explanation of why they earned the award"
  },
  "byTheNumbers": [
    "Stat line 1 — with number and context",
    "Stat line 2",
    "Stat line 3",
    "Stat line 4"
  ],
  "lookAhead": "Closing paragraph looking ahead to next matchday, title race implications, 3-4 sentences"
}

IMPORTANT RULES:
- Match reports must be in the SAME ORDER as the match data above
- Use the actual player names, team names, venues, scores, and goal scorers from the data
- Write like a passionate football columnist — vivid, dramatic, opinionated
- Each interview answer should feel authentic and personal, reflecting the result
- Reference the standings and title race where relevant
- Keep each match body to exactly 3 short paragraphs (2-3 sentences each) separated by \\n\\n
- Each interview answer should be 1-2 sentences max
- The "byTheNumbers" should have exactly 4 items
- Keep the lede and lookAhead to 2-3 sentences each
- Be CONCISE — quality over quantity. The entire JSON must fit within 6000 tokens`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].text.trim()
  // Parse JSON — handle potential markdown fences
  const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '')
  return JSON.parse(jsonStr)
}

// ---------------------------------------------------------------------------
// Local matchday report generator (football columnist engine)
// ---------------------------------------------------------------------------
function generateLocalReport(matches, standings, topScorers, league, mdNum, seasonNum, history, schedule) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)]
  const totalGoals = matches.reduce((s, m) => s + (m.score ? m.score[0] + m.score[1] : 0), 0)
  const avgGoals = (totalGoals / matches.length).toFixed(1)
  const bigWin = matches.reduce((best, m) => {
    const diff = m.score ? Math.abs(m.score[0] - m.score[1]) : 0
    return diff > best.diff ? { match: m, diff } : best
  }, { match: matches[0], diff: 0 })
  const draws = matches.filter(m => m.score && m.score[0] === m.score[1])
  const leader = standings[0] || {}
  const second = standings[1] || {}
  const bottom = standings[standings.length - 1] || {}

  const motm = findMOTM(matches)

  // ------------------------------------------------------------------
  // League-history & standings context helpers
  // ------------------------------------------------------------------
  const hist = history && history.seasons ? history.seasons : []
  const pastSeasons = hist.filter(s => s.number < seasonNum)

  // Head-to-head record across ALL past seasons (and current up to this matchday)
  function h2h(teamA, teamB) {
    let wA = 0, wB = 0, d = 0, gfA = 0, gfB = 0, meetings = 0
    let lastMeeting = null
    for (const s of hist) {
      const results = s.matchResults || []
      for (const r of results) {
        const involvesBoth = (r.home === teamA && r.away === teamB) || (r.home === teamB && r.away === teamA)
        if (!involvesBoth || !r.score) continue
        meetings++
        const aIsHome = r.home === teamA
        const aScore = aIsHome ? r.score[0] : r.score[1]
        const bScore = aIsHome ? r.score[1] : r.score[0]
        gfA += aScore; gfB += bScore
        if (aScore > bScore) wA++
        else if (bScore > aScore) wB++
        else d++
        lastMeeting = { season: s.number, score: [aScore, bScore] }
      }
    }
    return { wA, wB, d, gfA, gfB, meetings, lastMeeting }
  }

  // Form: last N matches (W/D/L) for a team, across previous matchdays in this season
  function form(teamName, n) {
    if (!schedule || !schedule.matchdays) return []
    const out = []
    for (let i = mdNum - 1; i >= 1 && out.length < n; i--) {
      const md = schedule.matchdays.find(x => x.number === i)
      if (!md) continue
      for (const mm of md.matches) {
        if (mm.status !== 'completed') continue
        if (mm.home !== teamName && mm.away !== teamName) continue
        const isHome = mm.home === teamName
        const myG = isHome ? mm.score[0] : mm.score[1]
        const oppG = isHome ? mm.score[1] : mm.score[0]
        out.push(myG > oppG ? 'W' : myG === oppG ? 'D' : 'L')
        break
      }
    }
    return out
  }

  // Current streak (consecutive W, L, or D) going into this matchday
  function streak(teamName) {
    const f = form(teamName, 12)
    if (!f.length) return { type: null, count: 0 }
    const type = f[0]
    let count = 0
    for (const r of f) { if (r === type) count++; else break }
    return { type, count }
  }

  // Past championships for a team
  function titlesFor(teamName) {
    const won = []
    for (const s of pastSeasons) {
      if (s.champion === teamName) won.push(s.number)
      else if (s.guyKilneTrophy && s.guyKilneTrophy.team === teamName) won.push(s.number)
    }
    return won
  }

  // Derby detection: teams are considered rivals if they have met >= 4 times OR
  // faced each other in a past playoff final/semi.
  function isDerby(teamA, teamB) {
    const rec = h2h(teamA, teamB)
    if (rec.meetings >= 4) return { derby: true, reason: 'long-standing', meetings: rec.meetings }
    for (const s of pastSeasons) {
      if (!s.playoffs) continue
      const f = s.playoffs.final
      if (f && ((f.team1 === teamA && f.team2 === teamB) || (f.team1 === teamB && f.team2 === teamA))) {
        return { derby: true, reason: 'final-rematch', finalSeason: s.number }
      }
      const sfs = s.playoffs.semiFinals || []
      for (const sf of sfs) {
        if ((sf.team1 === teamA && sf.team2 === teamB) || (sf.team1 === teamB && sf.team2 === teamA)) {
          return { derby: true, reason: 'semi-rematch', semiSeason: s.number }
        }
      }
    }
    return { derby: false }
  }

  // Standings context for a position
  function standingsContext(pos, total) {
    if (!pos || !total) return { label: 'mid-table', spin: '' }
    const half = Math.ceil(total / 2)
    if (pos === 1) return { label: 'league leaders', spin: 'top of the pile' }
    if (pos <= 3) return { label: 'title contenders', spin: 'right in the thick of the title race' }
    if (pos <= 4) return { label: 'top-four chasers', spin: 'eyeing a home draw in the quarter-finals' }
    if (pos <= 8) return { label: 'playoff chasers', spin: 'scrapping for a playoff berth' }
    if (pos <= half) return { label: 'mid-table', spin: 'still searching for their identity' }
    if (pos >= total - 1) return { label: 'bottom-dwellers', spin: 'staring at the wrong end of the table' }
    return { label: 'lower-half', spin: 'hovering in the lower half' }
  }

  // Previous champion of the league
  const lastChampSeason = pastSeasons.length ? pastSeasons[pastSeasons.length - 1] : null
  const reigningChamp = lastChampSeason ? (lastChampSeason.champion || (lastChampSeason.guyKilneTrophy && lastChampSeason.guyKilneTrophy.team)) : null
  // Most-decorated team ever
  const titleCounts = {}
  for (const s of pastSeasons) {
    const c = s.champion || (s.guyKilneTrophy && s.guyKilneTrophy.team)
    if (c) titleCounts[c] = (titleCounts[c] || 0) + 1
  }
  const mostDecorated = Object.entries(titleCounts).sort((a, b) => b[1] - a[1])[0]

  // Detect any derby match across the fixtures
  const derbyMatch = matches.map(m => ({ m, info: isDerby(m.home, m.away) })).find(x => x.info.derby)
  // Champion-chasing context
  const champChaserMatch = matches.find(m => reigningChamp && (m.home === reigningChamp || m.away === reigningChamp))

  // Headline templates — now context-aware
  const headlineTemplates = [
    () => derbyMatch ? 'Rivalry Renewed: ' + derbyMatch.m.home + ' vs ' + derbyMatch.m.away + ' Lights Up Matchday ' + mdNum : null,
    () => totalGoals >= matches.length * 4 ? 'Goals Galore on a Sensational Matchday ' + mdNum : null,
    () => draws.length >= Math.ceil(matches.length / 2) ? 'Stalemate Saturday: Draws Dominate Matchday ' + mdNum : null,
    () => bigWin.diff >= 4 ? bigWin.match.score[0] > bigWin.match.score[1] ? bigWin.match.home + ' Run Riot in Matchday ' + mdNum + ' Masterclass' : bigWin.match.away + ' Demolish ' + bigWin.match.home + ' in Stunning Away Day' : null,
    () => leader.points - (second.points || 0) >= 4 ? leader.team + ' Tighten Grip at the Summit' : null,
    () => reigningChamp && standings[0] && standings[0].team !== reigningChamp ? 'The Champions Wobble: ' + reigningChamp + ' Chase ' + (standings[0].team || 'the Pace') : null,
    () => 'Drama, Goals, and Heartbreak: Matchday ' + mdNum + ' Has It All',
    () => 'Matchday ' + mdNum + ' Delivers the Goods in Season ' + seasonNum,
    () => 'A Matchday to Remember as the ' + CONFIG.league.shortName + ' Title Race Heats Up',
    () => 'Thunder and Lightning: ' + CONFIG.league.shortName + ' Matchday ' + mdNum + ' Leaves Its Mark'
  ]
  const headline = headlineTemplates.map(f => f()).filter(Boolean)[0] || pick(headlineTemplates.slice(-4)).call()

  const subTemplates = [
    totalGoals + ' goals across ' + matches.length + ' matches \u2014 just another day in the ' + CONFIG.league.shortName,
    'From the sublime to the ridiculous, Season ' + seasonNum + ' continues to deliver',
    leader.team + ' lead the way as the battle rages on all fronts',
    'The beautiful game at its finest \u2014 and most chaotic',
    reigningChamp ? 'Reigning champions ' + reigningChamp + ' under the spotlight once again' : null,
    mostDecorated ? 'Can anyone stop ' + mostDecorated[0] + '\u2019s ' + mostDecorated[1] + '-title dynasty?' : null,
    derbyMatch ? 'Old rivalries reignited under the floodlights' : null,
    (leader.points - (second.points || 0)) === 0 && standings.length >= 2 ? 'Nothing to separate the top two as the race tightens' : null
  ].filter(Boolean)

  // Championship/history framing line (used in lede)
  let historyLine = ''
  if (pastSeasons.length === 0) {
    historyLine = 'Still just the inaugural run \u2014 every result is writing fresh history for the ' + CONFIG.league.shortName + '.'
  } else if (reigningChamp) {
    historyLine = 'With ' + reigningChamp + ' wearing the crown from Season ' + (seasonNum - 1) + ', every rival has a target on their back.'
    if (mostDecorated && mostDecorated[1] >= 2) historyLine += ' And ' + mostDecorated[0] + ', winners of ' + mostDecorated[1] + ' titles, loom large over the record books.'
  }

  // Lede templates \u2014 now with history context
  const ledeTemplates = [
    'Matchday ' + mdNum + ' of the ' + CONFIG.league.name + ' served up a feast of football that will live long in the memory. With ' + totalGoals + ' goals shared across ' + matches.length + ' fixtures, the ' + CONFIG.league.shortName + ' once again proved why it is the most unpredictable league in all of Labornis. ' + historyLine,
    'If you blinked during Matchday ' + mdNum + ', you missed something. The ' + CONFIG.league.shortName + ' faithful were treated to ' + totalGoals + ' goals, dramatic comebacks, and the kind of football that reminds us why we fell in love with this beautiful game. ' + historyLine,
    'Another week, another round of chaos in the ' + CONFIG.league.name + '. Matchday ' + mdNum + ' had everything \u2014 ' + totalGoals + ' goals, ' + draws.length + ' draw' + (draws.length !== 1 ? 's' : '') + ', and enough talking points to fill a press conference marathon. ' + historyLine,
    'The ' + CONFIG.league.shortName + ' never disappoints, and Matchday ' + mdNum + ' was no exception. ' + totalGoals + ' goals flew in across ' + matches.length + ' matches as ' + (leader.team ? leader.team + ' and the chasing pack traded blows' : 'the title race took fresh twists') + ', with the title race and the battle at the bottom both taking dramatic turns. ' + historyLine
  ]

  // Match report generation \u2014 expanded vocabulary
  const goalVerbs = [
    'fired home', 'slotted past the keeper', 'thundered in', 'curled beautifully into the net',
    'poked home from close range', 'headed in powerfully', 'smashed into the top corner',
    'calmly converted', 'rifled in', 'drilled low and hard into the corner',
    'arrowed a shot into the bottom corner', 'lashed a volley into the roof of the net',
    'stabbed home at the near post', 'chipped the onrushing keeper', 'tucked away with aplomb',
    'bundled in from a scramble', 'curled a free-kick over the wall', 'ghosted in to finish at the back post',
    'pinged one in off the underside of the bar', 'side-footed a sumptuous finish',
    'produced a moment of pure class to score', 'dinked it coolly into the corner',
    'hammered a shot through a crowd of bodies', 'arrowed home from distance',
    'buried a sweet half-volley', 'prodded it past the stranded keeper'
  ]
  const assistVerbs = [
    'set up by a delightful ball from', 'after brilliant work from', 'following a pinpoint delivery from',
    'teed up expertly by', 'courtesy of a sublime pass from', 'picked out unmarked by',
    'threaded through by a defence-splitting pass from', 'from a raking crossfield ball by',
    'following a selfless lay-off from', 'latching onto a perfectly weighted through-ball from',
    'after a silky piece of skill from', 'from a pinpoint corner delivered by'
  ]
  const winPhrases = [
    'proved too strong for', 'dismantled', 'edged past', 'overcame', 'got the better of',
    'dispatched', 'saw off the challenge of', 'outclassed', 'outfoxed', 'tore apart',
    'put to the sword', 'outmaneuvered', 'out-thought and out-fought', 'comfortably saw off'
  ]
  const drawPhrases = [
    'shared the spoils with', 'battled to a draw against', 'couldn\'t be separated from',
    'played out an entertaining draw with', 'slugged out a stalemate with',
    'traded blows but could not break', 'settled for a point apiece against'
  ]
  const coachPraise = [
    'will be delighted with the tactical setup', 'got his game plan spot on',
    'deserves credit for the team\'s organization', 'masterminded a brilliant performance',
    'pressed every right button from the touchline', 'read the game beautifully from the sideline',
    'looked every inch a manager in complete control'
  ]
  const coachCrit = [
    'will have questions to answer after the display', 'must find solutions quickly',
    'saw his tactics come unstuck', 'will be scratching his head',
    'was out-thought by his opposite number today', 'watched his game plan unravel in real time',
    'cut a frustrated figure on the touchline'
  ]
  const shutoutPhrases = [
    'kept a clean sheet', 'marshalled the defense superbly', 'was a fortress at the back',
    'stood firm like a wall', 'refused to yield an inch', 'held every line to perfection'
  ]
  const highScoringPhrases = [
    'what a game this was', 'the neutral\'s dream fixture',
    'end-to-end stuff that had everyone on the edge of their seats', 'pure box-office entertainment',
    'football the way it was meant to be played', 'a goalfest for the ages'
  ]
  const positionLabels = (pos) => {
    if (pos <= 1) return 'league leaders'
    if (pos <= 3) return 'title contenders'
    if (pos <= Math.ceil(standings.length / 2)) return 'mid-table'
    if (pos >= standings.length - 1) return 'relegation-threatened'
    return 'lower-half'
  }

  const matchReports = matches.map(m => {
    const s = m.score || [0, 0]
    const isDraw = s[0] === s[1]
    const winner = s[0] > s[1] ? m.home : s[1] > s[0] ? m.away : null
    const loser = s[0] > s[1] ? m.away : s[1] > s[0] ? m.home : null
    const homeGoals = m.goalEvents ? m.goalEvents.home : []
    const awayGoals = m.goalEvents ? m.goalEvents.away : []
    const allGoals = [...homeGoals.map(g => ({ ...g, team: m.home })), ...awayGoals.map(g => ({ ...g, team: m.away }))]
    const homeTeam = league.teams.find(t => t.name === m.home)
    const awayTeam = league.teams.find(t => t.name === m.away)
    const homePos = standings.findIndex(st => st.team === m.home) + 1
    const awayPos = standings.findIndex(st => st.team === m.away) + 1
    const homeCoach = homeTeam ? homeTeam.coach.name : 'the manager'
    const awayCoach = awayTeam ? awayTeam.coach.name : 'the manager'
    const goalDiff = Math.abs(s[0] - s[1])
    const isHighScoring = s[0] + s[1] >= 8
    const isShutout = !isDraw && (s[0] === 0 || s[1] === 0)

    // Match-level context
    const h2hRec = h2h(m.home, m.away)
    const derbyInfo = isDerby(m.home, m.away)
    const homeForm = form(m.home, 5)
    const awayForm = form(m.away, 5)
    const homeStreak = streak(m.home)
    const awayStreak = streak(m.away)
    const homeTitles = titlesFor(m.home)
    const awayTitles = titlesFor(m.away)
    const homeCtx = standingsContext(homePos, standings.length)
    const awayCtx = standingsContext(awayPos, standings.length)
    const isReigningChampMatch = reigningChamp && (m.home === reigningChamp || m.away === reigningChamp)

    // Title \u2014 now derby-aware
    let title
    if (derbyInfo.derby && !isDraw) title = pick(['Derby Day Glory for ', 'Bragging Rights to ', 'Rivalry Settled as ']) + winner + ' Over ' + loser
    else if (derbyInfo.derby) title = 'Derby Day Deadlock: ' + m.home + ' ' + s[0] + '-' + s[1] + ' ' + m.away
    else if (isDraw) title = m.home + ' ' + s[0] + '-' + s[1] + ' ' + m.away + ': ' + pick(['Honors Even', 'Points Shared', 'Neither Side Can Find the Winner', 'A Fair Result in the End'])
    else if (goalDiff >= 4) title = winner + ' ' + pick(['Thrash', 'Demolish', 'Run Riot Against', 'Humble', 'Dismantle']) + ' ' + loser
    else if (isShutout) title = winner + ' ' + pick(['Shut Out', 'Blank', 'Keep Clean Sheet Against', 'Nullify']) + ' ' + loser
    else title = winner + ' ' + pick(['Edge', 'See Off', 'Overcome', 'Defeat', 'Outlast']) + ' ' + loser + ' in ' + pick(['Thriller', 'Contest', 'Battle', 'Encounter', 'Dogfight'])

    // Body paragraphs
    let para1 = ''
    const homeVenue = homeTeam && homeTeam.stadium ? homeTeam.stadium : 'the home ground'
    if (isDraw) {
      para1 = m.home + ' ' + pick(drawPhrases) + ' ' + m.away + ' in a ' + s[0] + '-' + s[1] + ' draw at ' + homeVenue + '. '
      if (isHighScoring) para1 += pick(highScoringPhrases).charAt(0).toUpperCase() + pick(highScoringPhrases).slice(1) + '. '
    } else {
      para1 = winner + ' ' + pick(winPhrases) + ' ' + loser + ' with a convincing ' + s[0] + '-' + s[1] + ' ' + (winner === m.home ? 'home' : 'away') + ' victory at ' + homeVenue + '. '
      if (goalDiff >= 3) para1 += 'It was men against boys at times, as ' + loser + ' simply had no answer. '
      if (isShutout) para1 += 'The defense ' + pick(shutoutPhrases) + ', leaving ' + loser + '\'s forwards with nothing to show for their efforts. '
    }

    // Rivalry / history context line appended to para1 when present
    if (derbyInfo.derby) {
      if (derbyInfo.reason === 'final-rematch') {
        para1 += 'This one carried extra weight \u2014 a rematch of the Season ' + derbyInfo.finalSeason + ' final. '
      } else if (derbyInfo.reason === 'semi-rematch') {
        para1 += 'Old sparks flew again: these two squared off in the Season ' + derbyInfo.semiSeason + ' semi-final, and nobody in either dugout had forgotten. '
      } else if (h2hRec.meetings >= 4) {
        const lead = h2hRec.wA > h2hRec.wB ? m.home : h2hRec.wB > h2hRec.wA ? m.away : null
        para1 += pick(['A well-worn rivalry', 'A familiar grudge match', 'Another chapter in a storied rivalry']) + ' \u2014 ' + h2hRec.meetings + ' all-time meetings' + (lead ? ', with ' + lead + ' holding the edge' : ', honours even on aggregate') + '. '
      }
    }
    if (isReigningChampMatch && !derbyInfo.derby) {
      const champSide = m.home === reigningChamp ? 'home' : 'away'
      para1 += 'Reigning champions ' + reigningChamp + ' were in town' + (champSide === 'home' ? ', the crown resting on home shoulders' : ', trying to defend their crown on the road') + '. '
    }

    // Goal descriptions \u2014 position/age-aware
    let para2 = ''
    const scorers = {}
    allGoals.forEach(g => { if (!g.missed) scorers[g.scorer] = (scorers[g.scorer] || 0) + 1 })
    const multiScorers = Object.entries(scorers).filter(([_, c]) => c >= 2)

    // Helper: look up a player's full record from league data
    const findPlayer = (playerName, teamName) => {
      const t = league.teams.find(tt => tt.name === teamName)
      if (!t) return null
      return t.players.find(p => p.name === playerName) || null
    }
    // Helper: position descriptor
    const posDescriptor = (pl) => {
      if (!pl || !pl.position) return ''
      const p = pl.position
      if (p === 'ST') return pick(['striker', 'forward', 'frontman', 'number nine'])
      if (p === 'CM') return pick(['midfielder', 'playmaker', 'engine-room man', 'central midfielder'])
      if (p === 'DF' || p === 'CB' || p === 'LB' || p === 'RB') return pick(['defender', 'centre-back', 'rock at the back'])
      if (p === 'GK') return pick(['goalkeeper', 'shot-stopper'])
      if (p === 'LW' || p === 'RW') return pick(['winger', 'wide man', 'flanker'])
      return 'player'
    }
    // Helper: age-flavor prefix (veteran/young)
    const ageFlavor = (pl) => {
      if (!pl || !pl.age) return ''
      const age = parseInt(pl.age, 10)
      if (age >= 34) return pick(['the evergreen ', 'the ever-reliable veteran ', 'ageless veteran ', 'the grizzled ', ''])
      if (age <= 20) return pick(['teenage sensation ', 'the precocious ', 'young prodigy ', 'rising star ', ''])
      if (age <= 23) return pick(['young ', 'up-and-coming ', ''])
      return ''
    }
    // Helper: rating-flavor
    const ratingFlavor = (pl) => {
      if (!pl || !pl.rating) return ''
      const r = parseInt(pl.rating, 10)
      if (r >= 85) return pick(['the world-class ', 'star man ', 'talisman ', ''])
      if (r >= 78) return pick(['dependable ', 'classy ', ''])
      return ''
    }

    if (multiScorers.length) {
      const [name, count] = multiScorers[0]
      const team = allGoals.find(g => g.scorer === name).team
      const pl = findPlayer(name, team)
      const flavour = (ageFlavor(pl) || ratingFlavor(pl))
      const pos = posDescriptor(pl)
      para2 += flavour + name + (pos ? ', ' + team + '\'s ' + pos + ',' : '') + ' was the star of the show with ' + count + ' goals for ' + team + ', '
      if (count >= 3) para2 += 'completing a ' + pick(['stunning', 'memorable', 'audacious', 'career-defining']) + ' hat-trick that ' + pick(['will make the highlight reels', 'brought the crowd to their feet', 'was simply unstoppable', 'the ' + CONFIG.league.shortName + ' will be talking about for weeks']) + '. '
      else para2 += pick(['a brace that proved decisive', 'two goals that swung the contest', 'a matchwinning double', 'two moments of quality that separated the sides']) + '. '
    }

    const keyGoals = allGoals.filter(g => !g.missed).slice(0, 3)
    keyGoals.forEach((g, i) => {
      if (multiScorers.some(([n]) => n === g.scorer) && i > 0) return
      const pl = findPlayer(g.scorer, g.team)
      const pos = posDescriptor(pl)
      const scorerLabel = g.scorer + (pos && i === 0 ? ' (' + pos + ')' : '')
      if (g.penalty) {
        para2 += scorerLabel + ' ' + pick(['slotted home from the spot', 'coolly dispatched the penalty', 'buried the spot-kick with no fuss', 'sent the keeper the wrong way from twelve yards']) + '. '
      } else {
        para2 += scorerLabel + ' ' + pick(goalVerbs)
        if (g.assister) {
          const aPl = findPlayer(g.assister, g.team)
          const aPos = aPl && aPl.position === 'CM' ? pick([' (the midfield maestro)', '']) : ''
          para2 += ', ' + pick(assistVerbs) + ' ' + g.assister + aPos
        }
        para2 += '. '
      }
    })
    // Missed penalty note
    const missedPens = allGoals.filter(g => g.missed)
    if (missedPens.length) {
      const mp = missedPens[0]
      para2 += mp.scorer + ' will want to forget the missed penalty \u2014 a moment that could have changed everything. '
    }

    // Tactical/coaching paragraph
    let para3 = ''
    if (winner) {
      const winCoach = winner === m.home ? homeCoach : awayCoach
      const loseCoach = winner === m.home ? awayCoach : homeCoach
      const winStyle = winner === m.home ? (homeTeam && homeTeam.coach ? homeTeam.coach.style : null) : (awayTeam && awayTeam.coach ? awayTeam.coach.style : null)
      para3 += winCoach + ' ' + pick(coachPraise)
      if (winStyle) para3 += ', his ' + winStyle + ' approach carving open the opposition'
      para3 += ', while ' + loseCoach + ' ' + pick(coachCrit) + '. '
    } else {
      para3 += homeCoach + ' and ' + awayCoach + ' will both feel a draw was a fair outcome. '
    }
    para3 += 'This result leaves ' + m.home + ' ' + pick(['sitting', 'positioned', 'placed']) + ' ' + ordinal(homePos) + ' in the table'
    if (homeCtx.label) para3 += ' (' + homeCtx.label + ', ' + homeCtx.spin + ')'
    para3 += ' while ' + m.away + ' ' + pick(['occupy', 'find themselves in', 'sit in']) + ' ' + ordinal(awayPos) + ' place'
    if (awayCtx.label) para3 += ' (' + awayCtx.label + ')'
    para3 += '. '

    // Fourth paragraph: form, streaks, title race, history bookends
    let para4 = ''
    // Form lines
    const formLine = (team, f, streakObj) => {
      if (!f.length) return ''
      const str = f.join('-')
      let line = team + ' arrived on the back of ' + str
      if (streakObj.count >= 3) {
        line += ' (a ' + streakObj.count + '-match ' + (streakObj.type === 'W' ? 'winning streak' : streakObj.type === 'L' ? 'losing run' : 'unbeaten-but-winless spell') + ')'
      }
      return line
    }
    const hFL = formLine(m.home, homeForm, homeStreak)
    const aFL = formLine(m.away, awayForm, awayStreak)
    if (hFL && aFL) para4 += hFL + '; ' + aFL + '. '
    else if (hFL) para4 += hFL + '. '
    else if (aFL) para4 += aFL + '. '

    // Head-to-head history note (only if there are past meetings and not already mentioned as derby)
    if (h2hRec.meetings > 0 && h2hRec.meetings < 4 && !derbyInfo.derby) {
      para4 += 'In ' + h2hRec.meetings + ' prior meeting' + (h2hRec.meetings > 1 ? 's' : '')
      if (h2hRec.wA === h2hRec.wB) para4 += ', the ledger was level before this fixture'
      else {
        const lead = h2hRec.wA > h2hRec.wB ? m.home : m.away
        const lW = Math.max(h2hRec.wA, h2hRec.wB)
        const sW = Math.min(h2hRec.wA, h2hRec.wB)
        para4 += ', ' + lead + ' led ' + lW + '-' + sW + (h2hRec.d ? '-' + h2hRec.d : '')
      }
      para4 += '. '
    }
    // Title-race / relegation stakes
    if (winner && winner === m.home && homePos <= 3) para4 += 'The win keeps ' + winner + ' ' + homeCtx.spin + '. '
    else if (winner && winner === m.away && awayPos <= 3) para4 += 'The away win keeps ' + winner + ' ' + awayCtx.spin + '. '
    else if (winner && winner === m.away && homePos >= standings.length - 1) para4 += 'For ' + loser + ', the defeat deepens the gloom at the foot of the table. '
    else if (winner && winner === m.home && awayPos >= standings.length - 1) para4 += 'For ' + loser + ', the result piles further pressure on a season teetering on the brink. '
    // Past champions bookend
    if (homeTitles.length >= 2) para4 += m.home + ' (winners in ' + homeTitles.slice(-3).join(', ') + ') know what this stage demands. '
    else if (awayTitles.length >= 2) para4 += m.away + ' (champions in ' + awayTitles.slice(-3).join(', ') + ') have worn this crown before. '
    else if (winner && titlesFor(winner).length === 0 && pastSeasons.length >= 2) {
      para4 += pick([winner + ' are still chasing a first piece of silverware.', 'A result like this is exactly the kind of evidence ' + winner + ' can point to as proof the trophy drought could end this year.', ''])
    }

    // --- Post-match interview ---
    const interviewTeamName = winner || m.home
    const interviewTeam = league.teams.find(t => t.name === interviewTeamName)
    const interviewSide = interviewTeamName === m.home ? 'home' : 'away'
    const teamStats = m.playerStats ? (m.playerStats[interviewSide] || []) : []
    // Find highest-rated player on the interview team
    const bestPlayer = teamStats.length ? [...teamStats].sort((a, b) => (b.grade || 0) - (a.grade || 0))[0] : null
    const isCoach = !bestPlayer || Math.random() < 0.25  // 25% chance coach is interviewed even if there's a top player
    const interviewee = isCoach
      ? { name: interviewTeam ? interviewTeam.coach.name : 'the coach', role: 'coach', team: interviewTeamName }
      : { name: bestPlayer.name, role: 'player', position: bestPlayer.position || (interviewTeam ? ((interviewTeam.players.find(p => p.name === bestPlayer.name) || {}).position || '') : ''), team: interviewTeamName, goals: bestPlayer.goals || 0, assists: bestPlayer.assists || 0, grade: bestPlayer.grade || 0, saves: bestPlayer.saves || 0 }

    const opponentName = interviewTeamName === m.home ? m.away : m.home
    const teamGoals = interviewTeamName === m.home ? s[0] : s[1]
    const oppGoals = interviewTeamName === m.home ? s[1] : s[0]
    const isAway = interviewTeamName === m.away
    const teamPos = standings.findIndex(st => st.team === interviewTeamName) + 1
    const oppPos = standings.findIndex(st => st.team === opponentName) + 1
    const isUnderdog = teamPos > oppPos + 2
    const beatLeader = oppPos === 1 && winner === interviewTeamName
    // Contextual flags for enriched interview
    const ivIsDerby = derbyInfo.derby
    const ivDerbyReason = derbyInfo.reason
    const ivIsReigningChampTeam = reigningChamp && interviewTeamName === reigningChamp
    const ivFacingReigningChamp = reigningChamp && opponentName === reigningChamp
    const ivTeamTitles = titlesFor(interviewTeamName)
    const ivOppTitles = titlesFor(opponentName)
    const ivTeamForm = interviewTeamName === m.home ? homeForm : awayForm
    const ivTeamStreak = interviewTeamName === m.home ? homeStreak : awayStreak
    const ivOnStreak = ivTeamStreak && ivTeamStreak.count >= 3
    const ivHotWinStreak = ivOnStreak && ivTeamStreak.type === 'W'
    const ivBadLoseStreak = ivOnStreak && ivTeamStreak.type === 'L'
    const ivH2hMeetings = h2hRec.meetings
    const ivH2hLead = h2hRec.wA > h2hRec.wB ? m.home : h2hRec.wB > h2hRec.wA ? m.away : null
    const ivTeamTitleCount = ivTeamTitles.length
    const ivOppTitleCount = ivOppTitles.length
    const ivTitleRace = teamPos <= 3
    const ivRelegationFight = teamPos >= standings.length - 1

    // Question pool (contextual)
    const scoreDiff = teamGoals - oppGoals
    const totalMatchGoals = s[0] + s[1]
    const ivHighScoring = totalMatchGoals >= 7
    const ivLowScoring = totalMatchGoals <= 2
    const ivShutout = !isDraw && oppGoals === 0
    const hasHatTrick = interviewee.role === 'player' && interviewee.goals >= 3
    const hasBrace = interviewee.role === 'player' && interviewee.goals === 2

    const generalQs = [
      'What made the difference between these two teams today?',
      'How did the team\'s tactics work against ' + opponentName + '?',
      'How did the coach prepare you all before the match?',
      'How did the crowd affect the happenings on the pitch today?',
      'What are your preparations going to look like before facing your next opponent?',
      'How did you prepare mentally for this opponent?',
      'Any message you would like to convey to the fans watching at home?',
      'What can you say to this loud, magnificent crowd today?',
      'Everything seemed to start from the defense for your team today. Would you agree?',
      'Will you be returning next season, or are there thoughts about retirement?',
      'How would you rate the team\'s overall performance today?',
      'What does this result mean for the rest of the season?',
      'How important was the team chemistry out there today?',
      'Walk us through the key moment that decided this match.',
      'The atmosphere inside the stadium was electric today. Did you feel that on the pitch?',
      'What was the dressing room like before kickoff?',
      'Who in the squad deserves a special mention today?',
      'How do you keep the squad motivated through a long season like this?',
      'There seemed to be a lot of intensity in the first fifteen minutes. Was that deliberate?',
      'How much do results like this build confidence for the matches ahead?'
    ]
    const winQs = winner === interviewTeamName ? [
      'How effective was the pressure you seemed to heap over your opponents today?',
      'What did the coach say that brought about that inspiring quality of play?',
      teamGoals >= 4 ? 'How did it feel to put ' + teamGoals + ' goals past a strong defense like ' + opponentName + '\'s?' : null,
      isAway ? 'How special is it to win here, on ' + opponentName + '\'s home turf?' : null,
      isUnderdog ? 'How does it feel to beat this strong team as an underdog?' : null,
      beatLeader ? 'Was it extra special to beat the team placed number one in the league?' : null,
      'Would you consider your team a playoff-caliber team?',
      'Is this team good enough to win it all?',
      scoreDiff >= 3 ? 'The scoreline was quite dominant. Did you expect to win by this margin?' : null,
      scoreDiff === 1 ? 'It was tight until the end. How did you manage to hold on?' : null,
      ivShutout ? 'A clean sheet today \u2014 how satisfying is it to keep ' + opponentName + ' off the scoresheet?' : null,
      ivHighScoring ? 'It was an absolute goal fest out there. Did you sense early on it would be that kind of game?' : null,
      'At what point did you feel the match was won?',
      'The second half was completely different from the first. What changed?',
      isAway ? 'Taking three points on the road is never easy. How do you rate this away performance?' : null,
      !isAway ? 'The home form has been excellent. What makes this ground such a fortress?' : null
    ].filter(Boolean) : []
    const lossQs = winner && winner !== interviewTeamName ? [
      'Where do you think it went wrong today?',
      'The team conceded ' + oppGoals + ' goals. What needs to improve defensively?',
      'How do you pick the squad up after a result like this?',
      'Do you feel the scoreline reflected the balance of play?'
    ] : []
    const drawQs = isDraw ? [
      'Did the weather play a big role in your preparations today?',
      'Would you say the officiating had an impact on the result?',
      'A draw against ' + opponentName + ' \u2014 is that a fair result in your eyes?',
      'You came close to winning it at the end. How frustrating is it to only take a point?',
      ivLowScoring ? 'It was a tight, cagey affair. Is a point a good result here?' : null,
      ivHighScoring ? totalMatchGoals + ' goals and still a draw \u2014 how do you process a game like that?' : null,
      'Both teams had their chances. What was the turning point that prevented a winner?'
    ].filter(Boolean) : []
    const goalQs = interviewee.role === 'player' && interviewee.goals >= 1 ? [
      hasHatTrick ? 'A hat-trick! When did you realize it could be your day?' : null,
      hasHatTrick ? 'Three goals in one match \u2014 which one was your favorite?' : null,
      hasBrace ? 'Two goals today. Are you on track for the Golden Boot this season?' : null,
      hasBrace ? 'How wonderful was the build-up for the second goal?' : null,
      interviewee.goals === 1 ? 'Tell us about your goal today \u2014 walk us through the moment.' : null,
      'How did it feel to find the back of the net against ' + opponentName + '?',
      'The fans went wild when that goal went in. What was going through your mind?',
      'That finish was clinical. Is that something you practice regularly in training?'
    ].filter(Boolean) : []
    const assistQs = interviewee.role === 'player' && interviewee.assists >= 1 ? [
      interviewee.assists >= 2 ? 'Two assists today \u2014 you were the creative heartbeat of the team.' : 'That assist was a thing of beauty. Did you see the run developing?',
      'The connection between you and the forwards looked telepathic today. How do you build that understanding?'
    ] : []
    const saveQs = interviewee.role === 'player' && interviewee.saves >= 3 ? [
      'You made ' + interviewee.saves + ' saves today. Which one was the toughest?',
      'The defense looked rock solid today. How did you organize that backline?',
      interviewee.saves >= 5 ? 'An incredible ' + interviewee.saves + ' saves \u2014 you single-handedly kept the team in it.' : null,
      'There was one save in particular that had the whole stadium on its feet. Talk us through it.'
    ].filter(Boolean) : []
    const coachQs = interviewee.role === 'coach' ? [
      'What tactical adjustments did you make at halftime?',
      'How proud are you of the players\' performance today?',
      'What can you say about the wonderful game that your players had?',
      winner === interviewTeamName ? 'Was the game plan executed exactly as you envisioned?' : 'Where do you think it went wrong tactically?',
      'How did you set up the team to exploit ' + opponentName + '\'s weaknesses?',
      'Which player surprised you the most with their performance today?',
      'How do you manage the squad rotation with so many fixtures coming up?',
      'The substitutions seemed to change the game. Walk us through your thinking.',
      winner === interviewTeamName ? 'This is a big three points. Where does it put you in the title race?' : null,
      'What message did you give the players before they walked out of the tunnel?'
    ].filter(Boolean) : []

    // --- Rivalry/derby questions ---
    const rivalryQs = ivIsDerby ? [
      'A rivalry match against ' + opponentName + ' \u2014 how much extra does that mean to you and the fans?',
      ivDerbyReason === 'final-rematch' ? 'This was a rematch of the Season ' + derbyInfo.finalSeason + ' final. Did memories of that day play on anyone\'s mind?' : null,
      ivDerbyReason === 'semi-rematch' ? 'You last met ' + opponentName + ' in the Season ' + derbyInfo.semiSeason + ' semi-final. How much of that result lingered with the group?' : null,
      ivDerbyReason === 'long-standing' ? 'This fixture has a real edge to it now. What does it feel like walking out against ' + opponentName + '?' : null,
      ivH2hMeetings >= 4 ? 'In ' + ivH2hMeetings + ' meetings with ' + opponentName + ', these matches always seem to carry weight. What makes this fixture so intense?' : null,
      ivH2hLead && ivH2hLead !== interviewTeamName ? 'Historically ' + opponentName + ' have had your number in this fixture. Did that change the preparation?' : null,
      ivH2hLead === interviewTeamName ? 'You\'ve traditionally had the upper hand over ' + opponentName + '. Is there a psychological edge in these meetings?' : null,
      'When the supporters talk about rivalry fixtures, what do results like this mean to them?',
      'Bragging rights for the next few weeks \u2014 how sweet is that ' + (winner === interviewTeamName ? 'victory' : 'kind of occasion') + ' in a match like this?'
    ].filter(Boolean) : []

    // --- History/legacy questions ---
    const historyQs = [
      ivIsReigningChampTeam ? 'As reigning champions, every team comes at you with extra motivation. How do you deal with that pressure week in, week out?' : null,
      ivFacingReigningChamp ? 'You just played the reigning champions. What does a result like this tell you about your own level?' : null,
      ivTeamTitleCount >= 2 ? interviewTeamName + ' have lifted the trophy ' + ivTeamTitleCount + ' times. How does this current squad measure up to those title-winning sides?' : null,
      ivTeamTitleCount === 0 && pastSeasons.length >= 2 ? interviewTeamName + ' are still chasing that first piece of silverware. How close does this squad feel to ending the drought?' : null,
      ivOppTitleCount >= 2 ? 'You just faced a side with ' + ivOppTitleCount + ' ' + CONFIG.league.shortName + ' titles in the trophy cabinet. What did you learn from going toe-to-toe with ' + opponentName + '?' : null,
      mostDecorated && mostDecorated[0] === interviewTeamName ? 'You wear the badge of the league\'s most decorated club. Does that history inspire you or weigh on you?' : null,
      pastSeasons.length >= 3 ? 'Looking back across ' + pastSeasons.length + ' seasons of ' + CONFIG.league.shortName + ' football, where does a night like this rank?' : null,
      seasonNum >= 3 ? 'The ' + CONFIG.league.shortName + ' is a few seasons old now. How has the league evolved since you joined?' : null
    ].filter(Boolean)

    // --- Form/streak questions ---
    const formQs = [
      ivHotWinStreak ? ivTeamStreak.count + ' wins in a row now. What\'s clicking for this team right now?' : null,
      ivHotWinStreak && winner === interviewTeamName ? 'Another win, another ' + ivTeamStreak.count + '-match unbeaten run extended. Is there a danger of complacency?' : null,
      ivBadLoseStreak ? 'That\'s ' + ivTeamStreak.count + ' losses in a row. How does the group stop the bleeding?' : null,
      ivBadLoseStreak && winner !== interviewTeamName ? ivTeamStreak.count + ' straight defeats \u2014 what needs to change to turn this around?' : null,
      ivTeamForm && ivTeamForm.length >= 5 ? 'Looking at your last five results \u2014 ' + ivTeamForm.join('-') + ' \u2014 are you happy with where the team is trending?' : null,
      ivTeamForm && ivTeamForm.filter(r => r === 'W').length >= 4 ? 'The recent form has been outstanding. What\'s the secret sauce?' : null,
      ivTeamForm && ivTeamForm.filter(r => r === 'L').length >= 3 ? 'Recent results haven\'t been kind. Is the dressing room still believing?' : null
    ].filter(Boolean)

    // --- Title race / relegation questions (standings context) ---
    const standingsQs = [
      ivTitleRace && winner === interviewTeamName ? 'Sitting ' + ordinal(teamPos) + ' in the table after this win \u2014 is the title race officially on?' : null,
      ivTitleRace ? 'You\'re right in the thick of the title picture. How does the squad handle that kind of pressure?' : null,
      ivRelegationFight ? 'You find yourselves near the foot of the table. What\'s the mood in the dressing room?' : null,
      ivRelegationFight && winner === interviewTeamName ? 'A crucial win in a relegation battle. How big were these three points?' : null,
      beatLeader ? 'Beating the league leaders \u2014 does this make ' + interviewTeamName + ' the team to watch now?' : null,
      standings[0] && interviewTeamName === standings[0].team ? 'Top of the table tonight. How does it feel to look down at the rest of the league?' : null
    ].filter(Boolean)

    const allQs = [...generalQs, ...winQs, ...lossQs, ...drawQs, ...goalQs, ...assistQs, ...saveQs, ...coachQs, ...rivalryQs, ...historyQs, ...formQs, ...standingsQs]
    // Pick 2 different questions, preferring contextual ones
    const contextual = [...winQs, ...lossQs, ...drawQs, ...goalQs, ...assistQs, ...saveQs, ...coachQs, ...rivalryQs, ...historyQs, ...formQs, ...standingsQs]
    let q1, q2
    if (contextual.length >= 2) {
      q1 = pick(contextual)
      const remaining = contextual.filter(q => q !== q1)
      q2 = remaining.length ? pick(remaining) : pick(generalQs)
    } else if (contextual.length === 1) {
      q1 = contextual[0]
      q2 = pick(generalQs)
    } else {
      q1 = pick(generalQs)
      q2 = pick(generalQs.filter(q => q !== q1))
    }

    // Generate answers
    function genAnswer(question) {
      const name = interviewee.name
      const team = interviewee.team
      const isC = interviewee.role === 'coach'
      const pron = isC ? 'the lads' : 'we'
      const coachRef = isC ? 'I' : 'the coach'

      // Answer fragments pool
      const openers = ['Look,', 'Yeah,', 'Well,', 'Honestly,', 'You know,', 'I think', 'For sure,', 'Absolutely,', 'Listen,', 'To be honest,', 'It\'s simple,', 'What can I say,']
      const workEthic = ['everyone put in a shift today', 'the boys gave everything out there', 'it was a real team effort', 'we left everything on the pitch', 'every single player fought for the badge', 'the commitment from every player was immense', 'nobody hid out there today']
      const tactics = ['we stuck to the game plan', coachRef + ' had us well prepared', 'we knew exactly what to do', 'the tactical setup was perfect', 'we executed the plan to perfection', 'the homework we did on them paid off']
      const crowdLines = ['the fans were unbelievable today', 'you could feel the energy from the stands', 'the crowd pushed us over the line', 'hearing them sing gave us an extra gear', 'we couldn\'t have done it without the fans', 'that atmosphere was something special', 'the noise in there was incredible']
      const humbleLines = [opponentName + ' are a quality side', 'full respect to ' + opponentName, opponentName + ' made it very difficult for us', 'it\'s never easy against ' + opponentName, 'credit to ' + opponentName + ', they didn\'t make it easy']
      const futureLines = ['we\'ll take it one game at a time', 'we just focus on the next match', 'there\'s still a long way to go', 'we\'re not getting carried away', 'we\'ll recover and go again', 'the season is a marathon, not a sprint', 'we just keep our heads down and work']
      const goalFeeling = ['there\'s no better feeling than scoring', 'the ball just fell perfectly', 'I saw the gap and went for it', 'it\'s what I work on in training every day', 'I just tried to stay composed and pick my spot']
      const defenseLines = ['the back line was incredible today', 'we were organized and disciplined', 'everyone knew their defensive responsibilities', 'we hardly gave them a chance', 'the whole team defended as a unit']
      const coachPraises = ['the manager has been brilliant', coachRef + ' prepared us perfectly', coachRef + '\'s halftime talk changed everything', 'the tactical adjustments were spot on', coachRef + ' gave us a clear structure and we followed it']

      const o = pick(openers)

      // --- Match-result questions ---
      if (question.includes('difference between')) return o + ' ' + pick(workEthic) + '. ' + pick(humbleLines) + ', but ' + pron + ' wanted it more today. ' + pick(tactics) + ' and it paid off.'
      if (question.includes('tactics') || question.includes('tactic')) return o + ' ' + pick(tactics) + '. We knew ' + opponentName + ' like to play a certain way, and ' + coachRef + ' had a clear plan to deal with that. I think you saw the result on the pitch.'
      if (question.includes('pressure') || question.includes('heap')) return o + ' we knew we had to press them from the start. ' + pick(workEthic) + '. Once we got that early momentum, ' + opponentName + ' couldn\'t handle it.'
      if (question.includes('dominant') || question.includes('margin')) return o + ' honestly, we just came out and played our game. ' + pick(tactics) + '. I don\'t think any of us expected this margin, but once the goals started flowing, our confidence went through the roof.'
      if (question.includes('hold on') || question.includes('tight until')) return o + ' it was nervy at the end, no doubt. But ' + pick(defenseLines) + '. ' + pick(workEthic) + '. That last ten minutes felt like an hour, but ' + pron + ' dug deep.'
      if (question.includes('clean sheet') || question.includes('off the scoresheet')) return o + ' that\'s down to the whole team, not just the defense. ' + pick(defenseLines) + '. ' + (isC ? 'We drilled the defensive shape all week and the players delivered.' : 'From the striker pressing to the goalkeeper commanding \u2014 everyone played their part.') + ' Clean sheets win trophies.'
      if (question.includes('goal fest') || question.includes('that kind of game')) return o + ' you could tell from the warm-up that both teams came to attack. ' + pick(humbleLines) + '. It was end-to-end and ' + pick(crowdLines) + '. Thankfully we came out on the right side of it.'
      if (question.includes('match was won') || question.includes('point did you feel')) return o + ' in this league, nothing is decided until the final whistle. But I\'d say after ' + pick(['the third goal', 'our second goal', 'that key moment in the second half']) + ', we started to believe we had it. ' + pick(humbleLines) + ' though \u2014 they never stopped fighting.'
      if (question.includes('second half') && question.includes('changed')) return o + ' ' + (isC ? 'I told them a few things at halftime \u2014 small tweaks, really. We adjusted the pressing line and it opened up spaces.' : coachRef + ' made some crucial adjustments at the break. We came out with more intensity and it showed immediately.')
      if (question.includes('away performance') || question.includes('three points on the road')) return o + ' away wins are the hardest thing to get in this league. The traveling fans were immense \u2014 ' + pick(crowdLines.map(l => l.replace('the fans', 'our fans'))) + '. ' + pick(tactics) + ', and we showed great maturity to see the game out.'
      if (question.includes('fortress') || question.includes('home form')) return o + ' this is our pitch, our fans, our home. ' + pick(crowdLines) + '. Teams know it\'s a tough place to come. ' + pick(workEthic) + ', and the fans give us that extra ten percent.'

      // --- Crowd and atmosphere ---
      if (question.includes('crowd') || question.includes('fans') || question.includes('magnificent')) return o + ' ' + pick(crowdLines) + '. When you hear that noise, it lifts you to another level. This ' + (winner === team ? 'victory' : 'performance') + ' is for them.'
      if (question.includes('atmosphere') || question.includes('electric')) return o + ' ' + pick(crowdLines) + '. There were moments where the roar from the stands gave me goosebumps. That\'s what football is all about. ' + pick(workEthic) + ' because we didn\'t want to let them down.'
      if (question.includes('dressing room') && question.includes('before')) return o + ' it was focused, calm. ' + (isC ? 'I kept the talk short \u2014 the players knew what they had to do.' : coachRef + ' kept it simple. There was a quiet confidence.') + ' Everyone was ready. You could see it in their eyes.'

      // --- Home turf / underdog / top team ---
      if (question.includes('home turf') || question.includes('special')) return o + ' winning away is always tough, especially here. ' + pick(humbleLines) + ', but ' + pron + ' showed real character. ' + pick(crowdLines.map(l => l.replace('the fans', 'our traveling fans'))) + '.'
      if (question.includes('underdog')) return o + ' people can say what they want about rankings. ' + pick(workEthic) + ' and ' + pron + ' proved that on any given day, we can beat anyone. ' + pick(futureLines) + '.'
      if (question.includes('number one') || question.includes('leader')) return o + ' beating the league leaders is always a statement. But ' + pick(humbleLines) + '. ' + pick(workEthic) + ' and today, ' + pron + ' were the better team.'

      // --- Goal-related ---
      if (question.includes('hat-trick') && question.includes('favorite')) return o + ' honestly, they were all special. But if I had to pick one, probably the ' + pick(['first', 'second', 'third']) + '. The timing, the crowd reaction \u2014 everything about that moment was perfect.'
      if (question.includes('hat-trick') && question.includes('your day')) return o + ' after the second goal, my teammates kept saying \'go get your hat-trick!\' ' + pick(goalFeeling) + '. When the third went in, the feeling was indescribable. ' + pick(crowdLines) + '.'
      if (question.includes('Golden Boot')) return o + ' individual awards are nice, but ' + pick(futureLines) + '. The most important thing is the team winning. If the goals keep coming, great, but I\'m not counting.'
      if (question.includes('build-up') && question.includes('second goal')) return o + ' that was textbook. The movement off the ball was incredible \u2014 ' + pick(tactics) + '. When you play like that, goals are going to come.'
      if (question.includes('walk us through') && question.includes('goal')) return o + ' it happened so fast. I remember the ball coming across, I got into space, and I just hit it. ' + pick(goalFeeling) + '. The celebration with the lads afterward was special too.'
      if (question.includes('goal') && question.includes('feel')) return o + ' ' + pick(goalFeeling) + '. ' + (interviewee.goals >= 2 ? 'To score ' + interviewee.goals + ' in one match is something I\'ll always remember. ' : '') + pick(workEthic) + ', and I\'m just happy to contribute.'
      if (question.includes('fans went wild') || (question.includes('goal') && question.includes('mind'))) return o + ' pure adrenaline! I don\'t even remember running to the corner flag. ' + pick(crowdLines) + '. Moments like that are why you play this game.'
      if (question.includes('clinical') || question.includes('practice')) return o + ' ' + (isC ? 'we work on finishing every single day in training. It\'s paying off.' : 'I stay after training most days to work on my finishing. ' + coachRef + ' always says preparation meets opportunity, and today it all came together.')
      if (question.includes('wonderful') && question.includes('pass')) return o + ' that was a beautiful moment. The link-up play was fantastic \u2014 ' + pick(tactics) + ', and when the ball came through, I just had to finish it.'

      // --- Assist-related ---
      if (question.includes('assist') && question.includes('beauty')) return o + ' I saw the run developing and just tried to put it in the right area. Credit to the striker for a brilliant finish. That\'s the connection ' + coachRef + ' wants us to build.'
      if (question.includes('telepathic') || question.includes('understanding')) return o + ' we spend hours on the training pitch working on that link-up play. It\'s about knowing where your teammate is going to be before they get there. Today it all clicked.'
      if (question.includes('creative heartbeat')) return o + ' I just try to find pockets of space and create for others. When you have runners like we do, my job becomes a lot easier. The whole team made it possible.'

      // --- Defense / GK ---
      if (question.includes('defense') || question.includes('backline') || question.includes('start from the defense')) return o + ' ' + pick(defenseLines) + '. ' + (isC ? 'I always say clean sheets win championships.' : 'The goalkeeper was immense too.') + ' ' + pick(futureLines) + '.'
      if (question.includes('saves') || question.includes('toughest')) return o + ' I don\'t really think about individual saves during the game. ' + pick(defenseLines) + '. The one in the ' + pick(['first half', 'second half', 'dying minutes']) + ' was probably the trickiest, but it\'s all instinct and positioning at that point.'
      if (question.includes('single-handedly') || question.includes('kept the team in it')) return o + ' that\'s kind of you to say, but it\'s a team effort. ' + pick(defenseLines) + '. I\'m just doing my job. The defenders put their bodies on the line too.'
      if (question.includes('stadium on its feet') && question.includes('save')) return o + ' that one was pure reflex, to be honest. I saw the shot late, got a strong hand to it. ' + pick(crowdLines) + '. Moments like that, the adrenaline takes over.'

      // --- Preparation / Mental ---
      if (question.includes('prepare') && question.includes('mental')) return o + ' ' + (isC ? 'I showed the lads video analysis and we worked on specific scenarios all week.' : pick(coachPraises) + '. We studied ' + opponentName + '\'s patterns and came in with a clear mind.') + ' ' + pick(futureLines) + '.'
      if (question.includes('preparations') || question.includes('next opponent')) return o + ' ' + pick(futureLines) + '. We\'ll enjoy this result tonight, but tomorrow it\'s back to work. Every match in this league is tough.'

      // --- Coach questions ---
      if (question.includes('coach say') || (question.includes('halftime') && !question.includes('second half'))) return o + ' ' + (isC ? 'I told the players to keep their shape and trust the process. A few small adjustments made a big difference.' : pick(coachPraises) + '. ' + coachRef + ' told us to stay calm and the goals would come. And they did.')
      if (question.includes('tactical adjustments')) return o + ' ' + (isC ? 'we tweaked the midfield shape and asked the full-backs to push higher. The players responded brilliantly.' : coachRef + ' made a couple of changes that completely shifted the momentum. The man deserves huge credit.')
      if (question.includes('exploit') && question.includes('weakness')) return o + ' I\'m not going to give away all our secrets! But we watched a lot of footage and identified areas where we could cause problems. ' + pick(tactics) + '.'
      if (question.includes('surprised') && question.includes('performance')) return o + ' honestly, I wasn\'t surprised \u2014 I see these players in training every day. But ' + pick(['the intensity', 'the quality', 'the composure']) + ' they showed today was outstanding. I\'m very proud.'
      if (question.includes('rotation') || question.includes('fixtures coming')) return o + ' we have a deep squad and I trust every player in it. Rotation isn\'t about resting people, it\'s about keeping everyone sharp. Everyone has a role and they know it.'
      if (question.includes('substitution')) return o + ' ' + (isC ? 'I felt the game needed fresh legs and a different energy. The subs came on and made an immediate impact \u2014 that\'s what squad depth gives you.' : 'the substitutions gave us new energy. The players who came on were brilliant \u2014 they changed the game.')
      if (question.includes('title race') && question.includes('three points')) return o + ' every three points matters in this league. ' + pick(futureLines) + '. But yes, nights like this are what the title race is all about.'
      if (question.includes('tunnel') || question.includes('walked out')) return o + ' I kept it simple: \'Play for each other, play for the badge, and leave nothing out there.\' Sometimes the best messages are the shortest ones.'

      // --- Playoff / ambition ---
      if (question.includes('playoff') || question.includes('caliber')) return o + ' ' + pick(workEthic) + '. If we keep performing like this, who knows? ' + pick(futureLines) + ', but I believe in this squad.'
      if (question.includes('win it all') || question.includes('good enough')) return o + ' I\'d be lying if I said we don\'t dream about it. But ' + pick(futureLines) + '. ' + pick(workEthic) + ', and that\'s all you can ask.'

      // --- Draw-specific ---
      if (question.includes('weather')) return o + ' it was tricky conditions out there, but both teams had to deal with it. ' + pick(workEthic) + ' regardless of the weather.'
      if (question.includes('officiating') || question.includes('referee')) return o + ' I don\'t want to talk too much about the officials. ' + pick(workEthic) + ', and in the end, the result speaks for itself.'
      if (question.includes('fair result')) return o + ' ' + pick(humbleLines) + '. A point is a point. ' + pron + ' ' + pick(['will take it', 'can build on this', 'showed good character']) + '. ' + pick(futureLines) + '.'
      if (question.includes('close to winning') || question.includes('frustrating')) return o + ' of course it\'s frustrating when you\'re that close. But ' + pick(humbleLines) + '. ' + pron + ' created enough chances to win it, and that\'s a positive to take forward.'
      if (question.includes('cagey') || question.includes('tight')) return o + ' in a game like that, one mistake can decide it. ' + pick(defenseLines) + '. A point away from home \u2014 ' + pick(futureLines) + '.'
      if (question.includes('process a game')) return o + ' it\'s tough to take when you score ' + teamGoals + ' goals and still don\'t win. But ' + pick(humbleLines) + '. We need to shore things up at the back, but the attacking intent was there.'
      if (question.includes('turning point') || question.includes('prevented a winner')) return o + ' there were moments where either team could have nicked it. ' + (isC ? 'I think their equalizer shifted the momentum.' : 'a couple of key moments didn\'t go our way.') + ' But that\'s football \u2014 ' + pick(futureLines) + '.'

      // --- Loss-specific ---
      if (question.includes('went wrong')) return o + ' we didn\'t execute our plan well enough. ' + pick(humbleLines) + '. We\'ll analyze the footage and learn from this. ' + pick(futureLines) + '.'
      if (question.includes('conceded') && question.includes('improve')) return o + ' ' + oppGoals + ' goals is too many, simple as that. We need to be tougher to break down. The effort was there, but ' + pick(['the concentration dropped at key moments', 'we switched off at the wrong times', 'we made it too easy for them']) + '.'
      if (question.includes('pick the squad up')) return o + ' this group has character. ' + (isC ? 'I trust these players completely.' : 'we\'ve bounced back before and we\'ll do it again.') + ' One bad result doesn\'t define a season. ' + pick(futureLines) + '.'
      if (question.includes('scoreline reflect')) return o + ' honestly, I think we were in the game for long stretches. ' + pick(humbleLines) + '. But the margins went against us today. ' + pick(futureLines) + '.'

      // --- General / personality ---
      if (question.includes('retirement') || question.includes('returning')) return o + ' I\'m fully focused on the rest of this season. ' + pick(futureLines) + '. We\'ll see what happens after that, but right now, ' + team + ' is all that matters to me.'
      if (question.includes('proud') || question.includes('wonderful game')) return o + ' immensely proud. ' + pick(workEthic) + '. Every single one of them put in a shift, and as a ' + (isC ? 'coach' : 'teammate') + ', that\'s all you can ask for.'
      if (question.includes('game plan') || question.includes('envisioned')) return o + ' ' + (winner === team ? 'pretty much, yes. ' + pick(tactics) + '. Of course, you always have to adapt, but the foundation was solid.' : 'not entirely. ' + pick(humbleLines) + '. We\'ll analyze this and come back stronger.')
      if (question.includes('message') || question.includes('convey')) return o + ' just a massive thank you to the fans. ' + pick(crowdLines) + '. ' + pick(futureLines) + ', and we\'ll keep fighting for this badge.'
      if (question.includes('overall performance') || question.includes('rate')) return o + ' I\'d give us a ' + pick(['seven', 'seven and a half', 'solid eight']) + ' out of ten. ' + pick(workEthic) + '. There\'s always room to improve, but the foundations are there.'
      if (question.includes('rest of the season')) return o + ' ' + (winner === team ? 'results like this give you belief.' : 'we have to keep grinding.') + ' ' + pick(futureLines) + '. In this league, anything can happen.'
      if (question.includes('team chemistry') || question.includes('chemistry')) return o + ' the bond in this squad is special. ' + (isC ? 'From the first day of preseason, I wanted to build a family, not just a team.' : 'we spend so much time together, on and off the pitch.') + ' That chemistry shows when it matters.'
      if (question.includes('key moment') || question.includes('decided this match')) return o + ' I think ' + pick(['the opening goal changed everything', 'that moment in the second half was pivotal', 'the spell just before halftime was crucial']) + '. ' + pick(tactics) + ', and when that moment came, ' + pron + ' were ready.'
      if (question.includes('special mention') || question.includes('who in the squad')) return o + ' I don\'t want to single anyone out because ' + pick(workEthic) + '. But if you push me, ' + pick(['the center-backs were immense', 'the midfield ran the show', 'the goalkeeper made some huge saves', 'the strikers were clinical']) + '.'
      if (question.includes('motivated') || question.includes('long season')) return o + ' ' + (isC ? 'competition for places keeps everyone sharp. When you have a squad this talented, nobody can afford to take their foot off the gas.' : 'we push each other every day in training. No one\'s place is guaranteed, and that drives the standards up.') + ' ' + pick(futureLines) + '.'
      if (question.includes('intensity') && question.includes('fifteen minutes')) return o + ' ' + (isC ? 'absolutely. I told the players to set the tone from the first whistle. If you let the opponent settle, it becomes much harder.' : 'that\'s something ' + coachRef + ' drills into us. Start fast, don\'t give them time to breathe.') + ' ' + pick(workEthic) + '.'
      if (question.includes('confidence') || question.includes('build')) return o + ' massively. Results breed confidence, and ' + pick(workEthic) + '. When you\'re winning and playing well, everything feels easier. But ' + pick(futureLines) + '.'

      // --- Rivalry / derby ---
      if (question.includes('rivalry') || question.includes('bragging rights')) return o + ' these games mean everything to the fans, and when it means something to them, it means something to us. ' + pick(workEthic) + '. Occasions like this are why you play football.'
      if (question.includes('final') && question.includes('rematch')) return o + ' of course those memories linger. Some of the lads who were there still carry that feeling. ' + (winner === team ? 'Today was a chance to write a new chapter, and we took it.' : 'We wanted to set the record straight, and we came up short. That one will sting.') + ' ' + pick(futureLines) + '.'
      if (question.includes('semi-final') && question.includes('linger')) return o + ' playoff football leaves scars. ' + pick(humbleLines) + ', and we respected what they did to us back then. ' + (winner === team ? 'Redemption doesn\'t fully exist in this sport, but tonight felt close.' : 'We needed to show we had learned. The work continues.')
      if (question.includes('fixture has a real edge') || question.includes('walking out against')) return o + ' the moment you see the fixtures come out, this is the one you circle. The atmosphere, the stakes, the history. ' + pick(crowdLines) + '. You can\'t replicate it.'
      if (question.includes('meetings with') || question.includes('intense')) return o + ' we\'ve played them so often now that every encounter adds a new layer. Both sides know each other inside out \u2014 it comes down to who handles the moments better.'
      if (question.includes('had your number') || question.includes('psychological edge')) return o + ' there\'s no such thing as a curse in football. ' + pick(workEthic) + '. You wipe the slate clean every time and focus on what you can control.'
      if (question.includes('upper hand over')) return o + ' records are records, and we\'re proud of the history. But the opposition don\'t care about the past \u2014 they come out fighting. Every meeting you earn from scratch.'
      if (question.includes('supporters talk about rivalry') || question.includes('results like this mean')) return o + ' the fans live and breathe these games. ' + pick(crowdLines) + '. ' + (winner === team ? 'Seeing their faces after a win like this \u2014 that\'s the reward.' : 'They deserve better and we know it. We owe them.')

      // --- History / legacy ---
      if (question.includes('reigning champions') && question.includes('pressure')) return o + ' wearing the crown means everyone raises their game against you. We embrace that. ' + pick(workEthic) + ', and the target on our back just sharpens our focus.'
      if (question.includes('reigning champions') && question.includes('own level')) return o + ' going toe-to-toe with the champions tells you where you stand. ' + (winner === team ? 'We matched them, and in some moments, we were the better side. That\'s a statement.' : 'We got a real measuring stick today. There\'s work to do, but we weren\'t a million miles off.')
      if (question.includes('times') && question.includes('trophy cabinet')) return o + ' you can\'t compare eras \u2014 every generation writes its own story. ' + (isC ? 'But this group is hungry, and I believe they\'re capable of their own special chapter.' : 'We respect the history, but we\'re trying to build something of our own.')
      if (question.includes('first piece of silverware') || question.includes('trophy drought')) return o + ' the silverware is always the goal, but you can\'t skip steps. ' + pick(workEthic) + '. If we keep performing like this, one day soon, the trophy will come.'
      if (question.includes('learned from going toe-to-toe')) return o + ' against the best teams you learn quickly what level you\'re at. ' + pick(humbleLines) + '. We take the lessons and we grow.'
      if (question.includes('most decorated') || question.includes('inspire you or weigh')) return o + ' this badge comes with expectations, and rightly so. ' + (isC ? 'We don\'t hide from that \u2014 we use it as fuel.' : 'Every day you pull this shirt on, you feel the weight and the privilege in equal measure.')
      if (question.includes('seasons of') && question.includes('rank')) return o + ' there have been some unforgettable nights in this league. ' + (winner === team ? 'This one goes right up there. A performance to remember.' : 'It\'s tough to process right now, but in time we\'ll see where it fits.')
      if (question.includes('league evolved') || question.includes('seasons old')) return o + ' the standard rises every year. Teams are better coached, the players are fitter, the margins are thinner. You cannot stand still or you get left behind.'

      // --- Form / streak ---
      if ((question.includes('row') && question.includes('clicking')) || question.includes('unbeaten run extended')) return o + ' when everyone is on the same page, football becomes simpler. ' + pick(workEthic) + '. We stay humble, keep our heads down, and attack the next one the same way.'
      if (question.includes('complacency')) return o + ' complacency is the enemy of everything we\'re building. ' + (isC ? 'I remind the lads daily \u2014 a winning run is nothing without the next result.' : coachRef + ' won\'t let us get comfortable. As soon as you think you\'ve cracked it, the league bites back.')
      if (question.includes('losses in a row') || question.includes('stop the bleeding') || question.includes('defeats') && question.includes('change')) return o + ' we go back to basics. ' + pick(workEthic) + '. Runs like this are tests of character, and I trust this group to come through.'
      if (question.includes('last five results') || question.includes('team is trending')) return o + ' form is a strange thing \u2014 it can flip quickly in either direction. ' + pick(workEthic) + '. We focus on performance, and results tend to follow.'
      if (question.includes('secret sauce')) return o + ' there\'s no secret. ' + pick(tactics) + ', we work harder than anyone, and we back each other. Simple as that.'
      if (question.includes('still believing') || question.includes('recent results haven\'t been kind')) return o + ' one hundred percent. ' + (isC ? 'I see the work they put in every day \u2014 the belief is there.' : 'The dressing room is as tight as ever. That\'s how you come through rough patches.')

      // --- Title race / relegation ---
      if (question.includes('title race officially on') || question.includes('title picture')) return o + ' you earn the right to be in the conversation. ' + pick(workEthic) + ', and we\'re in there swinging. ' + pick(futureLines) + '.'
      if (question.includes('foot of the table') || question.includes('mood in the dressing room')) return o + ' you can\'t hide from where we are. ' + (isC ? 'But there\'s fight in this group, and I see it every day.' : 'We\'re going to scrap for every point. Nobody\'s rolling over.')
      if (question.includes('relegation battle') || question.includes('crucial win')) return o + ' these points are worth their weight in gold. ' + pick(workEthic) + '. We celebrate tonight and then it\'s straight back to work.'
      if (question.includes('team to watch')) return o + ' labels don\'t interest us \u2014 consistency does. ' + pick(futureLines) + '. If we keep performing, let the rest of the league worry about us.'
      if (question.includes('top of the table') || question.includes('look down')) return o + ' it\'s a nice snapshot, but that\'s all it is \u2014 a snapshot. ' + pick(futureLines) + '. Trophies are won in May, not in the middle of the season.'

      // Fallback
      return o + ' ' + pick(workEthic) + '. ' + pick(humbleLines) + '. ' + pick(futureLines) + '.'
    }

    const interview = {
      interviewee: interviewee.name,
      role: interviewee.role === 'coach' ? 'Head Coach' : (interviewee.position || 'Player'),
      team: interviewee.team,
      questions: [
        { q: q1, a: genAnswer(q1) },
        { q: q2, a: genAnswer(q2) }
      ]
    }

    return {
      home: m.home, away: m.away, score: s,
      venue: homeVenue,
      title,
      body: para1 + '\n\n' + para2 + '\n\n' + para3 + (para4 && para4.trim() ? '\n\n' + para4 : ''),
      interview
    }
  })

  // MOTM reason
  let motmReason = motm.name + ' delivered a commanding performance'
  if (motm.goals >= 2) motmReason = 'A stunning ' + motm.goals + '-goal haul made ' + motm.name + ' the obvious choice'
  else if (motm.goals >= 1 && motm.assists >= 1) motmReason = motm.name + ' contributed ' + motm.goals + ' goal' + (motm.goals > 1 ? 's' : '') + ' and ' + motm.assists + ' assist' + (motm.assists > 1 ? 's' : '') + ' in a complete performance'
  else if (motm.saves >= 6) motmReason = motm.name + ' pulled off ' + motm.saves + ' saves in a goalkeeping masterclass'
  else if (motm.grade >= 4.5) motmReason = 'With a near-perfect rating of ' + motm.grade.toFixed(1) + ', ' + motm.name + ' was head and shoulders above everyone else'
  motmReason += ' for ' + motm.team + '.'

  // By the numbers
  const byTheNumbers = [
    totalGoals + ' \u2014 Total goals scored across Matchday ' + mdNum,
    avgGoals + ' \u2014 Average goals per match this matchday',
    draws.length + ' of ' + matches.length + ' matches ended in draws'
  ]
  if (topScorers.length) byTheNumbers.push(topScorers[0].name + ' leads the Golden Boot race with ' + (topScorers[0].goals || 0) + ' goals this season')
  // History-flavored stats
  if (reigningChamp) {
    const champStanding = standings.find(st => st.team === reigningChamp)
    if (champStanding) byTheNumbers.push('Reigning champions ' + reigningChamp + ' sit ' + ordinal(standings.findIndex(st => st.team === reigningChamp) + 1) + ' with ' + (champStanding.points || 0) + ' points')
  }
  if (mostDecorated && mostDecorated[1] >= 2) byTheNumbers.push(mostDecorated[0] + ' \u2014 the league\'s most decorated side with ' + mostDecorated[1] + ' titles')
  // Biggest margin this matchday
  let biggestMargin = null
  for (const mm of matches) {
    const ss = [mm.score && mm.score[0] || 0, mm.score && mm.score[1] || 0]
    const diff = Math.abs(ss[0] - ss[1])
    if (!biggestMargin || diff > biggestMargin.diff) biggestMargin = { diff, match: mm, score: ss }
  }
  if (biggestMargin && biggestMargin.diff >= 3) byTheNumbers.push('Biggest margin: ' + biggestMargin.match.home + ' ' + biggestMargin.score[0] + '-' + biggestMargin.score[1] + ' ' + biggestMargin.match.away)
  // Leader's lead
  if (standings.length >= 2) {
    const gap = (standings[0].points || 0) - (standings[1].points || 0)
    if (gap > 0) byTheNumbers.push(standings[0].team + ' lead ' + standings[1].team + ' by ' + gap + ' point' + (gap === 1 ? '' : 's') + ' at the summit')
    else byTheNumbers.push(standings[0].team + ' and ' + standings[1].team + ' are level on points at the top')
  }

  // Look ahead
  const champHook = reigningChamp && standings[0] && standings[0].team !== reigningChamp
    ? ' Reigning champions ' + reigningChamp + ' will be desperate to reassert themselves.'
    : ''
  const historyHook = mostDecorated && mostDecorated[1] >= 2 && standings[0] && standings[0].team !== mostDecorated[0]
    ? ' Meanwhile, ' + mostDecorated[0] + ' \u2014 a name synonymous with ' + CONFIG.league.shortName + ' silverware \u2014 know this kind of run is exactly when the old guard reminds the league of their pedigree.'
    : ''
  const seasonStageHook = seasonNum && seasonNum >= 3 ? ' Season ' + seasonNum + ' is shaping up to be one of the most unpredictable yet.' : ''
  const lookAheadTemplates = [
    'As the dust settles on Matchday ' + mdNum + ', ' + leader.team + ' will sleep soundly at the top with ' + (leader.points || 0) + ' points. But with ' + (standings.length ? (standings[0].played ? (league.teams.length - 1) - standings[0].played : 'many') : 'many') + ' matchdays still to play, nothing is decided. ' + bottom.team + ' know they must start picking up points soon, while the chasing pack will be sharpening their claws.' + champHook + ' The ' + CONFIG.league.shortName + ' waits for no one.',
    'Matchday ' + mdNum + ' may be over, but its reverberations will be felt for weeks to come. ' + leader.team + ' march on at the summit, but ' + second.team + ' remain within striking distance. At the bottom, ' + bottom.team + ' face an increasingly anxious run of fixtures.' + historyHook + ' One thing is certain: this ' + CONFIG.league.shortName + ' season is far from over.' + seasonStageHook,
    'The table never lies, they say \u2014 but in the ' + CONFIG.league.shortName + ', it certainly whispers. ' + leader.team + ' hold the advantage for now, but the margins are razor-thin. Every point will matter from here on out, and if Matchday ' + mdNum + ' taught us anything, it\'s that this league always has one more twist in store.' + champHook,
    'The fixture list offers no mercy. Matchday ' + (mdNum + 1) + ' looms, and every side \u2014 from ' + leader.team + ' at the summit to ' + bottom.team + ' at the foot of the table \u2014 knows that in the ' + CONFIG.league.shortName + ', momentum is currency and complacency is fatal.' + historyHook,
    'Talking points aplenty from Matchday ' + mdNum + ': ' + leader.team + ' setting the pace on ' + (leader.points || 0) + ' points, ' + bottom.team + ' staring at the drop, and a chasing pack led by ' + second.team + ' refusing to let this title race become a procession.' + champHook + seasonStageHook
  ]

  return {
    headline,
    subheadline: pick(subTemplates),
    lede: pick(ledeTemplates),
    matchReports,
    manOfMatchday: { name: motm.name, team: motm.team, reason: motmReason },
    byTheNumbers,
    lookAhead: pick(lookAheadTemplates)
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

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

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

// Generate goal events for a team (shared by simulate and manual entry)
function generateGoalEvents(team, goalsFor) {
  const players = team.players.slice(0, 6)
  const outfield = players.filter(p => p.position !== 'GK')
  const events = []

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

// Generate player stats for a team (shared by simulate and manual entry)
function genPlayerStats(team, goalEvents, goalsFor, goalsAgainst) {
  const stats = []
  const players = team.players.slice(0, 6)

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

function simulateMatchWithEngine(homeTeam, awayTeam, leagueData) {
  const league = leagueData || readJSON('league.json')
  const home = league.teams.find(t => t.name === homeTeam)
  const away = league.teams.find(t => t.name === awayTeam)
  if (!home || !away) return null
  if (!home.players.length || !away.players.length) return null

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

  // Valid scores: 5-0..5-3 (first-to-5), 5-4/4-5 NOT valid,
  // extended after 4-4: 6-4 (2-goal lead wins) or 5-5 (draw)
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
      // Extended: 5-5 draw, or 6-4 (need 2-goal lead to win)
      if (g1 === 5 && g2 === 5) break         // 5-5 draw
      if (g1 === 6 && g2 === 4) break         // 6-4 win
      if (g2 === 6 && g1 === 4) break         // 4-6 win
    }
  }

  // Safety: enforce valid final score
  if (g1 < 5 && g2 < 5) { if (g1 >= g2) g1 = 5; else g2 = 5 }
  if (g1 >= 4 && g2 >= 4) {
    // Cap at valid extended scores: 5-5, 6-4, 4-6
    if (g1 > 6) g1 = 6; if (g2 > 6) g2 = 6
    // 5-4 / 4-5 not valid — push to 5-5
    if ((g1 === 5 && g2 === 4) || (g1 === 4 && g2 === 5)) {
      if (g1 < g2) g1 = 5; else g2 = 5 // make it 5-5
    }
    // 6-5 / 5-6 not valid — push to 5-5
    if ((g1 === 6 && g2 === 5) || (g1 === 5 && g2 === 6)) {
      g1 = 5; g2 = 5
    }
    // 6-6 not valid — push to 5-5
    if (g1 === 6 && g2 === 6) { g1 = 5; g2 = 5 }
  }
  if (g1 > 6) g1 = 6; if (g2 > 6) g2 = 6

  const homeGoalEvents = generateGoalEvents(home, g1)
  const awayGoalEvents = generateGoalEvents(away, g2)
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

    const league = readJSON('league.json')
    const home = league.teams.find(t => t.name === match.home)
    const away = league.teams.find(t => t.name === match.away)
    const g1 = body.score[0], g2 = body.score[1]

    // Generate goal events and player stats even for manual scores
    const homeGoalEvents = home ? generateGoalEvents(home, g1) : []
    const awayGoalEvents = away ? generateGoalEvents(away, g2) : []
    const homeStats = home ? genPlayerStats(home, homeGoalEvents, g1, g2) : null
    const awayStats = away ? genPlayerStats(away, awayGoalEvents, g2, g1) : null

    match.status = 'completed'
    match.score = [g1, g2]
    match.method = 'manual'
    match.playerStats = homeStats && awayStats ? { home: homeStats, away: awayStats } : null
    match.playerGrades = homeStats && awayStats ? {
      home: homeStats.map(p => ({ name: p.name, grade: p.grade })),
      away: awayStats.map(p => ({ name: p.name, grade: p.grade }))
    } : null
    match.goalEvents = { home: homeGoalEvents, away: awayGoalEvents }
    writeJSON('schedule.json', schedule)
    updateHistory(match.home, match.away, g1, g2, homeStats, awayStats)

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

  // --- Playoffs ---
  if (pathname === '/api/init-playoffs' && req.method === 'POST') {
    const schedule = readJSON('schedule.json')
    if (schedule.playoffs) return jsonRes(res, { error: 'Playoffs already initialized' }, 400)
    // Check all regular season matches are completed
    const allPlayed = schedule.matchdays.every(md => md.matches.every(m => m.status === 'completed'))
    if (!allPlayed) return jsonRes(res, { error: 'Regular season not complete' }, 400)
    // Build standings using shared helper
    const sorted = buildStandingsFromSchedule(schedule)
    const top8 = sorted.slice(0, 8)
    // QF bracket: 1v8, 2v7, 3v6, 4v5 (best of 3)
    const qfPairs = [[0,7],[1,6],[2,5],[3,4]]
    schedule.playoffs = {
      quarterFinals: qfPairs.map(([hi, lo]) => ({
        higherSeed: top8[hi].team, lowerSeed: top8[lo].team,
        seedNums: [hi + 1, lo + 1],
        games: [], winner: null, seriesScore: null
      })),
      semiFinals: [
        { team1: null, team2: null, score: null, winner: null, venue: 'neutral', qfSources: [0, 1] },
        { team1: null, team2: null, score: null, winner: null, venue: 'neutral', qfSources: [2, 3] }
      ],
      final: { team1: null, team2: null, score: null, winner: null, captain: null, venue: 'neutral' },
      champion: null
    }
    writeJSON('schedule.json', schedule)
    return jsonRes(res, { success: true, playoffs: schedule.playoffs })
  }

  if (pathname.startsWith('/api/simulate-playoff/') && req.method === 'POST') {
    const parts = pathname.split('/')
    const round = parts[3]  // 'qf', 'sf', 'final'
    const matchIdx = parseInt(parts[4], 10)
    const schedule = readJSON('schedule.json')
    if (!schedule.playoffs) return jsonRes(res, { error: 'Playoffs not initialized' }, 400)
    const po = schedule.playoffs

    // Helper: simulate a playoff match — no draws allowed (penalty shootout tiebreaker)
    function simPlayoffMatch(homeTeam, awayTeam) {
      let result = simulateMatchWithEngine(homeTeam, awayTeam)
      if (!result) return null
      // If draw (5-5), break the tie: re-simulate up to 3 times, then give it to home team
      let tries = 0
      while (result.score[0] === result.score[1] && tries < 3) {
        result = simulateMatchWithEngine(homeTeam, awayTeam)
        tries++
      }
      if (result.score[0] === result.score[1]) {
        // Penalty shootout: randomly give +1 goal to one side
        if (Math.random() < 0.5) result.score[0]++
        else result.score[1]++
        result.penaltyWinner = result.score[0] > result.score[1] ? homeTeam : awayTeam
      }
      return result
    }

    if (round === 'qf') {
      const series = po.quarterFinals[matchIdx]
      if (!series) return jsonRes(res, { error: 'Invalid QF index' }, 400)
      if (series.winner) return jsonRes(res, { error: 'Series already decided' }, 400)
      // Determine who is home: game 1 = higher seed home, game 2 = lower seed home, game 3 = higher seed home
      const gameNum = series.games.length
      if (gameNum >= 3) return jsonRes(res, { error: 'Series already has 3 games' }, 400)
      const home = (gameNum === 1) ? series.lowerSeed : series.higherSeed
      const away = (gameNum === 1) ? series.higherSeed : series.lowerSeed
      const result = simPlayoffMatch(home, away)
      if (!result) return jsonRes(res, { error: 'Simulation failed' }, 500)
      series.games.push({ home, away, score: result.score, penaltyWinner: result.penaltyWinner || null, playerStats: { home: result.homePlayerStats, away: result.awayPlayerStats }, goalEvents: result.goalEvents })
      // Check series result
      let hWins = 0, lWins = 0
      for (const g of series.games) {
        const hHome = g.home === series.higherSeed
        const hScore = hHome ? g.score[0] : g.score[1]
        const lScore = hHome ? g.score[1] : g.score[0]
        if (hScore > lScore) hWins++
        else if (lScore > hScore) lWins++
        // draws don't count toward series wins
      }
      if (hWins >= 2) { series.winner = series.higherSeed; series.seriesScore = hWins + '-' + lWins }
      else if (lWins >= 2) { series.winner = series.lowerSeed; series.seriesScore = lWins + '-' + hWins }
      // If series decided, populate SF
      if (series.winner) {
        for (const sf of po.semiFinals) {
          if (sf.qfSources.includes(matchIdx)) {
            if (!sf.team1) sf.team1 = series.winner
            else if (!sf.team2) sf.team2 = series.winner
          }
        }
      }
      writeJSON('schedule.json', schedule)
      return jsonRes(res, { success: true, playoffs: po })
    }

    if (round === 'sf') {
      const sf = po.semiFinals[matchIdx]
      if (!sf) return jsonRes(res, { error: 'Invalid SF index' }, 400)
      if (sf.winner) return jsonRes(res, { error: 'SF already played' }, 400)
      if (!sf.team1 || !sf.team2) return jsonRes(res, { error: 'SF teams not yet determined' }, 400)
      const result = simPlayoffMatch(sf.team1, sf.team2)
      if (!result) return jsonRes(res, { error: 'Simulation failed' }, 500)
      sf.score = result.score
      sf.penaltyWinner = result.penaltyWinner || null
      sf.playerStats = { home: result.homePlayerStats, away: result.awayPlayerStats }
      sf.goalEvents = result.goalEvents
      if (result.score[0] > result.score[1]) sf.winner = sf.team1
      else sf.winner = sf.team2
      // Populate final
      if (!po.final.team1) po.final.team1 = sf.winner
      else if (!po.final.team2) po.final.team2 = sf.winner
      writeJSON('schedule.json', schedule)
      return jsonRes(res, { success: true, playoffs: po })
    }

    if (round === 'final') {
      const f = po.final
      if (f.winner) return jsonRes(res, { error: 'Final already played' }, 400)
      if (!f.team1 || !f.team2) return jsonRes(res, { error: 'Finalists not yet determined' }, 400)
      const result = simPlayoffMatch(f.team1, f.team2)
      if (!result) return jsonRes(res, { error: 'Simulation failed' }, 500)
      f.score = result.score
      f.penaltyWinner = result.penaltyWinner || null
      f.playerStats = { home: result.homePlayerStats, away: result.awayPlayerStats }
      f.goalEvents = result.goalEvents
      if (result.score[0] > result.score[1]) f.winner = f.team1
      else f.winner = f.team2
      // Find captain of winning team
      const league = readJSON('league.json')
      const champTeam = league.teams.find(t => t.name === f.winner)
      if (champTeam) {
        const cap = champTeam.players.find(p => p.captain)
        if (cap) f.captain = cap.name
      }
      po.champion = f.winner
      writeJSON('schedule.json', schedule)
      return jsonRes(res, { success: true, playoffs: po })
    }

    return jsonRes(res, { error: 'Invalid round' }, 400)
  }

  if (pathname === '/api/calculate-awards' && req.method === 'POST') {
    const schedule = readJSON('schedule.json')
    if (!schedule.playoffs || !schedule.playoffs.champion) return jsonRes(res, { error: 'Season not complete' }, 400)
    // Aggregate player stats from regular season
    const players = {}
    for (const md of schedule.matchdays) {
      for (const m of md.matches) {
        if (m.status !== 'completed' || !m.playerStats) continue
        for (const side of ['home', 'away']) {
          const teamName = side === 'home' ? m.home : m.away
          for (const p of m.playerStats[side]) {
            const key = p.name + ':' + teamName
            if (!players[key]) players[key] = { name: p.name, team: teamName, position: p.position, matches: 0, goals: 0, assists: 0, saves: 0, gradeSum: 0, age: p.age }
            const r = players[key]
            r.matches++; r.goals += (p.goals || 0); r.assists += (p.assists || 0)
            if (p.saves !== undefined) r.saves += p.saves
            r.gradeSum += (p.grade || 0)
            if (p.age) r.age = p.age
          }
        }
      }
    }
    const all = Object.values(players).filter(p => p.matches > 0)
    const avgGrade = p => p.gradeSum / p.matches
    // MVP: highest avg grade (min 5 matches)
    const mvpCands = all.filter(p => p.matches >= 5).sort((a, b) => avgGrade(b) - avgGrade(a))
    const mvp = mvpCands[0] || null
    // Fichichi: top scorer
    const fichCands = [...all].sort((a, b) => b.goals - a.goals)
    const fich = fichCands[0] || null
    // Assist King
    const astCands = [...all].sort((a, b) => b.assists - a.assists)
    const ast = astCands[0] || null
    // GK of the Season: GK with best avg grade
    const gkCands = all.filter(p => p.position === 'GK' && p.matches >= 3).sort((a, b) => avgGrade(b) - avgGrade(a))
    const gk = gkCands[0] || null
    // Field Player of the Year: non-GK highest avg grade
    const fpCands = all.filter(p => p.position !== 'GK' && p.matches >= 5).sort((a, b) => avgGrade(b) - avgGrade(a))
    const fp = fpCands[0] || null
    // LFA Promise: best avg grade, age <= 21
    const league = readJSON('league.json')
    const youngCands = all.filter(p => {
      const t = league.teams.find(t => t.name === p.team)
      if (!t) return false
      const pl = t.players.find(pp => pp.name === p.name)
      return pl && parseInt(pl.age, 10) <= 21 && p.matches >= 3
    }).sort((a, b) => avgGrade(b) - avgGrade(a))
    const young = youngCands[0] || null
    // Coach of the Year: team with best win% in regular season (reuse standings helper)
    const coachRank = buildStandingsFromSchedule(schedule).sort((a, b) => ((b.w + b.d * 0.5) / b.p) - ((a.w + a.d * 0.5) / a.p))
    const bestTeam = coachRank[0]
    const coachTeam = bestTeam ? league.teams.find(t => t.name === bestTeam.team) : null
    const coach = coachTeam ? coachTeam.coach : null

    const awards = {
      mvp: mvp ? { name: mvp.name, team: mvp.team, position: mvp.position, grade: +(avgGrade(mvp).toFixed(1)), age: mvp.age || null, goals: mvp.goals, assists: mvp.assists } : null,
      fichichi: fich ? { name: fich.name, team: fich.team, position: fich.position, goals: fich.goals, assists: fich.assists, perMatch: (fich.goals / fich.matches).toFixed(1) } : null,
      assistKing: ast ? { name: ast.name, team: ast.team, position: ast.position, assists: ast.assists, perMatch: (ast.assists / ast.matches).toFixed(1) } : null,
      goalkeeperOfSeason: gk ? { name: gk.name, team: gk.team, saves: gk.saves, grade: +(avgGrade(gk).toFixed(1)) } : null,
      fieldPlayerOfYear: fp ? { name: fp.name, team: fp.team, position: fp.position, grade: +(avgGrade(fp).toFixed(1)), goals: fp.goals, assists: fp.assists } : null,
      lfaPromise: young ? { name: young.name, team: young.team, position: young.position, grade: +(avgGrade(young).toFixed(1)), age: (() => { const t = league.teams.find(t => t.name === young.team); const pl = t ? t.players.find(pp => pp.name === young.name) : null; return pl ? parseInt(pl.age, 10) : null })() } : null,
      coachOfYear: coach ? { name: coach.name, team: coachTeam.name, style: coach.style, rating: coach.rating } : null
    }
    // Save to history
    const history = readJSON('history.json')
    const currentSeason = history.seasons.find(s => s.number === schedule.season)
    if (currentSeason) {
      currentSeason.awards = awards
      currentSeason.champion = schedule.playoffs.champion
      currentSeason.playoffs = {
        quarterFinals: schedule.playoffs.quarterFinals.map(qf => ({ higherSeed: qf.higherSeed, lowerSeed: qf.lowerSeed, seedNums: qf.seedNums, games: qf.games.map(g => ({ home: g.home, away: g.away, score: g.score })), winner: qf.winner, seriesScore: qf.seriesScore })),
        semiFinals: schedule.playoffs.semiFinals.map(sf => ({ team1: sf.team1, team2: sf.team2, score: sf.score, winner: sf.winner, venue: sf.venue })),
        final: { team1: schedule.playoffs.final.team1, team2: schedule.playoffs.final.team2, score: schedule.playoffs.final.score, winner: schedule.playoffs.final.winner, captain: schedule.playoffs.final.captain, venue: 'neutral' }
      }
      writeJSON('history.json', history)
    }
    schedule.awards = awards
    writeJSON('schedule.json', schedule)
    return jsonRes(res, { success: true, awards })
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
      recalcTeamRating(team)
    }

    writeJSON('league.json', league)

    // Sort by rating delta for the summary
    const improvers = [...results].sort((a, b) => b.ratingDelta - a.ratingDelta).slice(0, 10)
    const decliners = [...results].sort((a, b) => a.ratingDelta - b.ratingDelta).slice(0, 10)

    return jsonRes(res, { success: true, results, improvers, decliners })
  }

  // --- Edit match statistics ---
  if (pathname.startsWith('/api/edit-match-stats/') && req.method === 'POST') {
    const parts = pathname.split('/')
    const mdNum = parseInt(parts[3], 10)
    const matchIdx = parseInt(parts[4], 10)
    const body = await parseBody(req)

    if (!body.home || !body.away) return jsonRes(res, { error: 'Missing home/away player data' }, 400)

    const schedule = readJSON('schedule.json')
    const md = schedule.matchdays.find(m => m.number === mdNum)
    if (!md || matchIdx >= md.matches.length) return jsonRes(res, { error: 'Invalid matchday/match' }, 400)

    const match = md.matches[matchIdx]
    if (match.status !== 'completed') return jsonRes(res, { error: 'Match not yet played' }, 400)

    const oldHomeStats = match.playerStats ? match.playerStats.home : null
    const oldAwayStats = match.playerStats ? match.playerStats.away : null

    // Build new goal events from submitted data
    function buildGoalEvents(players) {
      const events = []
      for (const p of players) {
        for (let i = 0; i < (p.goals || 0); i++) {
          events.push({ scorer: p.name, assister: null, penalty: false, missed: false })
        }
        for (let i = 0; i < (p.penaltiesMade || 0); i++) {
          events.push({ scorer: p.name, assister: null, penalty: true, missed: false })
        }
        for (let i = 0; i < (p.penaltiesMissed || 0); i++) {
          events.push({ scorer: p.name, assister: null, penalty: true, missed: true })
        }
      }
      return events
    }

    // Merge submitted edits into existing player stats
    function mergeStats(oldStats, submitted) {
      if (!oldStats) return submitted.map(s => ({
        name: s.name, position: s.position || 'CM', rating: s.rating || '70',
        goals: (s.goals || 0) + (s.penaltiesMade || 0), assists: s.assists || 0,
        shots: { total: 0, on: 0, off: 0 }, passes: { total: 0, on: 0, off: 0 },
        tackles: { total: 0, on: 0, off: 0, fouls: 0 },
        grade: s.grade || 2.5,
        ...(s.saves !== undefined ? { saves: s.saves } : {})
      }))

      return oldStats.map(old => {
        const edit = submitted.find(s => s.name === old.name)
        if (!edit) return old
        return {
          ...old,
          goals: (edit.goals !== undefined ? edit.goals : old.goals) + (edit.penaltiesMade || 0),
          assists: edit.assists !== undefined ? edit.assists : old.assists,
          grade: edit.grade !== undefined ? edit.grade : old.grade,
          ...(edit.saves !== undefined ? { saves: edit.saves } : (old.saves !== undefined ? { saves: old.saves } : {}))
        }
      })
    }

    const newHomeStats = mergeStats(oldHomeStats, body.home)
    const newAwayStats = mergeStats(oldAwayStats, body.away)

    // Rebuild goal events
    const newHomeGoalEvents = buildGoalEvents(body.home)
    const newAwayGoalEvents = buildGoalEvents(body.away)

    // Recalculate score from goals + penalties made
    const newHomeGoals = body.home.reduce((s, p) => s + (p.goals || 0) + (p.penaltiesMade || 0), 0)
    const newAwayGoals = body.away.reduce((s, p) => s + (p.goals || 0) + (p.penaltiesMade || 0), 0)

    const oldScore = match.score ? [...match.score] : [0, 0]

    match.playerStats = { home: newHomeStats, away: newAwayStats }
    match.playerGrades = {
      home: newHomeStats.map(p => ({ name: p.name, grade: p.grade })),
      away: newAwayStats.map(p => ({ name: p.name, grade: p.grade }))
    }
    match.goalEvents = { home: newHomeGoalEvents, away: newAwayGoalEvents }
    match.score = [newHomeGoals, newAwayGoals]

    writeJSON('schedule.json', schedule)

    // Update history: subtract old stats, add new stats
    const history = readJSON('history.json')
    const current = history.seasons.find(s => s.number === history.currentSeason)
    if (current) {
      // Fix standings if score changed
      if (oldScore[0] !== newHomeGoals || oldScore[1] !== newAwayGoals) {
        function fixStanding(team, oldGF, oldGA, newGF, newGA) {
          const s = current.standings.find(st => st.team === team)
          if (!s) return
          s.gf += (newGF - oldGF)
          s.ga += (newGA - oldGA)
          // Recalculate result
          const oldResult = oldGF > oldGA ? 'w' : oldGF === oldGA ? 'd' : 'l'
          const newResult = newGF > newGA ? 'w' : newGF === newGA ? 'd' : 'l'
          if (oldResult !== newResult) {
            if (oldResult === 'w') { s.won--; s.points -= 3 }
            else if (oldResult === 'd') { s.drawn--; s.points -= 1 }
            else { s.lost-- }
            if (newResult === 'w') { s.won++; s.points += 3 }
            else if (newResult === 'd') { s.drawn++; s.points += 1 }
            else { s.lost++ }
          }
        }
        fixStanding(match.home, oldScore[0], oldScore[1], newHomeGoals, newAwayGoals)
        fixStanding(match.away, oldScore[1], oldScore[0], newAwayGoals, newHomeGoals)
        current.standings.sort((a, b) => (b.points - a.points) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf))

        // Update matchResults entry
        const mr = current.matchResults.find(r => r.home === match.home && r.away === match.away && r.score[0] === oldScore[0] && r.score[1] === oldScore[1])
        if (mr) mr.score = [newHomeGoals, newAwayGoals]
      }

      // Update playerSeasonStats: subtract old, add new
      function updatePlayerSeason(teamName, oldPS, newPS) {
        for (const np of newPS) {
          const op = oldPS ? oldPS.find(o => o.name === np.name) : null
          let rec = current.playerSeasonStats.find(r => r.name === np.name && r.team === teamName)
          if (!rec) continue
          if (op) {
            rec.goals += (np.goals - op.goals)
            rec.assists += (np.assists - op.assists)
            if (rec.saves !== undefined && op.saves !== undefined && np.saves !== undefined) {
              rec.saves += (np.saves - op.saves)
            }
          }
        }
      }
      updatePlayerSeason(match.home, oldHomeStats, newHomeStats)
      updatePlayerSeason(match.away, oldAwayStats, newAwayStats)

      writeJSON('history.json', history)
    }

    return jsonRes(res, { success: true, match })
  }

  // --- Season Editor: get season data ---
  if (pathname.startsWith('/api/season-editor/') && req.method === 'GET') {
    const seasonNum = parseInt(pathname.split('/')[3], 10)
    const league = readJSON('league.json')
    const history = readJSON('history.json')
    const season = history.seasons.find(s => s.number === seasonNum)
    if (!season) return jsonRes(res, { error: 'Season not found' }, 404)
    // Return league teams data for the requested season
    return jsonRes(res, {
      season: seasonNum,
      teams: league.teams,
      nonLfaTeams: Array.isArray(league.nonLfaTeams) ? league.nonLfaTeams : [],
      currentSeason: history.currentSeason
    })
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

      recalcTeamRating(existing)
    }

    writeJSON('league.json', league)
    rebuildSiteNow()

    return jsonRes(res, { success: true, teams: league.teams })
  }

  // --- Start New Season ---
  // --- Create a brand new league (reset history) ---
  if (pathname === '/api/new-league' && req.method === 'POST') {
    const body = await parseBody(req)
    const startingSeason = parseInt(body.startingSeason, 10) || 1
    const league = readJSON('league.json')

    // Reset history to a single empty season
    const newHistory = {
      currentSeason: startingSeason,
      seasons: [{
        number: startingSeason,
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
      }]
    }
    writeJSON('history.json', newHistory)

    // Generate fresh schedule with all teams using shared helper
    const teams = league.teams.map(t => t.name)
    const matchdays = generateRoundRobin(teams, null)

    writeJSON('schedule.json', { season: startingSeason, matchdays })

    // Rebuild site (immediate — page reload expected)
    rebuildSiteNow()

    return jsonRes(res, { success: true, season: startingSeason })
  }

  if (pathname === '/api/start-new-season' && req.method === 'POST') {
    const body = await parseBody(req)
    const selectedTeams = body.teams || null // array of team names, or null for all
    const incomingNewTeams = body.newTeams || [] // array of { name, primary, secondary }
    const history = readJSON('history.json')
    const league = readJSON('league.json')
    const prefs = readJSON('preferences.json')
    const newSeasonNum = history.currentSeason + 1

    // Create new team objects for any manually added teams
    const positions = ['GK','CB','CB','LB','RB','CM','CM','AM','LW','ST']
    const firstNames = ['Alex','Ben','Carlos','Dan','Erik','Finn','Gabe','Hugo','Ivan','Jay','Kai','Leo','Max','Nico','Omar','Pablo','Rafi','Sam','Teo','Uri']
    const lastNames = ['Stone','Cruz','Park','Vale','Frost','Hart','Cole','Nash','Vega','Lake','Storm','Reed','Wolf','Bell','Fox','Grant','Hale','Moss','Kent','Shaw']
    const coachNames = ['Silva','Bruno','Kova','Dietrich','Alonso','Takeda','Murray','Petrov','Lindgren','Moreno']
    const styles = ['balanced','attacking','defensive','possession','counter-attack']
    for (const nt of incomingNewTeams) {
      if (!nt.name || league.teams.some(t => t.name.toLowerCase() === nt.name.toLowerCase())) continue
      const abbr = nt.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'NEW'
      const players = positions.map((pos, i) => {
        const fn = firstNames[Math.floor(Math.random() * firstNames.length)]
        const ln = lastNames[Math.floor(Math.random() * lastNames.length)]
        const baseRating = 55 + Math.floor(Math.random() * 20) // 55-74
        const skill = {}
        const skillKeys = ['passing','shooting','tackling','saving','agility','strength','penalty_taking','jumping','speed','marking','head_game','set_piece_taking']
        for (const sk of skillKeys) {
          let val = baseRating + Math.floor(Math.random() * 15) - 7
          if (pos === 'GK' && sk === 'saving') val = Math.max(val, 70 + Math.floor(Math.random() * 15))
          if (pos === 'ST' && sk === 'shooting') val = Math.max(val, 65 + Math.floor(Math.random() * 15))
          if (pos === 'CB' && sk === 'tackling') val = Math.max(val, 65 + Math.floor(Math.random() * 15))
          skill[sk] = String(Math.max(30, Math.min(85, val)))
        }
        const vals = Object.values(skill).map(Number)
        const rating = String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))
        return {
          name: fn + ' ' + ln, position: pos, rating, starter: true,
          skill, currentPOS: [0, 0], fitness: 100,
          height: 170 + Math.floor(Math.random() * 25),
          injured: false, age: 19 + Math.floor(Math.random() * 14), captain: i === 0
        }
      })
      const coachName = coachNames[Math.floor(Math.random() * coachNames.length)]
      const coachRating = String(55 + Math.floor(Math.random() * 25))
      const starters = players.filter(p => p.starter)
      const teamRating = String(Math.round(starters.reduce((a, p) => a + parseInt(p.rating, 10), 0) / starters.length))
      league.teams.push({
        name: nt.name, abbreviation: abbr,
        colors: { primary: nt.primary || '#3b82f6', secondary: nt.secondary || '#ffffff' },
        jersey: { home: 'Custom home kit', away: 'Custom away kit' },
        rating: teamRating,
        coach: { name: coachName, rating: coachRating, style: styles[Math.floor(Math.random() * styles.length)] },
        captain: players[0].name,
        players
      })
    }
    if (incomingNewTeams.length) writeJSON('league.json', league)

    // Apply International boosts to player skills before the new season
    for (const t of league.teams) {
      for (const p of t.players) {
        if (!p.international) continue
        // Age-based skill change: young players improve, old decline
        const age = p.age || 25
        for (const k of Object.keys(p.skill)) {
          const cur = parseInt(p.skill[k], 10)
          let change = 0
          if (age <= 24) change = Math.floor(Math.random() * 3) + 1  // +1 to +3
          else if (age <= 28) change = Math.floor(Math.random() * 3) - 1 // -1 to +1
          else change = -(Math.floor(Math.random() * 3) + 1) // -1 to -3

          if (change < 0) {
            // Boost negates decline
            change = 0
          } else if (change > 0) {
            // Boost adds 50% extra improvement
            change = Math.round(change * 1.5)
          }
          p.skill[k] = String(Math.max(1, Math.min(99, cur + change)))
        }
        // Recalculate player rating
        const vals = Object.values(p.skill).map(Number)
        p.rating = String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))
        // Clear the international boost (one-time use)
        p.international = false
      }
      recalcTeamRating(t)
      // Age up players
      for (const p of t.players) { if (p.age) p.age++ }
    }

    // Age and develop players/coaches abroad
    if (league.hallOfFame) {
      for (const p of league.hallOfFame.players) {
        if (p.status === 'abroad' && p.age) {
          developPlayer(p, p.age)
          p.age++
        }
      }
      for (const c of league.hallOfFame.coaches) {
        if (c.status === 'abroad' && c.age) c.age++
      }
    }

    writeJSON('league.json', league)

    // Determine team count for this season (check expansions/contractions)
    let teamCount = prefs.defaultTeamCount
    const exp = (prefs.expansions || []).find(e => e.season === newSeasonNum)
    const con = (prefs.contractions || []).find(c => c.season === newSeasonNum)
    if (exp) teamCount += exp.teams
    if (con) teamCount -= con.teams

    // Build list of participating team names (existing selected + newly created)
    const newTeamNames = incomingNewTeams.map(nt => nt.name).filter(n => league.teams.some(t => t.name === n))
    let teams = selectedTeams && selectedTeams.length >= 1
      ? selectedTeams.filter(name => league.teams.some(t => t.name === name))
      : league.teams.map(t => t.name)
    // Add new teams that aren't already in the selected list
    for (const ntn of newTeamNames) { if (!teams.includes(ntn)) teams.push(ntn) }
    if (teams.length < 4) return jsonRes(res, { error: 'Need at least 4 teams' }, 400)
    if (teams.length % 2 !== 0) return jsonRes(res, { error: 'Team count must be even' }, 400)

    // Create new season entry in history
    const newSeason = {
      number: newSeasonNum,
      champion: null,
      guyKilneTrophy: null,
      standings: league.teams.filter(t => teams.includes(t.name)).map(t => ({
        team: t.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0
      })),
      matchResults: [],
      playerSeasonStats: [],
      coachSeasonStats: league.teams.filter(t => teams.includes(t.name)).map(t => ({
        team: t.name, coach: t.coach.name, style: t.coach.style, rating: t.coach.rating,
        played: 0, won: 0, drawn: 0, lost: 0, points: 0
      })),
      awards: null
    }
    history.seasons.push(newSeason)
    history.currentSeason = newSeasonNum
    writeJSON('history.json', history)

    // Generate schedule using shared helper, with top-half home advantage
    const prevSeason = history.seasons.find(s => s.number === newSeasonNum - 1)
    const topHalf = new Set()
    if (prevSeason && prevSeason.standings && prevSeason.standings.length) {
      const sorted = [...prevSeason.standings].sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga))
      const topCount = Math.ceil(sorted.length / 2)
      sorted.slice(0, topCount).forEach(s => topHalf.add(s.team))
    }
    const matchdays = generateRoundRobin(teams, topHalf)

    writeJSON('schedule.json', { season: newSeasonNum, matchdays })

    // Rebuild site (immediate — page reload expected)
    rebuildSiteNow()

    return jsonRes(res, { success: true, season: newSeasonNum })
  }

  // --- Transfer player between teams ---
  // --- Update stadium name ---
  if (pathname === '/api/update-stadium' && req.method === 'POST') {
    const body = await parseBody(req)
    const { teamName, stadium } = body
    if (!teamName || !stadium) return jsonRes(res, { error: 'Missing teamName or stadium' }, 400)
    const league = readJSON('league.json')
    const team = league.teams.find(t => t.name === teamName)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)
    team.stadium = stadium
    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, team: teamName, stadium })
  }

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
    for (const t of [src, dst]) recalcTeamRating(t)

    writeJSON('league.json', league)
    rebuildSite()

    return jsonRes(res, { success: true, player: playerName, from: fromTeam, to: toTeam })
  }

  // --- Preferences: GET ---
  if (pathname === '/api/preferences' && req.method === 'GET') {
    const prefs = readJSON('preferences.json')
    return jsonRes(res, prefs)
  }

  // --- Preferences: SAVE ---
  if (pathname === '/api/preferences' && req.method === 'POST') {
    const body = await parseBody(req)
    const prefs = readJSON('preferences.json')
    if (body.startingSeason !== undefined) prefs.startingSeason = parseInt(body.startingSeason, 10)
    if (body.defaultTeamCount !== undefined) prefs.defaultTeamCount = parseInt(body.defaultTeamCount, 10)
    if (body.expansions !== undefined) prefs.expansions = body.expansions
    if (body.contractions !== undefined) prefs.contractions = body.contractions
    writeJSON('preferences.json', prefs)
    // Update config teamCount to match current
    const config = readJSON('config.json')
    config.league.teamCount = prefs.defaultTeamCount
    writeJSON('config.json', config)
    rebuildSite()
    return jsonRes(res, { success: true, prefs })
  }

  // --- Skill Shop: GET players for a season ---
  if (pathname.startsWith('/api/skill-shop/') && req.method === 'GET') {
    const seasonNum = parseInt(pathname.split('/')[3], 10)
    const league = readJSON('league.json')
    const players = []
    for (const t of league.teams) {
      for (const p of t.players) {
        players.push({ name: p.name, team: t.name, position: p.position, rating: p.rating, skill: p.skill, international: !!p.international })
      }
    }
    return jsonRes(res, { season: seasonNum, players })
  }

  // --- Skill Shop: UPDATE player skills ---
  if (pathname === '/api/skill-shop/update' && req.method === 'POST') {
    const body = await parseBody(req)
    const { playerName, teamName, skills, international } = body
    if (!playerName || !teamName) return jsonRes(res, { error: 'Missing playerName or teamName' }, 400)
    const league = readJSON('league.json')
    const team = league.teams.find(t => t.name === teamName)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)
    const player = team.players.find(p => p.name === playerName)
    if (!player) return jsonRes(res, { error: 'Player not found' }, 404)
    if (skills) {
      for (const [k, v] of Object.entries(skills)) {
        if (player.skill[k] !== undefined) player.skill[k] = String(parseInt(v, 10))
      }
      // Recalculate player rating as average of all skills
      const vals = Object.values(player.skill).map(Number)
      player.rating = String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length))
      recalcTeamRating(team)
    }
    if (international !== undefined) player.international = !!international
    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, player: playerName, rating: player.rating, international: !!player.international })
  }

  // --- Skill Shop: BATCH toggle international ---
  if (pathname === '/api/skill-shop/batch-international' && req.method === 'POST') {
    const body = await parseBody(req)
    const { updates } = body // [{ playerName, teamName, international }]
    if (!updates || !Array.isArray(updates)) return jsonRes(res, { error: 'Missing updates array' }, 400)
    const league = readJSON('league.json')
    for (const u of updates) {
      const team = league.teams.find(t => t.name === u.teamName)
      if (!team) continue
      const player = team.players.find(p => p.name === u.playerName)
      if (!player) continue
      player.international = !!u.international
    }
    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true })
  }

  // --- Generate Matchday Report (local engine) ---
  const reportMatch = pathname.match(/^\/api\/generate-report\/(\d+)$/)
  if (reportMatch && req.method === 'POST') {
    const mdNum = parseInt(reportMatch[1], 10)
    const body = await parseBody(req)
    const engine = body.engine || 'local'  // 'local' or 'ai'
    const history = readJSON('history.json')
    const schedule = readJSON('schedule.json')
    const league = readJSON('league.json')
    const currentSeason = history.seasons.find(s => s.number === schedule.season)
    const matchday = schedule.matchdays.find(md => md.number === mdNum)
    if (!matchday) return jsonRes(res, { error: 'Matchday not found' }, 404)

    const completedMatches = matchday.matches.filter(m => m.status === 'completed')
    if (!completedMatches.length) return jsonRes(res, { error: 'No completed matches on this matchday' }, 400)

    const standings = currentSeason ? [...currentSeason.standings].sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga)) : []
    const allPlayerStats = currentSeason ? currentSeason.playerSeasonStats || [] : []
    const topScorers = [...allPlayerStats].sort((a, b) => (b.goals || 0) - (a.goals || 0)).slice(0, 5)

    let report
    let reportEngine = 'local'
    if (engine === 'ai') {
      try {
        report = await generateAIReport(completedMatches, standings, topScorers, league, mdNum, schedule.season)
        reportEngine = 'ai'
      } catch (e) {
        console.error('AI report failed, falling back to local:', e.message)
        report = generateLocalReport(completedMatches, standings, topScorers, league, mdNum, schedule.season, history, schedule)
        reportEngine = 'local (AI fallback: ' + e.message + ')'
      }
    } else {
      report = generateLocalReport(completedMatches, standings, topScorers, league, mdNum, schedule.season, history, schedule)
    }

    report.illustrations = completedMatches.map(m => {
      const homeTeam = league.teams.find(t => t.name === m.home)
      const awayTeam = league.teams.find(t => t.name === m.away)
      return generateMatchSVG(m, homeTeam, awayTeam)
    })

    // Generate 2 still "photographs" per match
    report.stills = completedMatches.map(m => {
      const homeTeam = league.teams.find(t => t.name === m.home)
      const awayTeam = league.teams.find(t => t.name === m.away)
      m._season = schedule.season; m._md = mdNum
      const types = ['shot', 'celebration', 'tackle', 'save', 'header', 'dribble']
      // Pick 2 different moment types
      const t1 = types[Math.floor(Math.random() * types.length)]
      let t2 = types[Math.floor(Math.random() * types.length)]
      while (t2 === t1) t2 = types[Math.floor(Math.random() * types.length)]
      return [generateMatchStill(m, homeTeam, awayTeam, t1), generateMatchStill(m, homeTeam, awayTeam, t2)]
    })

    return jsonRes(res, { success: true, report, engine: reportEngine, season: schedule.season, matchday: mdNum })
  }

  // --- Trade player away (retire / abroad / non-LFA) ---
  if (pathname === '/api/trade-player-away' && req.method === 'POST') {
    const body = await parseBody(req)
    const { playerName, fromTeam, status } = body  // status: 'retired', 'abroad', 'non-lfa'
    if (!playerName || !fromTeam || !status) return jsonRes(res, { error: 'Missing playerName, fromTeam, or status' }, 400)
    if (!['retired', 'abroad', 'non-lfa'].includes(status)) return jsonRes(res, { error: 'Invalid status' }, 400)

    const league = readJSON('league.json')
    const history = readJSON('history.json')
    const src = league.teams.find(t => t.name === fromTeam)
    if (!src) return jsonRes(res, { error: 'Team not found' }, 404)
    const pIdx = src.players.findIndex(p => p.name === playerName)
    if (pIdx === -1) return jsonRes(res, { error: 'Player not found on team' }, 404)

    // --- Non-LFA: move to a non-LFA team roster, NOT to Hall of Fame ---
    if (status === 'non-lfa') {
      const rawName = typeof body.toNonLfaTeam === 'string' ? body.toNonLfaTeam.trim() : ''
      if (!rawName) return jsonRes(res, { error: 'Missing toNonLfaTeam: provide an existing non-LFA team name or a new one' }, 400)
      // Reject collision with LFA team names
      if (league.teams.find(t => t.name.toLowerCase() === rawName.toLowerCase())) {
        return jsonRes(res, { error: 'A team in the LFA already has that name' }, 400)
      }
      const player = src.players.splice(pIdx, 1)[0]

      if (!Array.isArray(league.nonLfaTeams)) league.nonLfaTeams = []
      let nlt = league.nonLfaTeams.find(t => t.name.toLowerCase() === rawName.toLowerCase())
      let created = false
      if (!nlt) {
        nlt = { name: rawName, createdSeason: history.currentSeason, players: [] }
        league.nonLfaTeams.push(nlt)
        created = true
      }
      if (!Array.isArray(nlt.players)) nlt.players = []

      // Stamp move metadata onto the player (non-destructive to player fields)
      const moved = Object.assign({}, player, {
        previousLfaTeam: fromTeam,
        leftLfaSeason: history.currentSeason
      })
      nlt.players.push(moved)

      recalcTeamRating(src)
      writeJSON('league.json', league)
      rebuildSite()
      return jsonRes(res, { success: true, player: moved, nonLfaTeam: { name: nlt.name, created, roster: nlt.players.length } })
    }

    // --- Retired / abroad: Hall of Fame path ---
    const player = src.players.splice(pIdx, 1)[0]

    // Gather achievements from history
    const achievements = []
    for (const s of history.seasons) {
      if (s.champion) {
        const teamSnap = (s.teams || []).find(t => t.name === fromTeam)
        const inRoster = teamSnap && teamSnap.players && teamSnap.players.find(p => p.name === playerName)
        if (inRoster && s.champion === fromTeam) achievements.push({ type: 'champion', season: s.number })
      }
      if (s.awards) {
        for (const [key, award] of Object.entries(s.awards)) {
          if (award && award.name === playerName) achievements.push({ type: key, season: s.number })
        }
      }
    }

    // Build hall of fame entry
    const entry = {
      name: player.name,
      position: player.position,
      lastTeam: fromTeam,
      rating: player.rating,
      age: player.age || null,
      skill: player.skill || {},
      height: player.height || null,
      international: player.international || false,
      status,
      seasonLeft: history.currentSeason,
      achievements
    }

    if (!league.hallOfFame) league.hallOfFame = { players: [], coaches: [] }
    league.hallOfFame.players.push(entry)

    recalcTeamRating(src)

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, player: entry })
  }

  // --- Add new player to team ---
  if (pathname === '/api/add-player' && req.method === 'POST') {
    const body = await parseBody(req)
    const { teamName, name, position, age, rating } = body
    if (!teamName || !name || !position) return jsonRes(res, { error: 'Missing teamName, name, or position' }, 400)

    const league = readJSON('league.json')
    const team = league.teams.find(t => t.name === teamName)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)

    // Check for duplicate name on the team
    if (team.players.find(p => p.name === name)) return jsonRes(res, { error: 'Player with that name already on team' }, 400)

    const r = parseInt(rating, 10) || 60
    const a = parseInt(age, 10) || 22
    const newPlayer = {
      name,
      position,
      rating: String(Math.min(99, Math.max(40, r))),
      starter: team.players.length < 6,
      skill: {
        passing: String(50 + Math.floor(Math.random() * 20)),
        shooting: String(50 + Math.floor(Math.random() * 20)),
        tackling: String(50 + Math.floor(Math.random() * 20)),
        saving: position === 'GK' ? String(60 + Math.floor(Math.random() * 20)) : String(30 + Math.floor(Math.random() * 20)),
        agility: String(50 + Math.floor(Math.random() * 20)),
        strength: String(50 + Math.floor(Math.random() * 20)),
        penalty_taking: String(40 + Math.floor(Math.random() * 20)),
        jumping: String(50 + Math.floor(Math.random() * 20)),
        speed: String(50 + Math.floor(Math.random() * 20)),
        marking: String(50 + Math.floor(Math.random() * 20)),
        head_game: String(50 + Math.floor(Math.random() * 20)),
        set_piece_taking: String(40 + Math.floor(Math.random() * 20))
      },
      currentPOS: [200, 0],
      fitness: 100,
      height: 170 + Math.floor(Math.random() * 25),
      injured: false,
      age: a,
      captain: false,
      international: false
    }

    team.players.push(newPlayer)

    recalcTeamRating(team)

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, player: newPlayer })
  }

  // --- Transfer coach between LFA teams ---
  if (pathname === '/api/transfer-coach' && req.method === 'POST') {
    const body = await parseBody(req)
    const { fromTeam, toTeam } = body
    if (!fromTeam || !toTeam) return jsonRes(res, { error: 'Missing fromTeam or toTeam' }, 400)
    if (fromTeam === toTeam) return jsonRes(res, { error: 'Source and destination teams are the same' }, 400)

    const league = readJSON('league.json')
    const src = league.teams.find(t => t.name === fromTeam)
    const dst = league.teams.find(t => t.name === toTeam)
    if (!src) return jsonRes(res, { error: 'Source team not found' }, 404)
    if (!dst) return jsonRes(res, { error: 'Destination team not found' }, 404)
    if (!src.coach) return jsonRes(res, { error: 'Source team has no coach' }, 400)
    if (dst.coach) return jsonRes(res, { error: 'Destination team already has a coach. Trade them away first.' }, 400)

    dst.coach = src.coach
    src.coach = null

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, coach: dst.coach.name, from: fromTeam, to: toTeam })
  }

  // --- Trade coach away (retire / abroad / non-LFA) ---
  if (pathname === '/api/trade-coach-away' && req.method === 'POST') {
    const body = await parseBody(req)
    const { teamName, status } = body  // status: 'retired', 'abroad', 'non-lfa'
    if (!teamName || !status) return jsonRes(res, { error: 'Missing teamName or status' }, 400)
    if (!['retired', 'abroad', 'non-lfa'].includes(status)) return jsonRes(res, { error: 'Invalid status' }, 400)

    const league = readJSON('league.json')
    const history = readJSON('history.json')
    const team = league.teams.find(t => t.name === teamName)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)
    if (!team.coach) return jsonRes(res, { error: 'Team has no coach' }, 400)

    const coach = team.coach

    // Gather coach achievements
    const achievements = []
    for (const s of history.seasons) {
      if (s.champion === teamName) achievements.push({ type: 'champion', season: s.number })
      if (s.awards && s.awards.coachOfYear && s.awards.coachOfYear.team === teamName) {
        achievements.push({ type: 'coachOfYear', season: s.number })
      }
    }

    const entry = {
      name: coach.name,
      lastTeam: teamName,
      rating: coach.rating,
      style: coach.style,
      age: coach.age || null,
      status,
      seasonLeft: history.currentSeason,
      achievements
    }

    if (!league.hallOfFame) league.hallOfFame = { players: [], coaches: [] }
    league.hallOfFame.coaches.push(entry)

    // Remove coach from team
    team.coach = null

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, coach: entry })
  }

  // --- Replace coach (set new coach for a team) ---
  if (pathname === '/api/replace-coach' && req.method === 'POST') {
    const body = await parseBody(req)
    const { teamName, name, rating, style } = body
    if (!teamName || !name) return jsonRes(res, { error: 'Missing teamName or name' }, 400)

    const league = readJSON('league.json')
    const team = league.teams.find(t => t.name === teamName)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)

    const r = parseInt(rating, 10) || 60
    const s = ['attacking', 'defensive', 'balanced', 'possession', 'counter-attack'].includes(style) ? style : 'balanced'
    team.coach = { name, rating: String(Math.min(99, Math.max(40, r))), style: s, age: 45 + Math.floor(Math.random() * 15) }

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, coach: team.coach })
  }

  // --- Recall player from abroad ---
  if (pathname === '/api/recall-player' && req.method === 'POST') {
    const body = await parseBody(req)
    const { playerName, toTeam } = body
    if (!playerName || !toTeam) return jsonRes(res, { error: 'Missing playerName or toTeam' }, 400)

    const league = readJSON('league.json')
    if (!league.hallOfFame) return jsonRes(res, { error: 'No hall of fame data' }, 404)
    const pIdx = league.hallOfFame.players.findIndex(p => p.name === playerName && p.status === 'abroad')
    if (pIdx === -1) return jsonRes(res, { error: 'Player not found abroad' }, 404)

    const team = league.teams.find(t => t.name === toTeam)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)

    const entry = league.hallOfFame.players.splice(pIdx, 1)[0]
    const player = {
      name: entry.name,
      position: entry.position,
      rating: entry.rating,
      starter: team.players.length < 6,
      skill: entry.skill || {},
      currentPOS: [200, 0],
      fitness: 100,
      height: entry.height || 180,
      injured: false,
      age: entry.age || 25,
      captain: false,
      international: entry.international || false
    }
    team.players.push(player)

    recalcTeamRating(team)

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, player })
  }

  // --- Recall coach from abroad ---
  if (pathname === '/api/recall-coach' && req.method === 'POST') {
    const body = await parseBody(req)
    const { coachName, toTeam } = body
    if (!coachName || !toTeam) return jsonRes(res, { error: 'Missing coachName or toTeam' }, 400)

    const league = readJSON('league.json')
    if (!league.hallOfFame) return jsonRes(res, { error: 'No hall of fame data' }, 404)
    const cIdx = league.hallOfFame.coaches.findIndex(c => c.name === coachName && c.status === 'abroad')
    if (cIdx === -1) return jsonRes(res, { error: 'Coach not found abroad' }, 404)

    const team = league.teams.find(t => t.name === toTeam)
    if (!team) return jsonRes(res, { error: 'Team not found' }, 404)

    const entry = league.hallOfFame.coaches.splice(cIdx, 1)[0]
    team.coach = { name: entry.name, rating: entry.rating, style: entry.style, age: entry.age || 50 }

    writeJSON('league.json', league)
    rebuildSite()
    return jsonRes(res, { success: true, coach: team.coach })
  }

  // --- Hall of Fame data ---
  if (pathname === '/api/hall-of-fame' && req.method === 'GET') {
    const league = readJSON('league.json')
    const history = readJSON('history.json')
    const hof = league.hallOfFame || { players: [], coaches: [] }
    return jsonRes(res, { success: true, ...hof })
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
