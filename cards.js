#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LFA Card Generator — creates HTML profile cards for players and coaches
//
// Usage:
//   node cards.js player <name>       — generate player card
//   node cards.js coach <team#>       — generate coach card
//   node cards.js all                 — generate all cards
//   node cards.js awards [season#]    — generate awards page for a season
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')

const leaguePath = path.join(__dirname, 'data', 'league.json')
const historyPath = path.join(__dirname, 'data', 'history.json')
const cardsDir = path.join(__dirname, 'cards')
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))

function loadLeague() { return JSON.parse(fs.readFileSync(leaguePath, 'utf8')) }
function loadHistory() { return JSON.parse(fs.readFileSync(historyPath, 'utf8')) }

if (!fs.existsSync(cardsDir)) fs.mkdirSync(cardsDir, { recursive: true })

// ---------------------------------------------------------------------------
// SVG Profile Picture Generator (deterministic based on name + position)
// ---------------------------------------------------------------------------
function hashStr(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function hslColor(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)` }

function generatePlayerAvatar(name, position, teamColors) {
  const hash = hashStr(name)
  const primary = teamColors.primary || '#333'
  const secondary = teamColors.secondary || '#666'
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  // Skin tone variation
  const skinHue = 25 + (hash % 20)
  const skinSat = 40 + (hash % 30)
  const skinLight = 55 + (hash % 25)
  const skinColor = hslColor(skinHue, skinSat, skinLight)
  // Hair
  const hairStyles = ['short', 'medium', 'bald', 'curly']
  const hairStyle = hairStyles[hash % hairStyles.length]
  const hairHue = (hash * 7) % 360
  const hairColor = (hash % 4 === 0) ? '#1a1a1a' : (hash % 4 === 1) ? '#4a3728' : (hash % 4 === 2) ? '#8B6914' : '#2c1810'
  // Face shape variation
  const faceWidth = 32 + (hash % 8)
  const faceHeight = 38 + (hash % 6)
  // Eye variation
  const eyeSpacing = 8 + (hash % 4)
  const eyeY = 44 + (hash % 3)
  // Position badge
  const posBadgeColor = position === 'GK' ? '#f59e0b' : position === 'CB' ? '#3b82f6' : position === 'CM' ? '#10b981' : '#ef4444'

  let hairSvg = ''
  if (hairStyle === 'short') {
    hairSvg = `<ellipse cx="50" cy="32" rx="${faceWidth + 2}" ry="18" fill="${hairColor}"/>`
  } else if (hairStyle === 'medium') {
    hairSvg = `<ellipse cx="50" cy="30" rx="${faceWidth + 4}" ry="22" fill="${hairColor}"/>
    <rect x="${50 - faceWidth - 2}" y="30" width="${(faceWidth + 2) * 2}" height="18" rx="4" fill="${hairColor}"/>`
  } else if (hairStyle === 'curly') {
    hairSvg = `<ellipse cx="50" cy="30" rx="${faceWidth + 5}" ry="22" fill="${hairColor}"/>
    <circle cx="${50 - faceWidth + 2}" cy="28" r="6" fill="${hairColor}"/>
    <circle cx="${50 + faceWidth - 2}" cy="28" r="6" fill="${hairColor}"/>
    <circle cx="50" cy="22" r="7" fill="${hairColor}"/>`
  }
  // bald = no hair SVG

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="140" height="140">
    <defs>
      <linearGradient id="bg_${hash}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${primary}"/>
        <stop offset="100%" stop-color="${secondary}"/>
      </linearGradient>
      <clipPath id="circle_${hash}"><circle cx="50" cy="50" r="48"/></clipPath>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#bg_${hash})" stroke="#fff" stroke-width="2"/>
    <g clip-path="url(#circle_${hash})">
      <!-- Body/Jersey -->
      <ellipse cx="50" cy="95" rx="35" ry="25" fill="${primary}"/>
      <rect x="30" y="72" width="40" height="28" rx="8" fill="${primary}"/>
      <rect x="38" y="76" width="24" height="4" rx="2" fill="${secondary}" opacity="0.6"/>
      <!-- Neck -->
      <rect x="43" y="62" width="14" height="14" rx="4" fill="${skinColor}"/>
      <!-- Hair (behind head) -->
      ${hairSvg}
      <!-- Head -->
      <ellipse cx="50" cy="45" rx="${faceWidth}" ry="${faceHeight}" fill="${skinColor}"/>
      <!-- Eyes -->
      <ellipse cx="${50 - eyeSpacing}" cy="${eyeY}" rx="3.5" ry="2.5" fill="white"/>
      <ellipse cx="${50 + eyeSpacing}" cy="${eyeY}" rx="3.5" ry="2.5" fill="white"/>
      <circle cx="${50 - eyeSpacing}" cy="${eyeY}" r="1.8" fill="#2c1810"/>
      <circle cx="${50 + eyeSpacing}" cy="${eyeY}" r="1.8" fill="#2c1810"/>
      <!-- Eyebrows -->
      <line x1="${50 - eyeSpacing - 4}" y1="${eyeY - 5}" x2="${50 - eyeSpacing + 4}" y2="${eyeY - 5.5}" stroke="${hairColor}" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="${50 + eyeSpacing - 4}" y1="${eyeY - 5.5}" x2="${50 + eyeSpacing + 4}" y2="${eyeY - 5}" stroke="${hairColor}" stroke-width="1.5" stroke-linecap="round"/>
      <!-- Nose -->
      <path d="M48,${eyeY + 5} Q50,${eyeY + 10} 52,${eyeY + 5}" fill="none" stroke="${hslColor(skinHue, skinSat, skinLight - 15)}" stroke-width="1.2"/>
      <!-- Mouth -->
      <path d="M44,${eyeY + 13} Q50,${eyeY + 16 + (hash % 3)} 56,${eyeY + 13}" fill="none" stroke="${hslColor(skinHue, skinSat, skinLight - 20)}" stroke-width="1.3" stroke-linecap="round"/>
      <!-- Ears -->
      <ellipse cx="${50 - faceWidth + 1}" cy="${eyeY + 2}" rx="3" ry="5" fill="${skinColor}"/>
      <ellipse cx="${50 + faceWidth - 1}" cy="${eyeY + 2}" rx="3" ry="5" fill="${skinColor}"/>
    </g>
    <!-- Position badge -->
    <circle cx="82" cy="82" r="12" fill="${posBadgeColor}" stroke="#fff" stroke-width="1.5"/>
    <text x="82" y="86" text-anchor="middle" fill="white" font-size="9" font-weight="bold" font-family="Arial">${position}</text>
  </svg>`
}

