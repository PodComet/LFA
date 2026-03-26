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

  // Helper: draw a human figure from ground level (x = center, groundY = feet y, h = height, color = jersey)
  function person(x, groundY, h, jersey, shorts, skin, pose) {
    const headR = h * 0.1
    const torsoH = h * 0.35
    const legH = h * 0.35
    const armH = h * 0.3
    const headY = groundY - h + headR
    const shoulderY = headY + headR * 2 + 2
    const hipY = shoulderY + torsoH
    const footY = groundY
    const w = h * 0.22

    let arms = '', legs = '', torso = '', head = ''

    // Head
    head = `<circle cx="${x}" cy="${headY}" r="${headR}" fill="${skin}"/>`
    // Hair
    head += `<ellipse cx="${x}" cy="${headY - headR * 0.3}" rx="${headR * 0.9}" ry="${headR * 0.5}" fill="#2a1a0a"/>`

    // Torso (jersey)
    torso = `<rect x="${x - w}" y="${shoulderY}" width="${w * 2}" height="${torsoH}" rx="2" fill="${jersey}"/>`
    // Jersey number area
    torso += `<rect x="${x - w * 0.4}" y="${shoulderY + 2}" width="${w * 0.8}" height="${torsoH * 0.4}" rx="1" fill="${shorts}" opacity="0.3"/>`

    if (pose === 'running') {
      // Running: legs apart, arms swinging
      legs = `<line x1="${x - 3}" y1="${hipY}" x2="${x - w - 4}" y2="${footY}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <line x1="${x + 3}" y1="${hipY}" x2="${x + w + 6}" y2="${footY - legH * 0.3}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <circle cx="${x - w - 4}" cy="${footY}" r="${headR * 0.6}" fill="#222"/>
              <circle cx="${x + w + 6}" cy="${footY - legH * 0.3}" r="${headR * 0.6}" fill="#222"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 4}" x2="${x - w - 10}" y2="${shoulderY + armH}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 4}" x2="${x + w + 8}" y2="${shoulderY + armH * 0.6}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>`
    } else if (pose === 'kicking') {
      // Kicking: one leg back, one forward extended
      legs = `<line x1="${x - 2}" y1="${hipY}" x2="${x - w - 2}" y2="${footY}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <line x1="${x + 2}" y1="${hipY}" x2="${x + w + 16}" y2="${footY - legH * 0.6}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <circle cx="${x - w - 2}" cy="${footY}" r="${headR * 0.6}" fill="#222"/>
              <circle cx="${x + w + 16}" cy="${footY - legH * 0.6}" r="${headR * 0.7}" fill="#222"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 4}" x2="${x - w - 14}" y2="${shoulderY + armH * 0.5}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 4}" x2="${x + w + 6}" y2="${shoulderY + armH * 0.8}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>`
    } else if (pose === 'celebrating') {
      // Both arms up
      legs = `<line x1="${x - 4}" y1="${hipY}" x2="${x - 6}" y2="${footY}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <line x1="${x + 4}" y1="${hipY}" x2="${x + 6}" y2="${footY}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <circle cx="${x - 6}" cy="${footY}" r="${headR * 0.6}" fill="#222"/>
              <circle cx="${x + 6}" cy="${footY}" r="${headR * 0.6}" fill="#222"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 2}" x2="${x - w - 10}" y2="${shoulderY - armH * 0.7}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 2}" x2="${x + w + 10}" y2="${shoulderY - armH * 0.7}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>`
    } else if (pose === 'diving') {
      // GK dive: horizontal body
      const dy = groundY - h * 0.4
      head = `<circle cx="${x - h * 0.4}" cy="${dy - 2}" r="${headR}" fill="${skin}"/>`
      head += `<ellipse cx="${x - h * 0.4}" cy="${dy - headR * 0.8}" rx="${headR * 0.8}" ry="${headR * 0.4}" fill="#2a1a0a"/>`
      torso = `<rect x="${x - h * 0.3}" y="${dy}" width="${torsoH + 6}" height="${w * 2}" rx="3" fill="${jersey}"/>`
      legs = `<line x1="${x + torsoH * 0.3}" y1="${dy + w}" x2="${x + torsoH * 0.3 + legH}" y2="${dy + w + 6}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <line x1="${x + torsoH * 0.3}" y1="${dy + w}" x2="${x + torsoH * 0.3 + legH}" y2="${dy + w - 8}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>`
      arms = `<line x1="${x - h * 0.3}" y1="${dy + w * 0.5}" x2="${x - h * 0.3 - armH}" y2="${dy - 8}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <circle cx="${x - h * 0.3 - armH}" cy="${dy - 10}" r="${headR * 0.5}" fill="#ffa"/>`
    } else if (pose === 'heading') {
      // Jumping: both legs bent below, body stretched up
      const jumpH = h * 0.15
      legs = `<line x1="${x - 3}" y1="${hipY - jumpH}" x2="${x - 8}" y2="${footY - jumpH * 0.5}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <line x1="${x + 3}" y1="${hipY - jumpH}" x2="${x + 6}" y2="${footY - jumpH * 0.3}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <circle cx="${x - 8}" cy="${footY - jumpH * 0.5}" r="${headR * 0.6}" fill="#222"/>
              <circle cx="${x + 6}" cy="${footY - jumpH * 0.3}" r="${headR * 0.6}" fill="#222"/>`
      head = `<circle cx="${x}" cy="${headY - jumpH}" r="${headR}" fill="${skin}"/>`
      head += `<ellipse cx="${x}" cy="${headY - jumpH - headR * 0.3}" rx="${headR * 0.9}" ry="${headR * 0.5}" fill="#2a1a0a"/>`
      torso = `<rect x="${x - w}" y="${shoulderY - jumpH}" width="${w * 2}" height="${torsoH}" rx="2" fill="${jersey}"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY - jumpH + 4}" x2="${x - w - 8}" y2="${shoulderY - jumpH + armH * 0.6}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY - jumpH + 4}" x2="${x + w + 8}" y2="${shoulderY - jumpH + armH * 0.6}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>`
    } else {
      // Standing/default
      legs = `<line x1="${x - 4}" y1="${hipY}" x2="${x - 5}" y2="${footY}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <line x1="${x + 4}" y1="${hipY}" x2="${x + 5}" y2="${footY}" stroke="${shorts}" stroke-width="${w * 0.7}" stroke-linecap="round"/>
              <circle cx="${x - 5}" cy="${footY}" r="${headR * 0.6}" fill="#222"/>
              <circle cx="${x + 5}" cy="${footY}" r="${headR * 0.6}" fill="#222"/>`
      arms = `<line x1="${x - w}" y1="${shoulderY + 4}" x2="${x - w - 6}" y2="${shoulderY + armH}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>
              <line x1="${x + w}" y1="${shoulderY + 4}" x2="${x + w + 6}" y2="${shoulderY + armH}" stroke="${skin}" stroke-width="${w * 0.5}" stroke-linecap="round"/>`
    }

    return `<g>${legs}${torso}${arms}${head}</g>`
  }

  const skins = ['#f4c7a0', '#d4a373', '#8d5524', '#c68642', '#e0ac69', '#6b3f22']
  const rSkin = () => skins[Math.floor(Math.random() * skins.length)]
  const groundY = 235
  const horizon = 120

  // Pick a random goal scorer name for captions
  const allGoals = [...homeGoals, ...awayGoals]
  const randomScorer = allGoals.length ? allGoals[Math.floor(Math.random() * allGoals.length)] : null

  let figures = '', ballSvg = '', caption = '', extraElements = ''

  if (type === 'shot') {
    caption = (randomScorer ? randomScorer.scorer : 'Striker') + ' unleashes a powerful shot'
    // Shooter in foreground (large), GK in background (smaller), defender nearby
    figures += person(220, groundY, 90, hc, hc2, rSkin(), 'kicking')
    figures += person(420, groundY - 10, 65, ac, ac2, rSkin(), 'standing')  // GK
    figures += person(320, groundY, 70, ac, ac2, rSkin(), 'running')  // defender
    figures += person(140, groundY + 5, 55, hc, hc2, rSkin(), 'running')  // support
    ballSvg = `<circle cx="280" cy="${groundY - 15}" r="6" fill="white" stroke="#aaa" stroke-width="0.5"/>`
    // Motion blur on ball
    extraElements = `<ellipse cx="265" cy="${groundY - 14}" rx="12" ry="3" fill="rgba(255,255,255,0.15)"/>`
  } else if (type === 'celebration') {
    const scorer = randomScorer ? randomScorer.scorer : 'Goal scorer'
    const cTeam = winner === 'home' || !winner ? hc : ac
    const cTeam2 = winner === 'home' || !winner ? hc2 : ac2
    caption = scorer + ' celebrates with teammates!'
    // Main celebrator large in center, teammates running toward
    figures += person(280, groundY, 95, cTeam, cTeam2, rSkin(), 'celebrating')
    figures += person(180, groundY + 5, 70, cTeam, cTeam2, rSkin(), 'running')
    figures += person(400, groundY + 3, 65, cTeam, cTeam2, rSkin(), 'running')
    figures += person(100, groundY + 8, 50, cTeam, cTeam2, rSkin(), 'celebrating')
    // Dejected opponent in background
    figures += person(500, groundY - 5, 48, ac, ac2, rSkin(), 'standing')
    ballSvg = `<circle cx="540" cy="${groundY}" r="5" fill="white" stroke="#aaa" stroke-width="0.5"/>`
  } else if (type === 'tackle') {
    caption = 'Crunching challenge in the midfield'
    // Two players contesting, one sliding
    figures += person(260, groundY, 85, hc, hc2, rSkin(), 'kicking')
    figures += person(310, groundY, 80, ac, ac2, rSkin(), 'running')
    figures += person(160, groundY + 5, 55, hc, hc2, rSkin(), 'running')
    figures += person(430, groundY + 3, 52, ac, ac2, rSkin(), 'standing')
    ballSvg = `<circle cx="285" cy="${groundY - 5}" r="6" fill="white" stroke="#aaa" stroke-width="0.5"/>`
    // Grass spray
    extraElements = Array.from({ length: 8 }, () => {
      const gx = 275 + Math.random() * 30, gy = groundY - Math.random() * 15
      return `<circle cx="${gx}" cy="${gy}" r="${1 + Math.random()}" fill="#4a8" opacity="${0.3 + Math.random() * 0.4}"/>`
    }).join('')
  } else if (type === 'save') {
    caption = 'Spectacular diving save keeps the score level'
    // GK diving large in foreground, striker behind
    figures += person(300, groundY, 85, ac, ac2, rSkin(), 'diving')
    figures += person(180, groundY + 3, 70, hc, hc2, rSkin(), 'kicking')
    figures += person(100, groundY + 8, 50, hc, hc2, rSkin(), 'running')
    figures += person(430, groundY + 5, 48, ac, ac2, rSkin(), 'standing')
    ballSvg = `<circle cx="245" cy="${groundY - 40}" r="6" fill="white" stroke="#aaa" stroke-width="0.5"/>`
    // Glove/hand reach effect
    extraElements = `<ellipse cx="250" cy="${groundY - 38}" rx="8" ry="4" fill="rgba(255,255,0,0.2)"/>`
  } else if (type === 'header') {
    caption = 'Rising highest to meet the cross'
    figures += person(280, groundY, 90, hc, hc2, rSkin(), 'heading')
    figures += person(310, groundY, 82, ac, ac2, rSkin(), 'heading')
    figures += person(180, groundY + 5, 55, hc, hc2, rSkin(), 'standing')
    figures += person(430, groundY + 3, 50, ac, ac2, rSkin(), 'running')
    ballSvg = `<circle cx="290" cy="${groundY - 90}" r="6" fill="white" stroke="#aaa" stroke-width="0.5"/>`
  } else { // dribble
    caption = 'Skillful run past the defender'
    figures += person(250, groundY, 88, hc, hc2, rSkin(), 'running')
    figures += person(310, groundY + 2, 78, ac, ac2, rSkin(), 'running')
    figures += person(150, groundY + 6, 52, hc, hc2, rSkin(), 'running')
    figures += person(440, groundY + 4, 48, ac, ac2, rSkin(), 'standing')
    ballSvg = `<circle cx="265" cy="${groundY - 3}" r="6" fill="white" stroke="#aaa" stroke-width="0.5"/>`
  }

  // Stadium crowd in background
  const crowdRows = Array.from({ length: 60 }, (_, i) => {
    const cx = 10 + (i % 30) * 20 + Math.random() * 10
    const cy = 40 + Math.floor(i / 30) * 18 + Math.random() * 8
    const c = Math.random() > 0.5 ? hc : Math.random() > 0.3 ? ac : ['#e44', '#44e', '#ee4', '#fff', '#f80'][Math.floor(Math.random() * 5)]
    const sz = 3 + Math.random() * 2
    return `<circle cx="${cx}" cy="${cy}" r="${sz}" fill="${c}" opacity="${0.3 + Math.random() * 0.3}"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" style="width:100%;border-radius:8px;overflow:hidden">
  <defs>
    <linearGradient id="sky${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a2a44"/><stop offset="60%" stop-color="#2a3a55"/><stop offset="100%" stop-color="#3a4a55"/>
    </linearGradient>
    <linearGradient id="grass${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2d6b3f"/><stop offset="100%" stop-color="#1a5c2e"/>
    </linearGradient>
    <radialGradient id="vig${uid}" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="transparent"/><stop offset="100%" stop-color="rgba(0,0,0,0.55)"/>
    </radialGradient>
    <radialGradient id="spot${uid}" cx="50%" cy="30%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,200,0.08)"/><stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <filter id="blur${uid}"><feGaussianBlur stdDeviation="1.5"/></filter>
    <filter id="dof${uid}"><feGaussianBlur stdDeviation="0.8"/></filter>
  </defs>

  <!-- Sky -->
  <rect width="600" height="${horizon}" fill="url(#sky${uid})"/>

  <!-- Stadium structure -->
  <rect x="0" y="30" width="600" height="${horizon - 30}" fill="#1a1a2e" rx="0"/>
  <rect x="0" y="30" width="600" height="8" fill="#252540"/>

  <!-- Floodlights -->
  <rect x="50" y="10" width="4" height="30" fill="#555"/>
  <circle cx="52" cy="10" r="5" fill="#ffe066" opacity="0.8"/>
  <rect x="546" y="10" width="4" height="30" fill="#555"/>
  <circle cx="548" cy="10" r="5" fill="#ffe066" opacity="0.8"/>

  <!-- Crowd (blurred background) -->
  <g filter="url(#blur${uid})">${crowdRows}</g>

  <!-- Pitch surface (ground level perspective) -->
  <rect x="0" y="${horizon}" width="600" height="${300 - horizon}" fill="url(#grass${uid})"/>
  <!-- Grass stripes -->
  ${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 80 - 10}" y="${horizon}" width="40" height="${300 - horizon}" fill="rgba(255,255,255,0.02)"/>`).join('')}
  <!-- Pitch line -->
  <line x1="0" y1="${horizon + 5}" x2="600" y2="${horizon + 5}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Stadium spotlight glow -->
  <rect width="600" height="300" fill="url(#spot${uid})"/>

  <!-- Action figures -->
  <g filter="url(#dof${uid})">
  ${figures}
  </g>

  <!-- Ball -->
  ${ballSvg}

  <!-- Extra effects -->
  ${extraElements}

  <!-- Vignette -->
  <rect width="600" height="300" fill="url(#vig${uid})"/>

  <!-- Caption bar -->
  <rect x="0" y="258" width="600" height="42" fill="rgba(0,0,0,0.8)"/>
  <text x="16" y="278" fill="white" font-size="11" font-weight="700" font-family="system-ui">${hName} ${s[0]} - ${s[1]} ${aName}</text>
  <text x="584" y="278" text-anchor="end" fill="rgba(255,255,255,0.5)" font-size="10" font-style="italic" font-family="system-ui">${caption}</text>
  <text x="16" y="293" fill="rgba(255,255,255,0.25)" font-size="8" font-family="monospace">${CONFIG.league.shortName} Season ${match._season || ''} \u2022 Matchday ${match._md || ''} \u2022 \u{1F4F7} ${CONFIG.league.shortName} Media</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Local matchday report generator (football columnist engine)
// ---------------------------------------------------------------------------
function generateLocalReport(matches, standings, topScorers, league, mdNum, seasonNum) {
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

  // Find best performer across all matches
  let motm = { name: 'Unknown', team: 'Unknown', grade: 0, goals: 0, assists: 0, saves: 0 }
  matches.forEach(m => {
    if (!m.playerStats) return
    const all = [...(m.playerStats.home || []), ...(m.playerStats.away || [])]
    all.forEach(p => {
      const score = (p.grade || 0) * 2 + (p.goals || 0) * 3 + (p.assists || 0) * 2 + (p.saves || 0) * 0.5
      const best = motm.grade * 2 + motm.goals * 3 + motm.assists * 2 + motm.saves * 0.5
      if (score > best) {
        motm = { name: p.name, team: m.playerStats.home.includes(p) ? m.home : m.away, grade: p.grade || 0, goals: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0 }
      }
    })
  })

  // Headline templates
  const headlineTemplates = [
    () => totalGoals >= matches.length * 4 ? 'Goals Galore on a Sensational Matchday ' + mdNum : null,
    () => draws.length >= Math.ceil(matches.length / 2) ? 'Stalemate Saturday: Draws Dominate Matchday ' + mdNum : null,
    () => bigWin.diff >= 4 ? bigWin.match.score[0] > bigWin.match.score[1] ? bigWin.match.home + ' Run Riot in Matchday ' + mdNum + ' Masterclass' : bigWin.match.away + ' Demolish ' + bigWin.match.home + ' in Stunning Away Day' : null,
    () => leader.points - (second.points || 0) >= 4 ? leader.team + ' Tighten Grip at the Summit' : null,
    () => 'Drama, Goals, and Heartbreak: Matchday ' + mdNum + ' Has It All',
    () => 'Matchday ' + mdNum + ' Delivers the Goods in Season ' + seasonNum,
    () => 'A Matchday to Remember as the ' + CONFIG.league.shortName + ' Title Race Heats Up',
    () => 'Thunder and Lightning: ' + CONFIG.league.shortName + ' Matchday ' + mdNum + ' Leaves Its Mark'
  ]
  const headline = headlineTemplates.map(f => f()).filter(Boolean)[0] || pick(headlineTemplates.slice(4)).call()

  const subTemplates = [
    totalGoals + ' goals across ' + matches.length + ' matches \u2014 just another day in the ' + CONFIG.league.shortName,
    'From the sublime to the ridiculous, Season ' + seasonNum + ' continues to deliver',
    leader.team + ' lead the way as the battle rages on all fronts',
    'The beautiful game at its finest \u2014 and most chaotic'
  ]

  // Lede templates
  const ledeTemplates = [
    'Matchday ' + mdNum + ' of the ' + CONFIG.league.name + ' served up a feast of football that will live long in the memory. With ' + totalGoals + ' goals shared across ' + matches.length + ' fixtures, the ' + CONFIG.league.shortName + ' once again proved why it is the most unpredictable league in all of Labornis.',
    'If you blinked during Matchday ' + mdNum + ', you missed something. The ' + CONFIG.league.shortName + ' faithful were treated to ' + totalGoals + ' goals, dramatic comebacks, and the kind of football that reminds us why we fell in love with this beautiful game in the first place.',
    'Another week, another round of chaos in the ' + CONFIG.league.name + '. Matchday ' + mdNum + ' had everything \u2014 ' + totalGoals + ' goals, ' + draws.length + ' draw' + (draws.length !== 1 ? 's' : '') + ', and enough talking points to fill a press conference marathon.',
    'The ' + CONFIG.league.shortName + ' never disappoints, and Matchday ' + mdNum + ' was no exception. ' + totalGoals + ' goals flew in across ' + matches.length + ' matches as the title race and the battle at the bottom both took dramatic turns.'
  ]

  // Match report generation
  const goalVerbs = ['fired home', 'slotted past the keeper', 'thundered in', 'curled beautifully into the net', 'poked home from close range', 'headed in powerfully', 'smashed into the top corner', 'calmly converted', 'rifled in', 'drilled low and hard into the corner']
  const assistVerbs = ['set up by a delightful ball from', 'after brilliant work from', 'following a pinpoint delivery from', 'teed up expertly by', 'courtesy of a sublime pass from']
  const winPhrases = ['proved too strong for', 'dismantled', 'edged past', 'overcame', 'got the better of', 'dispatched', 'saw off the challenge of']
  const drawPhrases = ['shared the spoils with', 'battled to a draw against', 'couldn\'t be separated from', 'played out an entertaining draw with']
  const coachPraise = ['will be delighted with the tactical setup', 'got his game plan spot on', 'deserves credit for the team\'s organization', 'masterminded a brilliant performance']
  const coachCrit = ['will have questions to answer after the display', 'must find solutions quickly', 'saw his tactics come unstuck', 'will be scratching his head']
  const shutoutPhrases = ['kept a clean sheet', 'marshalled the defense superbly', 'was a fortress at the back']
  const highScoringPhrases = ['what a game this was', 'the neutral\'s dream fixture', 'end-to-end stuff that had everyone on the edge of their seats', 'pure box-office entertainment']
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

    // Title
    let title
    if (isDraw) title = m.home + ' ' + s[0] + '-' + s[1] + ' ' + m.away + ': ' + pick(['Honors Even', 'Points Shared', 'Neither Side Can Find the Winner', 'A Fair Result in the End'])
    else if (goalDiff >= 4) title = winner + ' ' + pick(['Thrash', 'Demolish', 'Run Riot Against']) + ' ' + loser
    else if (isShutout) title = winner + ' ' + pick(['Shut Out', 'Blank', 'Keep Clean Sheet Against']) + ' ' + loser
    else title = winner + ' ' + pick(['Edge', 'See Off', 'Overcome', 'Defeat']) + ' ' + loser + ' in ' + pick(['Thriller', 'Contest', 'Battle', 'Encounter'])

    // Body paragraphs
    let para1 = ''
    if (isDraw) {
      para1 = m.home + ' ' + pick(drawPhrases) + ' ' + m.away + ' in a ' + s[0] + '-' + s[1] + ' draw at home. '
      if (isHighScoring) para1 += pick(highScoringPhrases).charAt(0).toUpperCase() + pick(highScoringPhrases).slice(1) + '. '
    } else {
      para1 = winner + ' ' + pick(winPhrases) + ' ' + loser + ' with a convincing ' + s[0] + '-' + s[1] + ' ' + (winner === m.home ? 'home' : 'away') + ' victory. '
      if (goalDiff >= 3) para1 += 'It was men against boys at times, as ' + loser + ' simply had no answer. '
      if (isShutout) para1 += 'The defense ' + pick(shutoutPhrases) + ', leaving ' + loser + '\'s forwards with nothing to show for their efforts. '
    }

    // Goal descriptions
    let para2 = ''
    const scorers = {}
    allGoals.forEach(g => { scorers[g.scorer] = (scorers[g.scorer] || 0) + 1 })
    const multiScorers = Object.entries(scorers).filter(([_, c]) => c >= 2)

    if (multiScorers.length) {
      const [name, count] = multiScorers[0]
      const team = allGoals.find(g => g.scorer === name).team
      para2 += name + ' was the star of the show with ' + count + ' goals for ' + team + ', '
      para2 += count >= 3 ? 'completing a stunning hat-trick that ' + pick(['will make the highlight reels', 'brought the crowd to their feet', 'was simply unstoppable']) + '. ' : pick(['a brace that proved decisive', 'two goals that swung the contest']) + '. '
    }

    const keyGoals = allGoals.slice(0, 3)
    keyGoals.forEach((g, i) => {
      if (multiScorers.some(([n]) => n === g.scorer) && i > 0) return
      para2 += g.scorer + ' ' + pick(goalVerbs)
      if (g.assister) para2 += ', ' + pick(assistVerbs) + ' ' + g.assister
      para2 += '. '
    })

    // Tactical/coaching paragraph
    let para3 = ''
    if (winner) {
      const winCoach = winner === m.home ? homeCoach : awayCoach
      const loseCoach = winner === m.home ? awayCoach : homeCoach
      para3 += winCoach + ' ' + pick(coachPraise) + ', while ' + loseCoach + ' ' + pick(coachCrit) + '. '
    } else {
      para3 += homeCoach + ' and ' + awayCoach + ' will both feel a draw was a fair outcome. '
    }
    para3 += 'This result leaves ' + m.home + ' ' + pick(['sitting', 'positioned', 'placed']) + ' ' + ordinal(homePos) + ' in the table'
    para3 += ' while ' + m.away + ' ' + pick(['occupy', 'find themselves in', 'sit in']) + ' ' + ordinal(awayPos) + ' place.'

    return {
      home: m.home, away: m.away, score: s,
      title,
      body: para1 + '\n\n' + para2 + '\n\n' + para3
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

  // Look ahead
  const lookAheadTemplates = [
    'As the dust settles on Matchday ' + mdNum + ', ' + leader.team + ' will sleep soundly at the top with ' + (leader.points || 0) + ' points. But with ' + (standings.length ? (standings[0].played ? (league.teams.length - 1) - standings[0].played : 'many') : 'many') + ' matchdays still to play, nothing is decided. ' + bottom.team + ' know they must start picking up points soon, while the chasing pack will be sharpening their claws. The ' + CONFIG.league.shortName + ' waits for no one.',
    'Matchday ' + mdNum + ' may be over, but its reverberations will be felt for weeks to come. ' + leader.team + ' march on at the summit, but ' + second.team + ' remain within striking distance. At the bottom, ' + bottom.team + ' face an increasingly anxious run of fixtures. One thing is certain: this ' + CONFIG.league.shortName + ' season is far from over.',
    'The table never lies, they say \u2014 but in the ' + CONFIG.league.shortName + ', it certainly whispers. ' + leader.team + ' hold the advantage for now, but the margins are razor-thin. Every point will matter from here on out, and if Matchday ' + mdNum + ' taught us anything, it\'s that this league always has one more twist in store.'
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

function simulateMatchWithEngine(homeTeam, awayTeam) {
  const league = readJSON('league.json')
  const home = league.teams.find(t => t.name === homeTeam)
  const away = league.teams.find(t => t.name === awayTeam)
  if (!home || !away) return null

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
    // Build standings
    const schedTeams = new Set()
    for (const md of schedule.matchdays) { for (const m of md.matches) { schedTeams.add(m.home); schedTeams.add(m.away) } }
    const table = {}
    for (const name of schedTeams) table[name] = { team: name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
    for (const md of schedule.matchdays) {
      for (const m of md.matches) {
        if (m.status !== 'completed') continue
        const hh = table[m.home], aa = table[m.away]
        if (!hh || !aa) continue
        hh.p++; aa.p++
        hh.gf += m.score[0]; hh.ga += m.score[1]
        aa.gf += m.score[1]; aa.ga += m.score[0]
        if (m.score[0] > m.score[1]) { hh.w++; hh.pts += 3; aa.l++ }
        else if (m.score[1] > m.score[0]) { aa.w++; aa.pts += 3; hh.l++ }
        else { hh.d++; aa.d++; hh.pts++; aa.pts++ }
      }
    }
    const sorted = Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)
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
    // Coach of the Year: team with best win% in regular season
    const schedTeams = new Set()
    for (const md of schedule.matchdays) { for (const m of md.matches) { schedTeams.add(m.home); schedTeams.add(m.away) } }
    const tbl = {}
    for (const name of schedTeams) tbl[name] = { team: name, w: 0, d: 0, l: 0, p: 0 }
    for (const md of schedule.matchdays) {
      for (const m of md.matches) {
        if (m.status !== 'completed') continue
        const hh = tbl[m.home], aa = tbl[m.away]
        if (!hh || !aa) continue
        hh.p++; aa.p++
        if (m.score[0] > m.score[1]) { hh.w++; aa.l++ } else if (m.score[1] > m.score[0]) { aa.w++; hh.l++ } else { hh.d++; aa.d++ }
      }
    }
    const coachRank = Object.values(tbl).sort((a, b) => ((b.w + b.d * 0.5) / b.p) - ((a.w + a.d * 0.5) / a.p))
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
    const prefs = readJSON('preferences.json')
    const newSeasonNum = history.currentSeason + 1

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
      // Recalculate team rating
      const starters = t.players.filter(p => p.starter)
      if (starters.length) t.rating = String(Math.round(starters.reduce((a, p) => a + parseInt(p.rating, 10), 0) / starters.length))
      // Age up players
      for (const p of t.players) { if (p.age) p.age++ }
    }
    writeJSON('league.json', league)

    // Determine team count for this season (check expansions/contractions)
    let teamCount = prefs.defaultTeamCount
    const exp = (prefs.expansions || []).find(e => e.season === newSeasonNum)
    const con = (prefs.contractions || []).find(c => c.season === newSeasonNum)
    if (exp) teamCount += exp.teams
    if (con) teamCount -= con.teams

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

    // Generate single round-robin schedule with balanced home/away
    const teams = league.teams.map(t => t.name)
    const n = teams.length
    const rounds = n - 1
    const half = n / 2
    const roster = [...teams]
    const fixed = roster.shift()
    const homeCount = {}
    teams.forEach(t => homeCount[t] = 0)

    // Determine top-half finishers from previous season for home advantage
    const prevSeason = history.seasons.find(s => s.number === newSeasonNum - 1)
    const topHalf = new Set()
    if (prevSeason && prevSeason.standings && prevSeason.standings.length) {
      const sorted = [...prevSeason.standings].sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga))
      const topCount = Math.ceil(sorted.length / 2)
      sorted.slice(0, topCount).forEach(s => topHalf.add(s.team))
    }

    const allPairings = []
    for (let r = 0; r < rounds; r++) {
      const md = { number: r + 1, matches: [] }
      for (let i = 0; i < half; i++) {
        const a = i === 0 ? fixed : roster[i - 1]
        const b = roster[roster.length - i - 1]
        allPairings.push({ a, b, md: r })
      }
      roster.push(roster.shift())
    }

    // Greedy home/away assignment with top-half bonus
    const targetHome = {}
    const maxHome = Math.ceil((n - 1) / 2)
    const minHome = Math.floor((n - 1) / 2)
    teams.forEach(t => targetHome[t] = topHalf.has(t) ? maxHome : minHome)

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
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }
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
      // Recalculate team rating
      const starters = team.players.filter(p => p.starter)
      team.rating = String(Math.round(starters.reduce((a, p) => a + parseInt(p.rating, 10), 0) / starters.length))
    }
    if (international !== undefined) player.international = !!international
    writeJSON('league.json', league)
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }
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
    try { execSync('node build-site.js', { cwd: __dirname, timeout: 10000 }) } catch (e) { /* ignore */ }
    return jsonRes(res, { success: true })
  }

  // --- Generate Matchday Report (local engine) ---
  const reportMatch = pathname.match(/^\/api\/generate-report\/(\d+)$/)
  if (reportMatch && req.method === 'POST') {
    const mdNum = parseInt(reportMatch[1], 10)
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

    const report = generateLocalReport(completedMatches, standings, topScorers, league, mdNum, schedule.season)

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
      const types = ['celebration', 'action', 'save', 'kickoff']
      // Pick 2 different moment types
      const t1 = types[Math.floor(Math.random() * types.length)]
      let t2 = types[Math.floor(Math.random() * types.length)]
      while (t2 === t1) t2 = types[Math.floor(Math.random() * types.length)]
      return [generateMatchStill(m, homeTeam, awayTeam, t1), generateMatchStill(m, homeTeam, awayTeam, t2)]
    })

    return jsonRes(res, { success: true, report, season: schedule.season, matchday: mdNum })
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