function generateCoachAvatar(name, teamColors) {
  const hash = hashStr(name)
  const primary = teamColors.primary || '#333'
  const secondary = teamColors.secondary || '#666'
  const skinHue = 25 + (hash % 20)
  const skinSat = 40 + (hash % 30)
  const skinLight = 55 + (hash % 25)
  const skinColor = hslColor(skinHue, skinSat, skinLight)
  const hairColor = (hash % 3 === 0) ? '#888' : (hash % 3 === 1) ? '#555' : '#aaa'  // coaches tend gray
  const faceWidth = 33 + (hash % 6)
  const eyeSpacing = 8 + (hash % 4)
  const eyeY = 44 + (hash % 3)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="140" height="140">
    <defs>
      <linearGradient id="cbg_${hash}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${primary}"/>
        <stop offset="100%" stop-color="${secondary}"/>
      </linearGradient>
      <clipPath id="ccircle_${hash}"><circle cx="50" cy="50" r="48"/></clipPath>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#cbg_${hash})" stroke="#fff" stroke-width="2"/>
    <g clip-path="url(#ccircle_${hash})">
      <!-- Suit -->
      <ellipse cx="50" cy="95" rx="38" ry="28" fill="#2d2d2d"/>
      <rect x="28" y="70" width="44" height="30" rx="6" fill="#2d2d2d"/>
      <!-- Shirt collar -->
      <polygon points="42,72 50,80 58,72" fill="white"/>
      <!-- Tie -->
      <polygon points="48,78 52,78 51,92 49,92" fill="${primary}"/>
      <!-- Neck -->
      <rect x="43" y="62" width="14" height="14" rx="4" fill="${skinColor}"/>
      <!-- Hair -->
      <ellipse cx="50" cy="32" rx="${faceWidth + 1}" ry="16" fill="${hairColor}"/>
      <!-- Head -->
      <ellipse cx="50" cy="45" rx="${faceWidth}" ry="38" fill="${skinColor}"/>
      <!-- Eyes -->
      <ellipse cx="${50 - eyeSpacing}" cy="${eyeY}" rx="3.5" ry="2.5" fill="white"/>
      <ellipse cx="${50 + eyeSpacing}" cy="${eyeY}" rx="3.5" ry="2.5" fill="white"/>
      <circle cx="${50 - eyeSpacing}" cy="${eyeY}" r="1.8" fill="#2c1810"/>
      <circle cx="${50 + eyeSpacing}" cy="${eyeY}" r="1.8" fill="#2c1810"/>
      <!-- Eyebrows -->
      <line x1="${50 - eyeSpacing - 4}" y1="${eyeY - 5}" x2="${50 - eyeSpacing + 4}" y2="${eyeY - 5.5}" stroke="${hairColor}" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="${50 + eyeSpacing - 4}" y1="${eyeY - 5.5}" x2="${50 + eyeSpacing + 4}" y2="${eyeY - 5}" stroke="${hairColor}" stroke-width="1.8" stroke-linecap="round"/>
      <!-- Nose -->
      <path d="M48,${eyeY + 5} Q50,${eyeY + 10} 52,${eyeY + 5}" fill="none" stroke="${hslColor(skinHue, skinSat, skinLight - 15)}" stroke-width="1.2"/>
      <!-- Mouth -->
      <path d="M44,${eyeY + 13} Q50,${eyeY + 15} 56,${eyeY + 13}" fill="none" stroke="${hslColor(skinHue, skinSat, skinLight - 20)}" stroke-width="1.3" stroke-linecap="round"/>
      <!-- Ears -->
      <ellipse cx="${50 - faceWidth + 1}" cy="${eyeY + 2}" rx="3" ry="5" fill="${skinColor}"/>
      <ellipse cx="${50 + faceWidth - 1}" cy="${eyeY + 2}" rx="3" ry="5" fill="${skinColor}"/>
    </g>
    <!-- Coach badge -->
    <circle cx="82" cy="82" r="12" fill="#6366f1" stroke="#fff" stroke-width="1.5"/>
    <text x="82" y="87" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="Arial">HC</text>
  </svg>`
}

// ---------------------------------------------------------------------------
// Award badge SVG
// ---------------------------------------------------------------------------
function awardBadge(label, color) {
  return `<span class="award-badge" style="background:${color};">${label}</span>`
}

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------
function baseCSS() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0f1923;
      color: #e0e0e0;
      padding: 20px;
      min-height: 100vh;
    }
    .card {
      max-width: 700px;
      margin: 0 auto;
      background: linear-gradient(145deg, #1a2332, #0d1620);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 28px;
      position: relative;
      overflow: hidden;
    }
    .card-header::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      opacity: 0.08;
    }
    .avatar-container {
      flex-shrink: 0;
      border-radius: 50%;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      border: 3px solid rgba(255,255,255,0.15);
    }
    .player-info {
      flex: 1;
      z-index: 1;
    }
    .player-name {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
      letter-spacing: -0.5px;
    }
    .player-team {
      font-size: 15px;
      color: #94a3b8;
      margin-bottom: 8px;
    }
    .player-meta {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .meta-item {
      font-size: 13px;
      color: #64748b;
    }
    .meta-item span {
      color: #cbd5e1;
      font-weight: 600;
    }
    .rating-circle {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      flex-shrink: 0;
      z-index: 1;
    }
    .rating-high { background: linear-gradient(135deg, #059669, #10b981); }
    .rating-mid { background: linear-gradient(135deg, #d97706, #f59e0b); }
    .rating-low { background: linear-gradient(135deg, #dc2626, #ef4444); }
    .section {
      padding: 20px 28px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #64748b;
      margin-bottom: 14px;
    }
    .skills-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .skill-item {
      text-align: center;
      padding: 8px 4px;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
    }
    .skill-value {
      font-size: 20px;
      font-weight: 700;
    }
    .skill-label {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .skill-high { color: #10b981; }
    .skill-mid { color: #f59e0b; }
    .skill-low { color: #ef4444; }
    .stats-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .stats-table th {
      text-align: center;
      padding: 8px 6px;
      color: #64748b;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .stats-table th:first-child { text-align: left; }
    .stats-table td {
      text-align: center;
      padding: 7px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .stats-table td:first-child {
      text-align: left;
      color: #94a3b8;
      font-weight: 600;
    }
    .stats-table tr:hover td { background: rgba(255,255,255,0.02); }
    .stats-table .totals-row td {
      font-weight: 700;
      color: #fff;
      border-top: 2px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.03);
    }
    .awards-section {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .award-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
    }
    .championships-section {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .championship-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.12);
      border: 1px solid rgba(251, 191, 36, 0.25);
    }
    .captain-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.15);
      border: 1px solid rgba(251, 191, 36, 0.3);
      margin-left: 8px;
    }
    .coach-record {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      text-align: center;
    }
    .record-item .record-value {
      font-size: 28px;
      font-weight: 800;
      color: #fff;
    }
    .record-item .record-label {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 4px;
    }
    .no-data { color: #475569; font-style: italic; font-size: 14px; }
  `
}

function ratingClass(r) {
  const n = parseInt(r, 10)
  if (n >= 82) return 'rating-high'
  if (n >= 70) return 'rating-mid'
  return 'rating-low'
}

function skillClass(v) {
  const n = parseInt(v, 10)
  if (n >= 75) return 'skill-high'
  if (n >= 55) return 'skill-mid'
  return 'skill-low'
}

// ---------------------------------------------------------------------------
// Player Card
// ---------------------------------------------------------------------------
function generatePlayerCard(playerName) {
  const league = loadLeague()
  const history = loadHistory()

  let team = null, player = null
  for (const t of league.teams) {
    const p = t.players.find(p => p.name.toLowerCase() === playerName.toLowerCase())
    if (p) { team = t; player = p; break }
  }
  if (!player) { console.error(`Player not found: ${playerName}`); return null }

  const isCaptain = team.captain === player.name
  const isStarter = team.players.indexOf(player) < 6
  const avatar = generatePlayerAvatar(player.name, player.position, team.colors || {})

  // Collect career stats
  const seasonRows = []
  let totals = { app: 0, gls: 0, ast: 0, shots: 0, shotsOn: 0, passes: 0, passesOn: 0, tackles: 0, tacklesOn: 0, fouls: 0, saves: 0 }

  for (const season of history.seasons) {
    const ps = season.playerSeasonStats.find(
      p => p.name === player.name && p.team === team.name
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

    seasonRows.push({
      label: `S${season.number}`,
      app: ps.appearances,
      gls: ps.goals,
      ast: ps.assists,
      shots: ps.shots.total,
      shotPct: ps.shots.total > 0 ? Math.round(ps.shots.on / ps.shots.total * 100) + '%' : '-',
      passes: ps.passes.total,
      passPct: ps.passes.total > 0 ? Math.round(ps.passes.on / ps.passes.total * 100) + '%' : '-',
      tackles: ps.tackles.total,
      tckPct: ps.tackles.total > 0 ? Math.round(ps.tackles.on / ps.tackles.total * 100) + '%' : '-',
      fouls: ps.tackles.fouls,
      saves: ps.saves
    })
  }

  // Collect awards
  const playerAwards = []
  const championships = []
  for (const season of history.seasons) {
    if (!season.awards) continue
    const a = season.awards
    if (a.mvp && a.mvp.name === player.name && a.mvp.team === team.name)
      playerAwards.push({ season: season.number, award: CONFIG.awards.mvp, color: '#8b5cf6' })
    if (a.lfaPromise && a.lfaPromise.name === player.name && a.lfaPromise.team === team.name)
      playerAwards.push({ season: season.number, award: CONFIG.awards.lfaPromise, color: '#06b6d4' })
    if (a.goalkeeperOfSeason && a.goalkeeperOfSeason.name === player.name && a.goalkeeperOfSeason.team === team.name)
      playerAwards.push({ season: season.number, award: CONFIG.awards.goalkeeperOfSeason, color: '#f59e0b' })
    if (a.fieldPlayerOfYear && a.fieldPlayerOfYear.name === player.name && a.fieldPlayerOfYear.team === team.name)
      playerAwards.push({ season: season.number, award: CONFIG.awards.fieldPlayerOfYear, color: '#10b981' })
    if (a.fichichi && a.fichichi.name === player.name && a.fichichi.team === team.name)
      playerAwards.push({ season: season.number, award: CONFIG.awards.fichichi, color: '#ef4444' })
    if (a.assistKing && a.assistKing.name === player.name && a.assistKing.team === team.name)
      playerAwards.push({ season: season.number, award: CONFIG.awards.assistKing, color: '#3b82f6' })

    // Championships
    if (season.guyKilneTrophy && season.guyKilneTrophy.team === team.name) {
      const liftedTrophy = season.guyKilneTrophy.captain === player.name
      championships.push({ season: season.number, lifted: liftedTrophy })
    }
  }

  // Skills display
  const s = player.skill
  const skillItems = [
    { label: 'SPD', value: s.speed },
    { label: 'PAS', value: s.passing },
    { label: 'SHO', value: s.shooting },
    { label: 'TCK', value: s.tackling },
    { label: 'SAV', value: s.saving },
    { label: 'AGI', value: s.agility },
    { label: 'STR', value: s.strength },
    { label: 'JMP', value: s.jumping },
    { label: 'MRK', value: s.marking },
    { label: 'HDG', value: s.head_game },
    { label: 'SET', value: s.set_piece_taking },
    { label: 'PEN', value: s.penalty_taking }
  ]

  const statsHeaders = player.position === 'GK'
    ? '<th>Season</th><th>App</th><th>Gls</th><th>Ast</th><th>Saves</th><th>Pass</th><th>Pas%</th><th>Tck</th><th>Fouls</th>'
    : '<th>Season</th><th>App</th><th>Gls</th><th>Ast</th><th>Shots</th><th>Sht%</th><th>Pass</th><th>Pas%</th><th>Tck</th><th>Fouls</th>'

  const statsRows = seasonRows.map(r => {
    if (player.position === 'GK') {
      return `<tr><td>${r.label}</td><td>${r.app}</td><td>${r.gls}</td><td>${r.ast}</td><td>${r.saves !== undefined ? r.saves : '-'}</td><td>${r.passes}</td><td>${r.passPct}</td><td>${r.tackles}</td><td>${r.fouls}</td></tr>`
    }
    return `<tr><td>${r.label}</td><td>${r.app}</td><td>${r.gls}</td><td>${r.ast}</td><td>${r.shots}</td><td>${r.shotPct}</td><td>${r.passes}</td><td>${r.passPct}</td><td>${r.tackles}</td><td>${r.fouls}</td></tr>`
  }).join('\n')

  const totalsRow = player.position === 'GK'
    ? `<tr class="totals-row"><td>TOTAL</td><td>${totals.app}</td><td>${totals.gls}</td><td>${totals.ast}</td><td>${totals.saves}</td><td>${totals.passes}</td><td>${totals.passes > 0 ? Math.round(totals.passesOn / totals.passes * 100) + '%' : '-'}</td><td>${totals.tackles}</td><td>${totals.fouls}</td></tr>`
    : `<tr class="totals-row"><td>TOTAL</td><td>${totals.app}</td><td>${totals.gls}</td><td>${totals.ast}</td><td>${totals.shots}</td><td>${totals.shots > 0 ? Math.round(totals.shotsOn / totals.shots * 100) + '%' : '-'}</td><td>${totals.passes}</td><td>${totals.passes > 0 ? Math.round(totals.passesOn / totals.passes * 100) + '%' : '-'}</td><td>${totals.tackles}</td><td>${totals.fouls}</td></tr>`

  const awardsHtml = playerAwards.length > 0
    ? playerAwards.map(a => awardBadge(`S${a.season} ${a.award}`, a.color)).join('\n')
    : '<span class="no-data">No individual awards yet</span>'

  const champsHtml = championships.length > 0
    ? championships.map(c =>
        `<span class="championship-badge">${c.lifted ? '\u{1F3C6}' : '\u{1F3C5}'} S${c.season} Champion${c.lifted ? ' (Captain)' : ''}</span>`
      ).join('\n')
    : '<span class="no-data">No championships yet</span>'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${player.name} — ${CONFIG.league.shortName} Player Card</title>
<style>${baseCSS()}</style>
</head>
<body>
<div class="card">
  <div class="card-header" style="background: linear-gradient(135deg, ${(team.colors || {}).primary || '#333'}15, ${(team.colors || {}).secondary || '#666'}15);">
    <div class="avatar-container">${avatar}</div>
    <div class="player-info">
      <div class="player-name">${player.name}${isCaptain ? '<span class="captain-badge">C</span>' : ''}</div>
      <div class="player-team">${team.name} &mdash; ${player.position}${isStarter ? '' : ' (Sub)'}</div>
      <div class="player-meta">
        <div class="meta-item">Age: <span>${player.age || '-'}</span></div>
        <div class="meta-item">Height: <span>${player.height}cm</span></div>
        <div class="meta-item">Fitness: <span>${player.fitness}</span></div>
      </div>
    </div>
    <div class="rating-circle ${ratingClass(player.rating)}">${player.rating}</div>
  </div>

  <div class="section">
    <div class="section-title">Skills</div>
    <div class="skills-grid">
      ${skillItems.map(si => `<div class="skill-item"><div class="skill-value ${skillClass(si.value)}">${si.value}</div><div class="skill-label">${si.label}</div></div>`).join('\n')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Championships</div>
    <div class="championships-section">${champsHtml}</div>
  </div>

  <div class="section">
    <div class="section-title">Awards</div>
    <div class="awards-section">${awardsHtml}</div>
  </div>

  <div class="section">
    <div class="section-title">Career Statistics</div>
    ${seasonRows.length > 0 ? `
    <table class="stats-table">
      <thead><tr>${statsHeaders}</tr></thead>
      <tbody>${statsRows}\n${totalsRow}</tbody>
    </table>` : '<span class="no-data">No statistics recorded yet</span>'}
  </div>
</div>
</body>
</html>`

  const filename = player.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.html'
  const outPath = path.join(cardsDir, filename)
  fs.writeFileSync(outPath, html)
  return outPath
}

// ---------------------------------------------------------------------------
// Coach Card
// ---------------------------------------------------------------------------
function generateCoachCard(teamIdx) {
  const league = loadLeague()
  const history = loadHistory()
  const team = league.teams[teamIdx]
  if (!team) { console.error(`Invalid team index: ${teamIdx}`); return null }
  const coach = team.coach
  if (!coach) { console.error(`Team ${team.name} has no coach`); return null }

  const avatar = generateCoachAvatar(coach.name, team.colors || {})

  // Career stats
  let totalW = 0, totalD = 0, totalL = 0, totalP = 0, titles = 0
  const seasonRows = []
  const coachAwards = []

  for (const season of history.seasons) {
    const cs = season.coachSeasonStats.find(c => c.team === team.name)
    if (cs && cs.played > 0) {
      totalW += cs.won; totalD += cs.drawn; totalL += cs.lost; totalP += cs.played
      const seasonStanding = season.standings.findIndex(s => s.team === team.name) + 1
      seasonRows.push({
        label: `S${season.number}`,
        played: cs.played, won: cs.won, drawn: cs.drawn, lost: cs.lost, points: cs.points,
        finish: seasonStanding > 0 ? `#${seasonStanding}` : '-',
        champion: season.champion === team.name
      })
    }
    if (season.champion === team.name) titles++
    if (season.awards && season.awards.coachOfYear && season.awards.coachOfYear.team === team.name) {
      coachAwards.push({ season: season.number, award: CONFIG.awards.coachOfYear, color: '#8b5cf6' })
    }
  }

  const winPct = totalP > 0 ? Math.round(totalW / totalP * 100) : 0

  const awardsHtml = coachAwards.length > 0
    ? coachAwards.map(a => awardBadge(`S${a.season} ${a.award}`, a.color)).join('\n')
    : '<span class="no-data">No individual awards yet</span>'

  const champsHtml = titles > 0
    ? seasonRows.filter(r => r.champion).map(r =>
        `<span class="championship-badge">\u{1F3C6} ${r.label} Champion</span>`
      ).join('\n')
    : '<span class="no-data">No championships yet</span>'

  const seasonTableRows = seasonRows.map(r =>
    `<tr><td>${r.label}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.points}</td><td>${r.finish}${r.champion ? ' \u{1F3C6}' : ''}</td></tr>`
  ).join('\n')

  const totalsRowHtml = `<tr class="totals-row"><td>TOTAL</td><td>${totalP}</td><td>${totalW}</td><td>${totalD}</td><td>${totalL}</td><td>${totalW * 3 + totalD}</td><td>${titles} titles</td></tr>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${coach.name} — ${CONFIG.league.shortName} Coach Card</title>
<style>${baseCSS()}</style>
</head>
<body>
<div class="card">
  <div class="card-header" style="background: linear-gradient(135deg, ${(team.colors || {}).primary || '#333'}15, ${(team.colors || {}).secondary || '#666'}15);">
    <div class="avatar-container">${avatar}</div>
    <div class="player-info">
      <div class="player-name">${coach.name}</div>
      <div class="player-team">${team.name} &mdash; Head Coach</div>
      <div class="player-meta">
        <div class="meta-item">Age: <span>${coach.age || '-'}</span></div>
        <div class="meta-item">Style: <span>${coach.style}</span></div>
        <div class="meta-item">Win Rate: <span>${winPct}%</span></div>
      </div>
    </div>
    <div class="rating-circle ${ratingClass(coach.rating)}">${coach.rating}</div>
  </div>

  <div class="section">
    <div class="section-title">Career Record</div>
    <div class="coach-record">
      <div class="record-item"><div class="record-value">${totalW}</div><div class="record-label">Wins</div></div>
      <div class="record-item"><div class="record-value">${totalD}</div><div class="record-label">Draws</div></div>
      <div class="record-item"><div class="record-value">${totalL}</div><div class="record-label">Losses</div></div>
      <div class="record-item"><div class="record-value">${titles}</div><div class="record-label">Titles</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Championships</div>
    <div class="championships-section">${champsHtml}</div>
  </div>

  <div class="section">
    <div class="section-title">Awards</div>
    <div class="awards-section">${awardsHtml}</div>
  </div>

  <div class="section">
    <div class="section-title">Season-by-Season Record</div>
    <table class="stats-table">
      <thead><tr><th>Season</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Finish</th></tr></thead>
      <tbody>${seasonTableRows}\n${totalsRowHtml}</tbody>
    </table>
  </div>
</div>
</body>
</html>`

  const filename = 'coach_' + coach.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.html'
  const outPath = path.join(cardsDir, filename)
  fs.writeFileSync(outPath, html)
  return outPath
}

// ---------------------------------------------------------------------------
// Awards Page
// ---------------------------------------------------------------------------
function generateAwardsPage(seasonNum) {
  const history = loadHistory()
  const season = history.seasons.find(s => s.number === seasonNum)
  if (!season || !season.awards) { console.error(`No awards for season ${seasonNum}`); return null }

  const a = season.awards
  const league = loadLeague()

  function awardCard(title, recipient, subtitle, color, icon) {
    if (!recipient) return ''
    const team = league.teams.find(t => t.name === recipient.team)
    const colors = team ? team.colors || {} : {}
    return `
    <div class="award-card" style="border-left: 4px solid ${color};">
      <div class="award-icon" style="color:${color};">${icon}</div>
      <div class="award-info">
        <div class="award-title">${title}</div>
        <div class="award-recipient">${recipient.name}</div>
        <div class="award-detail">${subtitle}</div>
      </div>
    </div>`
  }

  const awardsHtml = [
    awardCard(CONFIG.awards.mvp, a.mvp, `${a.mvp ? a.mvp.team + ' \u2022 ' + a.mvp.position + ' \u2022 Grade: ' + a.mvp.grade : ''}`, '#8b5cf6', '\u{1F3C6}'),
    awardCard(CONFIG.awards.lfaPromise, a.lfaPromise, `${a.lfaPromise ? a.lfaPromise.team + ' \u2022 ' + a.lfaPromise.position + ' \u2022 Age ' + a.lfaPromise.age : ''}`, '#06b6d4', '\u2B50'),
    awardCard(CONFIG.awards.goalkeeperOfSeason, a.goalkeeperOfSeason, `${a.goalkeeperOfSeason ? a.goalkeeperOfSeason.team + ' \u2022 ' + a.goalkeeperOfSeason.saves + ' saves' : ''}`, '#f59e0b', '\u{1F9E4}'),
    a.fieldPlayerOfYear ? awardCard(CONFIG.awards.fieldPlayerOfYear, a.fieldPlayerOfYear, `${a.fieldPlayerOfYear.team} \u2022 ${a.fieldPlayerOfYear.position}`, '#10b981', '\u26BD') : '',
    awardCard(CONFIG.awards.coachOfYear, a.coachOfYear, `${a.coachOfYear ? a.coachOfYear.team + ' \u2022 ' + a.coachOfYear.style : ''}`, '#6366f1', '\u{1F4CB}'),
    awardCard(CONFIG.awards.fichichi, a.fichichi, `${a.fichichi ? a.fichichi.team + ' \u2022 ' + a.fichichi.goals + ' goals, ' + a.fichichi.assists + ' assists' : ''}`, '#ef4444', '\u{1F525}'),
    awardCard(CONFIG.awards.assistKing, a.assistKing, `${a.assistKing ? a.assistKing.team + ' \u2022 ' + a.assistKing.assists + ' assists (' + a.assistKing.perMatch + '/match)' : ''}`, '#3b82f6', '\u{1F91D}')
  ].filter(Boolean).join('\n')

  const champInfo = season.guyKilneTrophy
    ? `<div class="champion-banner">
        <div class="champion-trophy">\u{1F3C6}</div>
        <div class="champion-info">
          <div class="champion-title">Season ${season.number} Champion</div>
          <div class="champion-team">${season.champion}</div>
          <div class="champion-captain">${CONFIG.trophy.name}: ${season.guyKilneTrophy.captain}</div>
        </div>
      </div>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${CONFIG.league.shortName} Season ${season.number} Awards</title>
<style>
  ${baseCSS()}
  .awards-page { max-width: 700px; margin: 0 auto; }
  .page-title {
    font-size: 32px; font-weight: 800; color: #fff;
    text-align: center; margin-bottom: 8px;
  }
  .page-subtitle {
    font-size: 15px; color: #64748b;
    text-align: center; margin-bottom: 28px;
  }
  .champion-banner {
    display: flex; align-items: center; gap: 20px;
    padding: 24px; margin-bottom: 20px;
    background: linear-gradient(135deg, rgba(251,191,36,0.1), rgba(245,158,11,0.05));
    border: 1px solid rgba(251,191,36,0.2);
    border-radius: 16px;
  }
  .champion-trophy { font-size: 48px; }
  .champion-title { font-size: 13px; color: #fbbf24; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
  .champion-team { font-size: 24px; color: #fff; font-weight: 800; }
  .champion-captain { font-size: 14px; color: #94a3b8; margin-top: 4px; }
  .award-card {
    display: flex; align-items: center; gap: 16px;
    padding: 16px 20px; margin-bottom: 12px;
    background: rgba(255,255,255,0.03);
    border-radius: 12px;
  }
  .award-icon { font-size: 32px; }
  .award-title { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
  .award-recipient { font-size: 20px; color: #fff; font-weight: 700; }
  .award-detail { font-size: 13px; color: #94a3b8; }
</style>
</head>
<body>
<div class="awards-page">
  <div class="page-title">${CONFIG.league.shortName} Season ${season.number}</div>
  <div class="page-subtitle">Awards & Honors</div>
  ${champInfo}
  ${awardsHtml}
</div>
</body>
</html>`

  const filename = `awards_season_${seasonNum}.html`
  const outPath = path.join(cardsDir, filename)
  fs.writeFileSync(outPath, html)
  return outPath
}

// ---------------------------------------------------------------------------
// CLI Router
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const cmd = args[0]

if (!cmd) {
  console.log(`
  ${CONFIG.league.shortName} Card Generator

  Commands:
    player <name>       Generate player card
    coach <team#>       Generate coach card
    all                 Generate all player + coach cards
    awards [season#]    Generate awards page for a season
  `)
  process.exit(0)
}

switch (cmd) {
  case 'player': {
    const name = args.slice(1).join(' ')
    const p = generatePlayerCard(name)
    if (p) console.log(`  Player card: ${p}`)
    break
  }
  case 'coach': {
    const idx = parseInt(args[1], 10)
    const p = generateCoachCard(idx)
    if (p) console.log(`  Coach card: ${p}`)
    break
  }
  case 'all': {
    const league = loadLeague()
    let count = 0
    for (const team of league.teams) {
      for (const player of team.players) {
        const p = generatePlayerCard(player.name)
        if (p) count++
      }
      const idx = league.teams.indexOf(team)
      const c = generateCoachCard(idx)
      if (c) count++
    }
    // Awards pages for all seasons
    const history = loadHistory()
    for (const season of history.seasons) {
      if (season.awards) {
        generateAwardsPage(season.number)
        count++
      }
    }
    console.log(`  Generated ${count} cards in ${cardsDir}`)
    break
  }
  case 'awards': {
    const history = loadHistory()
    const sn = args[1] ? parseInt(args[1], 10) : history.currentSeason - 1
    const p = generateAwardsPage(sn)
    if (p) console.log(`  Awards page: ${p}`)
    break
  }
  default:
    console.error(`Unknown command: ${cmd}`)
}
