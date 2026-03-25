#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LFA Site Builder — generates a complete SPA from league + history data
// Run: node build-site.js
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')

const league = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'league.json'), 'utf8'))
const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'history.json'), 'utf8'))
const siteDir = path.join(__dirname, 'site')
if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true })

// Embed data as JS
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'))
const dataJS = `const LEAGUE=${JSON.stringify(league)};const HISTORY=${JSON.stringify(history)};const CONFIG=${JSON.stringify(config)};`

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${config.league.shortName} — ${config.league.name}</title>
<style>
${CSS()}
</style>
</head>
<body>
<div id="app">
  <nav id="nav"></nav>
  <main id="main"></main>
</div>
<script>
${dataJS}
${APP_JS()}
</script>
</body>
</html>`

fs.writeFileSync(path.join(siteDir, 'index.html'), html)
const sizeMB = (fs.statSync(path.join(siteDir, 'index.html')).size / (1024 * 1024)).toFixed(2)
console.log(`Built site/index.html (${sizeMB} MB)`)

// =========================================================================
function CSS() {
  return `
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0b1220;--card:#131d2e;--card2:#1a2738;--border:rgba(255,255,255,.07);--text:#c8d6e5;--text2:#7f8fa6;--white:#f5f6fa;--accent:#3b82f6;--gold:#fbbf24;--green:#10b981;--red:#ef4444;--purple:#8b5cf6;--cyan:#06b6d4;--orange:#f59e0b}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
#nav{background:#0d1829;border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;height:56px;position:sticky;top:0;z-index:100}
.nav-logo{font-size:20px;font-weight:800;color:var(--white);margin-right:32px;cursor:pointer;letter-spacing:-0.5px}
.nav-logo span{color:var(--gold)}
.nav-links{display:flex;gap:4px}
.nav-link{padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;color:var(--text2);cursor:pointer;transition:all .15s}
.nav-link:hover,.nav-link.active{background:rgba(255,255,255,.06);color:var(--white)}
.nav-link.active{background:var(--accent);color:#fff}
#main{max-width:1100px;margin:0 auto;padding:24px}
.page-title{font-size:28px;font-weight:800;color:var(--white);margin-bottom:6px}
.page-sub{font-size:14px;color:var(--text2);margin-bottom:24px}
.breadcrumb{font-size:13px;color:var(--text2);margin-bottom:20px}
.breadcrumb span{cursor:pointer;color:var(--accent)}
.breadcrumb span:hover{text-decoration:underline}

/* Grid */
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}

/* Cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s}
.card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.card-body{padding:18px}
.card-header-bar{padding:14px 18px;display:flex;align-items:center;gap:14px}
.mini-avatar{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;flex-shrink:0}
.card-name{font-size:16px;font-weight:700;color:var(--white)}
.card-detail{font-size:12px;color:var(--text2);margin-top:2px}
.card-stat-row{display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border);font-size:13px}
.card-stat-row .label{color:var(--text2)}.card-stat-row .value{color:var(--white);font-weight:600}

/* Player/Coach full card */
.profile{max-width:750px;margin:0 auto}
.profile-header{display:flex;align-items:center;gap:24px;padding:28px;background:var(--card);border-radius:16px;border:1px solid var(--border);margin-bottom:20px;position:relative;overflow:hidden}
.profile-avatar{width:130px;height:130px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:44px;color:#fff;flex-shrink:0;border:3px solid rgba(255,255,255,.15);box-shadow:0 4px 16px rgba(0,0,0,.3)}
.profile-info{flex:1;z-index:1}
.profile-name{font-size:28px;font-weight:800;color:var(--white);margin-bottom:2px}
.profile-team{font-size:15px;color:var(--text2);margin-bottom:8px}
.profile-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text2)}
.profile-meta b{color:var(--text);font-weight:600}
.rating-circle{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:#fff;flex-shrink:0;z-index:1}
.r-high{background:linear-gradient(135deg,#059669,#10b981)}.r-mid{background:linear-gradient(135deg,#d97706,#f59e0b)}.r-low{background:linear-gradient(135deg,#dc2626,#ef4444)}
.captain-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:var(--gold);background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.25);margin-left:8px;vertical-align:middle}
.section{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 24px;margin-bottom:16px}
.section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text2);margin-bottom:14px}
.skills-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.skill-item{text-align:center;padding:8px;background:rgba(255,255,255,.02);border-radius:8px}
.skill-val{font-size:20px;font-weight:700}.skill-lbl{font-size:10px;color:var(--text2);text-transform:uppercase;margin-top:2px}
.sk-h{color:var(--green)}.sk-m{color:var(--orange)}.sk-l{color:var(--red)}
.badge{display:inline-flex;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;color:#fff;margin:3px}
.champ-badge{display:inline-flex;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;color:var(--gold);background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.2);margin:3px}
table.stats{width:100%;border-collapse:collapse;font-size:13px}
table.stats th{text-align:center;padding:8px 6px;color:var(--text2);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
table.stats th:first-child{text-align:left}
table.stats td{text-align:center;padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.03)}
table.stats td:first-child{text-align:left;color:var(--text2);font-weight:600}
table.stats tr:hover td{background:rgba(255,255,255,.02)}
table.stats .totals td{font-weight:700;color:var(--white);border-top:2px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02)}

/* Team card */
.team-card{border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s;border:1px solid var(--border)}
.team-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.team-card-header{padding:20px;display:flex;align-items:center;gap:16px;position:relative}
.team-crest{width:56px;height:56px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;color:#fff;border:2px solid rgba(255,255,255,.2)}
.team-card-name{font-size:18px;font-weight:700;color:#fff}
.team-card-rating{font-size:13px;color:rgba(255,255,255,.7)}
.team-card-body{padding:0 20px 16px;display:flex;gap:20px;flex-wrap:wrap}
.team-mini-stat{text-align:center}.team-mini-stat .tv{font-size:18px;font-weight:700;color:#fff}.team-mini-stat .tl{font-size:10px;color:rgba(255,255,255,.5);text-transform:uppercase}

/* Season card */
.season-card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s}
.season-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.season-card-header{padding:20px;text-align:center;position:relative;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.season-num{font-size:32px;font-weight:900;color:#fff;position:relative;z-index:1}
.season-champ{font-size:13px;color:rgba(255,255,255,.8);z-index:1;margin-top:4px}
.season-decal{position:absolute;top:0;left:0;right:0;bottom:0;opacity:.12;display:flex;align-items:center;justify-content:center}
.season-card-body{padding:12px 20px 16px;font-size:12px;color:var(--text2)}

/* Results */
.match-row{display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);font-size:14px;transition:background .1s}
.match-row:hover{background:rgba(255,255,255,.03)}
.match-home{flex:1;text-align:right;font-weight:600;color:var(--text)}
.match-score{width:70px;text-align:center;font-weight:800;color:var(--white);font-size:15px}
.match-away{flex:1;text-align:left;font-weight:600;color:var(--text)}
.match-win{color:var(--white)}.match-loss{color:var(--text2)}
.match-draw{color:var(--orange)}

/* Awards */
.award-row{display:flex;align-items:center;gap:16px;padding:16px 20px;background:rgba(255,255,255,.02);border-radius:12px;margin-bottom:10px}
.award-icon{font-size:28px;flex-shrink:0}
.award-label{font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;font-weight:700}
.award-name{font-size:18px;font-weight:700;color:var(--white)}
.award-detail{font-size:13px;color:var(--text2)}
.champion-banner{display:flex;align-items:center;gap:20px;padding:24px;margin-bottom:20px;background:linear-gradient(135deg,rgba(251,191,36,.08),rgba(245,158,11,.04));border:1px solid rgba(251,191,36,.15);border-radius:16px}
.champion-trophy{font-size:44px}
.champion-title{font-size:12px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;font-weight:700}
.champion-team-name{font-size:24px;color:var(--white);font-weight:800}
.champion-captain{font-size:14px;color:var(--text2);margin-top:4px}

/* Coach record */
.record-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center}
.record-val{font-size:28px;font-weight:800;color:var(--white)}
.record-lbl{font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-top:4px}

/* Sub-navigation tabs */
.tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.tab{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;color:var(--text2);cursor:pointer;background:rgba(255,255,255,.04);border:1px solid var(--border);transition:all .15s}
.tab:hover{background:rgba(255,255,255,.08);color:var(--white)}
.tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}

/* Playoff bracket */
.bracket-round{margin-bottom:24px}
.bracket-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text2);margin-bottom:12px}
.bracket-series{background:rgba(255,255,255,.03);border-radius:10px;padding:14px 18px;margin-bottom:10px;border-left:3px solid var(--accent)}
.bracket-teams{font-size:15px;font-weight:700;color:var(--white);margin-bottom:6px}
.bracket-games{font-size:12px;color:var(--text2)}
.bracket-winner{color:var(--green);font-weight:600}

.empty-state{text-align:center;padding:60px 20px;color:var(--text2);font-size:15px}

/* Current Season */
.matchday-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
.md-btn{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--text2);transition:all .15s}
.md-btn:hover{background:rgba(255,255,255,.08);color:var(--white)}
.md-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.md-btn.completed{border-color:var(--green);color:var(--green)}
.md-btn.partial{border-color:var(--orange);color:var(--orange)}
.match-card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:14px}
.match-card.completed{border-color:rgba(16,185,129,.2)}
.mc-header{display:flex;align-items:center;padding:16px 20px;gap:12px}
.mc-team{flex:1;display:flex;align-items:center;gap:10px}
.mc-team.away{flex-direction:row-reverse;text-align:right}
.mc-team-name{font-size:15px;font-weight:700;color:var(--white)}
.mc-score{text-align:center;min-width:80px}
.mc-score-value{font-size:24px;font-weight:800;color:var(--white)}
.mc-score-label{font-size:11px;color:var(--text2);margin-top:2px}
.mc-pending{display:flex;gap:8px;justify-content:center}
.mc-btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s}
.mc-btn.simulate{background:var(--accent);color:#fff}
.mc-btn.simulate:hover{background:#2563eb}
.mc-btn.enter{background:rgba(255,255,255,.08);color:var(--text);border:1px solid var(--border)}
.mc-btn.enter:hover{background:rgba(255,255,255,.12)}
.mc-btn:disabled{opacity:.5;cursor:not-allowed}
.mc-goal-events{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border);padding:12px 20px}
.mc-goals-col{display:flex;flex-direction:column;gap:4px}
.mc-goals-col.away{text-align:right}
.mc-goal-ev{font-size:12px;color:var(--text);line-height:1.6}
.mc-goal-ev.missed{color:var(--red);opacity:.7;text-decoration:line-through;text-decoration-color:var(--red)}
.mc-assist{color:var(--text2);font-size:11px}
.mc-pen-label{font-size:10px;font-weight:700;color:var(--orange);letter-spacing:.5px}
.mc-details{border-top:1px solid var(--border);padding:16px 20px}
.mc-roster{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.mc-roster-team{font-size:12px}
.mc-roster-title{font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-size:11px}
.mc-player{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.mc-player-name{flex:1;font-size:13px;color:var(--text)}
.mc-player-stats{font-size:11px;color:var(--text2)}
.mc-player-grade{display:flex;gap:1px}
.star{color:var(--gold);font-size:11px}
.star.empty{color:#333}
.score-input{display:flex;align-items:center;gap:8px;justify-content:center;padding:12px}
.score-input input{width:50px;height:40px;text-align:center;font-size:20px;font-weight:700;background:var(--card2);border:1px solid var(--border);border-radius:8px;color:var(--white);outline:none}
.score-input input:focus{border-color:var(--accent)}
.score-input .vs{color:var(--text2);font-weight:700}
.score-submit{padding:8px 20px;border-radius:8px;background:var(--green);color:#fff;font-weight:600;border:none;cursor:pointer;font-size:13px}
.score-submit:hover{background:#059669}
.score-cancel{padding:8px 16px;border-radius:8px;background:rgba(255,255,255,.08);color:var(--text);border:1px solid var(--border);cursor:pointer;font-size:13px}
.loading{text-align:center;padding:20px;color:var(--text2);font-size:14px}
.leader-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;margin-top:20px}
.leader-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px}
.leader-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text2);margin-bottom:14px;display:flex;align-items:center;gap:8px}
.leader-title .icon{font-size:16px}
.leader-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.leader-rank{width:22px;text-align:center;font-weight:700;font-size:13px;color:var(--text2)}
.leader-rank.top{color:var(--gold)}
.leader-name{flex:1;font-size:13px;color:var(--white)}
.leader-team{font-size:11px;color:var(--text2)}
.leader-value{font-weight:700;font-size:15px;color:var(--white);min-width:45px;text-align:right}
.stats-btn{background:rgba(251,191,36,.1) !important;border-color:rgba(251,191,36,.3) !important;color:var(--gold) !important}
.stats-btn.active{background:var(--gold) !important;color:#000 !important;border-color:var(--gold) !important}
.coach-btn{background:rgba(99,102,241,.1) !important;border-color:rgba(99,102,241,.3) !important;color:var(--purple) !important}
.coach-btn.active{background:var(--purple) !important;color:#fff !important;border-color:var(--purple) !important}
.coach-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:14px}
.coach-card-header{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.coach-info{flex:1}
.style-picker{display:flex;gap:6px;flex-wrap:wrap}
.style-opt{padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid var(--border);background:var(--card2);color:var(--text2);transition:all .15s}
.style-opt:hover{border-color:rgba(255,255,255,.2);color:var(--white)}
.style-opt.active{border-color:var(--accent);background:rgba(59,130,246,.15);color:var(--accent)}
.style-desc{font-size:11px;color:var(--text2);margin-top:4px}
.style-boost{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin:2px}
.style-boost.pos{background:rgba(16,185,129,.12);color:var(--green)}
.style-boost.neg{background:rgba(239,68,68,.12);color:var(--red)}
.eos-btn{background:rgba(16,185,129,.1) !important;border-color:rgba(16,185,129,.3) !important;color:var(--green) !important}
.eos-btn.active{background:var(--green) !important;color:#fff !important;border-color:var(--green) !important}
.dev-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:14px}
.dev-delta{font-size:20px;font-weight:800;min-width:50px;text-align:center}
.dev-delta.up{color:var(--green)}.dev-delta.down{color:var(--red)}.dev-delta.same{color:var(--text2)}
.dev-name{font-size:15px;font-weight:700;color:var(--white)}
.dev-meta{font-size:12px;color:var(--text2)}
.dev-skills{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.dev-skill{font-size:11px;padding:2px 6px;border-radius:4px}
.dev-skill.up{background:rgba(16,185,129,.12);color:var(--green)}
.dev-skill.down{background:rgba(239,68,68,.12);color:var(--red)}
.pot-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.08);width:60px;display:inline-block;vertical-align:middle;margin-left:6px}
.pot-fill{height:100%;border-radius:2px}

/* Season Editor */
.se-container{max-width:900px;margin:0 auto}
.se-team-panel{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden}
.se-team-header{padding:14px 20px;display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none;transition:background .15s}
.se-team-header:hover{background:var(--card2)}
.se-team-header .se-arrow{color:var(--text2);font-size:12px;transition:transform .2s;margin-left:auto}
.se-team-header.open .se-arrow{transform:rotate(90deg)}
.se-team-name-h{font-size:16px;font-weight:700;color:var(--white)}
.se-team-rating{font-size:13px;color:var(--text2)}
.se-team-body{display:none;padding:0 20px 20px}
.se-team-body.open{display:block}
.se-section{margin-top:16px}
.se-section-title{font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.se-row{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.se-label{font-size:12px;color:var(--text2);min-width:70px}
.se-input{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--white);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.se-input:focus{border-color:var(--accent)}
.se-input.sm{width:70px}.se-input.md{width:140px}.se-input.lg{width:220px}
.se-color{width:36px;height:28px;border:1px solid var(--border);border-radius:6px;padding:1px;cursor:pointer;background:var(--bg)}
.se-player-row{display:grid;grid-template-columns:30px 1fr 60px 60px 60px 36px;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)}
.se-player-row:last-child{border-bottom:none}
.se-player-idx{font-size:11px;color:var(--text2);text-align:center}
.se-player-starter{font-size:10px;font-weight:700;color:var(--green)}
.se-btn{padding:6px 16px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:opacity .15s}
.se-btn:hover{opacity:.85}
.se-btn.primary{background:var(--accent);color:#fff}
.se-btn.success{background:var(--green);color:#fff}
.se-btn.danger{background:var(--red);color:#fff}
.se-btn.small{padding:4px 10px;font-size:11px}
.se-actions{display:flex;gap:10px;margin-top:20px;justify-content:flex-end}
.se-status{padding:8px 16px;border-radius:8px;font-size:13px;margin-top:12px;display:none}
.se-status.show{display:block}
.se-status.ok{background:rgba(16,185,129,.12);color:var(--green)}
.se-status.err{background:rgba(239,68,68,.12);color:var(--red)}
.se-transfer-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100}
.se-transfer-box{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;min-width:340px;max-width:460px}
.se-transfer-box h3{color:var(--white);margin-bottom:16px;font-size:16px}
.se-select{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--white);font-size:13px;font-family:inherit;width:100%}
.new-season-card{background:linear-gradient(135deg,var(--accent)15,var(--green)15);border:2px dashed var(--accent);border-radius:14px;padding:24px;text-align:center;cursor:pointer;transition:border-color .15s,transform .15s}
.new-season-card:hover{border-color:var(--green);transform:translateY(-2px)}

/* Responsive */
@media(max-width:600px){
  .profile-header{flex-direction:column;text-align:center}
  .profile-meta{justify-content:center}
  .skills-grid{grid-template-columns:repeat(3,1fr)}
  .nav-links{overflow-x:auto}
  .grid-2{grid-template-columns:1fr}
  .mc-roster{grid-template-columns:1fr}
}
`
}

// =========================================================================
function APP_JS() {
  return `
// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
const $ = s => document.querySelector(s)
const h = (tag, cls, html) => { const e = document.createElement(tag); if(cls) e.className = cls; if(html!==undefined) e.innerHTML = html; return e }
function rCls(r) { const n=parseInt(r,10); return n>=82?'r-high':n>=70?'r-mid':'r-low' }
function skCls(v) { const n=parseInt(v,10); return n>=75?'sk-h':n>=55?'sk-m':'sk-l' }
function pct(on,total) { return total>0?Math.round(on/total*100)+'%':'-' }
function teamByName(name) { return LEAGUE.teams.find(t=>t.name===name) }
function seasonByNum(n) { return HISTORY.seasons.find(s=>s.number===n) }
function teamColor(t) { return (t&&t.colors)?t.colors.primary:'#555' }
function teamColor2(t) { return (t&&t.colors)?t.colors.secondary:'#333' }

// Mini avatar with initials and team colors
function teamAbbrev(team) {
  if (typeof team === 'string') { const t = teamByName(team); return t && t.abbreviation ? t.abbreviation : team.split(' ').map(n=>n[0]).join('').slice(0,3).toUpperCase() }
  return team.abbreviation || team.name.split(' ').map(w=>w[0]).join('').slice(0,3)
}

function miniAv(name,color) {
  const tc = hexLum(color) > 180 ? '#222' : '#fff'
  return '<div class="mini-avatar" style="background:'+color+';color:'+tc+'">'+teamAbbrev(name)+'</div>'
}

// Team crest SVG
function hexLum(hex) {
  hex = hex.replace('#','')
  if (hex.length===3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]
  const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16)
  return (r*299+g*587+b*114)/1000
}
function teamCrest(team, size) {
  size = size || 56
  const c1 = teamColor(team), c2 = teamColor2(team)
  const init = teamAbbrev(team)
  const fs = init.length > 2 ? 14 : 18
  const textColor = (hexLum(c1) + hexLum(c2)) / 2 > 180 ? '#222' : '#fff'
  return '<svg viewBox="0 0 60 60" width="'+size+'" height="'+size+'"><defs><linearGradient id="tg_'+team.name.replace(/[^a-zA-Z0-9]/g,'')+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="'+c1+'"/><stop offset="100%" stop-color="'+c2+'"/></linearGradient></defs><rect x="2" y="2" width="56" height="56" rx="12" fill="url(#tg_'+team.name.replace(/[^a-zA-Z0-9]/g,'')+')" stroke="rgba(255,255,255,.2)" stroke-width="2"/><text x="30" y="36" text-anchor="middle" fill="'+textColor+'" font-size="'+fs+'" font-weight="900" font-family="Arial">'+init+'</text></svg>'
}

// Team jersey SVG — shirt shape with team colors
function teamJersey(team, size) {
  size = size || 64
  const c1 = teamColor(team), c2 = teamColor2(team)
  const id = 'jrs_'+team.name.replace(/[^a-zA-Z0-9]/g,'')
  // Shirt outline: body is primary, sleeves are secondary, collar and trim in secondary
  return '<svg viewBox="0 0 100 110" width="'+size+'" height="'+(size*1.1)+'">' +
    '<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+c1+'"/><stop offset="100%" stop-color="'+c1+'dd"/></linearGradient></defs>' +
    // Sleeves (secondary color)
    '<path d="M10,18 L0,40 L8,42 L18,25 Z" fill="'+c2+'" stroke="rgba(255,255,255,.15)" stroke-width="1"/>' +
    '<path d="M90,18 L100,40 L92,42 L82,25 Z" fill="'+c2+'" stroke="rgba(255,255,255,.15)" stroke-width="1"/>' +
    // Body (primary color)
    '<path d="M18,18 L18,100 Q18,108 26,108 L74,108 Q82,108 82,100 L82,18 Q65,10 50,10 Q35,10 18,18 Z" fill="url(#'+id+')" stroke="rgba(255,255,255,.2)" stroke-width="1.5"/>' +
    // Collar (secondary)
    '<path d="M35,12 Q42,8 50,7 Q58,8 65,12 L62,18 Q55,14 50,13 Q45,14 38,18 Z" fill="'+c2+'"/>' +
    // Trim stripe across chest (secondary, subtle)
    '<rect x="22" y="38" width="56" height="4" rx="2" fill="'+c2+'" opacity=".35"/>' +
    '</svg>'
}

// Season champion decal SVG (large team-colored emblem)
function championDecal(teamName) {
  const team = teamByName(teamName)
  if (!team) return ''
  const c1 = teamColor(team), c2 = teamColor2(team)
  const init = teamAbbrev(teamName)
  return '<svg viewBox="0 0 200 200" width="200" height="200"><defs><linearGradient id="decal" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="'+c1+'"/><stop offset="100%" stop-color="'+c2+'"/></linearGradient></defs>'+
    '<polygon points="100,10 130,40 170,45 140,75 148,115 100,95 52,115 60,75 30,45 70,40" fill="url(#decal)" opacity=".9"/>'+
    '<polygon points="100,25 120,45 150,48 130,70 135,100 100,85 65,100 70,70 50,48 80,45" fill="url(#decal)" opacity=".5"/>'+
    '<circle cx="100" cy="140" r="40" fill="url(#decal)" opacity=".6"/>'+
    '<text x="100" y="68" text-anchor="middle" fill="#fff" font-size="22" font-weight="900" font-family="Arial">'+init+'</text>'+
    '<text x="100" y="148" text-anchor="middle" fill="#fff" font-size="16" font-weight="700" font-family="Arial">CHAMPION</text>'+
    '</svg>'
}

// Award color map
const AWARD_COLORS = {mvp:'#8b5cf6',lfaPromise:'#06b6d4',goalkeeperOfSeason:'#f59e0b',fieldPlayerOfYear:'#10b981',coachOfYear:'#6366f1',fichichi:'#ef4444',assistKing:'#3b82f6'}
const AWARD_ICONS = {mvp:'\\u{1F3C6}',lfaPromise:'\\u2B50',goalkeeperOfSeason:'\\u{1F9E4}',fieldPlayerOfYear:'\\u26BD',coachOfYear:'\\u{1F4CB}',fichichi:'\\u{1F525}',assistKing:'\\u{1F91D}'}
const AWARD_NAMES = CONFIG.awards

// Collect player awards across seasons
function getPlayerAwards(name, team) {
  const awards = []
  for (const s of HISTORY.seasons) {
    if (!s.awards) continue
    const a = s.awards
    for (const [key, val] of Object.entries(a)) {
      if (val && val.name === name && val.team === team) awards.push({season:s.number, key, label:AWARD_NAMES[key], color:AWARD_COLORS[key]})
    }
  }
  return awards
}
function getPlayerChamps(name, team) {
  const champs = []
  for (const s of HISTORY.seasons) {
    if (s.guyKilneTrophy && s.guyKilneTrophy.team === team) {
      champs.push({season:s.number, lifted:s.guyKilneTrophy.captain===name})
    }
  }
  return champs
}
function getCoachAwards(team) {
  const awards = []
  for (const s of HISTORY.seasons) {
    if (s.awards && s.awards.coachOfYear && s.awards.coachOfYear.team === team) awards.push({season:s.number})
  }
  return awards
}

// -------------------------------------------------------------------------
// Navigation
// -------------------------------------------------------------------------
function renderNav(active) {
  const nav = $('#nav')
  nav.innerHTML = ''
  const logo = h('div','nav-logo','<span>'+CONFIG.league.shortName+'</span> '+CONFIG.league.name)
  logo.onclick = () => go('')
  nav.appendChild(logo)
  const links = h('div','nav-links')
  const items = [['','Home'],['season','Season '+HISTORY.currentSeason],['statistics','Statistics'],['results','Results']]
  for (const [route, label] of items) {
    const link = h('div','nav-link'+(active===route?' active':''),label)
    link.onclick = () => go(route)
    links.appendChild(link)
  }
  nav.appendChild(links)
}

// -------------------------------------------------------------------------
// Router
// -------------------------------------------------------------------------
function go(route) {
  if (window.location.hash === '#' + route || (route === '' && window.location.hash === '')) {
    render()
  } else {
    window.location.hash = route
  }
}
function getRoute() {
  return window.location.hash.replace('#','')
}
window.addEventListener('hashchange', render)

function render() {
  const route = getRoute()
  const parts = route.split('/')
  const main = $('#main')
  main.innerHTML = ''

  const base = parts[0] || ''

  if (base === '') { renderNav(''); renderHome(main) }
  else if (base === 'edit-season') { renderNav(''); renderSeasonEditor(main, parts[1]) }
  else if (base === 'season') { renderNav('season'); renderCurrentSeason(main, parts.slice(1)) }
  else if (base === 'statistics') { renderNav('statistics'); renderStatistics(main, parts.slice(1)) }
  else if (base === 'results') { renderNav('results'); renderResults(main, parts.slice(1)) }
  else { renderNav(''); main.innerHTML = '<div class="empty-state">Page not found</div>' }
}

// -------------------------------------------------------------------------
// HOME
// -------------------------------------------------------------------------
function renderHome(main) {
  main.innerHTML = '<div class="page-title">'+CONFIG.league.shortName+' \\u2014 '+CONFIG.league.name+'</div><div class="page-sub">'+CONFIG.league.format+' Football League Simulator \\u2022 '+CONFIG.league.teamCount+' Teams \\u2022 Season '+HISTORY.currentSeason+'</div>'

  const grid = h('div','grid grid-2')

  // Statistics card
  const statCard = h('div','card')
  statCard.innerHTML = '<div class="card-body" style="padding:24px"><div style="font-size:32px;margin-bottom:8px">\\u{1F4CA}</div><div class="card-name" style="font-size:20px">Statistics</div><div class="card-detail" style="margin-top:6px">Browse seasons, players, coaches, and team stats</div></div>'
  statCard.onclick = () => go('statistics')
  grid.appendChild(statCard)

  // Results card
  const resCard = h('div','card')
  resCard.innerHTML = '<div class="card-body" style="padding:24px"><div style="font-size:32px;margin-bottom:8px">\\u{1F4C5}</div><div class="card-name" style="font-size:20px">Results</div><div class="card-detail" style="margin-top:6px">Full match results, playoffs, and award winners by season</div></div>'
  resCard.onclick = () => go('results')
  grid.appendChild(resCard)

  // Edit current season card
  const editCard = h('div','card')
  editCard.innerHTML = '<div class="card-body" style="padding:24px"><div style="font-size:32px;margin-bottom:8px">\\u270F\\uFE0F</div><div class="card-name" style="font-size:20px">Edit Season '+HISTORY.currentSeason+'</div><div class="card-detail" style="margin-top:6px">Edit teams, players, coaches, colors, and abbreviations</div></div>'
  editCard.onclick = () => go('edit-season/'+HISTORY.currentSeason)
  grid.appendChild(editCard)

  // Start New Season card
  const newCard = h('div','card new-season-card')
  newCard.innerHTML = '<div style="font-size:32px;margin-bottom:8px">\\u{1F195}</div><div class="card-name" style="font-size:20px">Start Season '+(HISTORY.currentSeason+1)+'</div><div class="card-detail" style="margin-top:6px">Create a new season from current rosters</div>'
  newCard.onclick = async () => {
    if (!confirm('Start Season '+(HISTORY.currentSeason+1)+'? This will create a new schedule.')) return
    newCard.innerHTML = '<div class="loading">Creating season...</div>'
    try {
      const resp = await fetch('/api/start-new-season', { method: 'POST' })
      const data = await resp.json()
      if (data.success) { go('edit-season/'+data.season); setTimeout(() => window.location.reload(), 200) }
      else { alert('Error: '+(data.error||'Unknown')) }
    } catch(e) { alert('Error: '+e.message) }
  }
  grid.appendChild(newCard)

  main.appendChild(grid)

  // Quick stats
  const totalSeasons = HISTORY.seasons.filter(s=>s.champion).length
  const qs = h('div','section','<div class="section-title">Quick Stats</div><div style="display:flex;gap:32px;flex-wrap:wrap"><div><div style="font-size:24px;font-weight:800;color:var(--white)">'+LEAGUE.teams.length+'</div><div style="font-size:12px;color:var(--text2)">Teams</div></div><div><div style="font-size:24px;font-weight:800;color:var(--white)">'+(LEAGUE.teams.length*10)+'</div><div style="font-size:12px;color:var(--text2)">Players</div></div><div><div style="font-size:24px;font-weight:800;color:var(--white)">'+totalSeasons+'</div><div style="font-size:12px;color:var(--text2)">Completed Seasons</div></div></div>')
  qs.style.marginTop = '24px'
  main.appendChild(qs)
}

// -------------------------------------------------------------------------
// STATISTICS
// -------------------------------------------------------------------------
function renderStatistics(main, parts) {
  if (parts.length === 0 || parts[0] === '') return renderStatsMenu(main)
  if (parts[0] === 'seasons') {
    if (parts[1]) return renderSeasonCard(main, parseInt(parts[1],10))
    return renderSeasonsList(main)
  }
  if (parts[0] === 'players') {
    if (parts[1]) return renderPlayerCard(main, decodeURIComponent(parts[1]))
    return renderPlayersList(main)
  }
  if (parts[0] === 'coaches') {
    if (parts[1] !== undefined) return renderCoachCard(main, parseInt(parts[1],10))
    return renderCoachesList(main)
  }
  if (parts[0] === 'teams') {
    if (parts[1]) return renderTeamCard(main, decodeURIComponent(parts[1]))
    return renderTeamsList(main)
  }
}

function renderStatsMenu(main) {
  main.innerHTML = '<div class="page-title">Statistics</div><div class="page-sub">Browse league data</div>'
  const grid = h('div','grid grid-2')
  const items = [
    ['statistics/seasons','\\u{1F4C5}','Seasons','Season-by-season statistics and awards'],
    ['statistics/players','\\u26BD','Players','Player profiles, career stats, and awards'],
    ['statistics/coaches','\\u{1F4CB}','Coaches','Coach records and achievements'],
    ['statistics/teams','\\u{1F3DF}','Teams','Team rosters, colors, and performance']
  ]
  for (const [route,icon,title,desc] of items) {
    const card = h('div','card')
    card.innerHTML = '<div class="card-body" style="padding:24px"><div style="font-size:28px;margin-bottom:8px">'+icon+'</div><div class="card-name" style="font-size:18px">'+title+'</div><div class="card-detail" style="margin-top:4px">'+desc+'</div></div>'
    card.onclick = () => go(route)
    grid.appendChild(card)
  }
  main.appendChild(grid)
}

// -- Seasons list --
function renderSeasonsList(main) {
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / Seasons</div><div class="page-title">Seasons</div><div class="page-sub">All '+CONFIG.league.shortName+' seasons</div>'
  const grid = h('div','grid grid-3')
  for (const s of [...HISTORY.seasons].reverse()) {
    const card = h('div','season-card')
    const team = s.champion ? teamByName(s.champion) : null
    const c1 = team ? teamColor(team) : '#333'
    const c2 = team ? teamColor2(team) : '#555'
    card.innerHTML = '<div class="season-card-header" style="background:linear-gradient(135deg,'+c1+'20,'+c2+'20)">'+(s.champion?'<div class="season-decal">'+championDecal(s.champion)+'</div>':'')+'<div class="season-num">S'+s.number+'</div><div class="season-champ">'+(s.champion?'\\u{1F3C6} '+s.champion:'In Progress')+'</div></div><div class="season-card-body">'+(s.standings[0]?'1st: '+s.standings[0].team+' ('+s.standings[0].points+'pts)':'')+'</div>'
    card.onclick = () => go('statistics/seasons/'+s.number)
    grid.appendChild(card)
  }
  main.appendChild(grid)
}

// -- Season detail card --
function renderSeasonCard(main, num) {
  const s = seasonByNum(num)
  if (!s) { main.innerHTML = '<div class="empty-state">Season not found</div>'; return }
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / <span onclick="go(\\u0027statistics/seasons\\u0027)">Seasons</span> / S'+num+'</div>'

  const team = s.champion ? teamByName(s.champion) : null
  const c1 = team ? teamColor(team) : '#333'
  const c2 = team ? teamColor2(team) : '#555'

  // Champion banner
  if (s.champion) {
    const banner = h('div','champion-banner')
    banner.innerHTML = '<div class="champion-trophy">\\u{1F3C6}</div><div><div class="champion-title">Season '+num+' Champion</div><div class="champion-team-name">'+s.champion+'</div>'+(s.guyKilneTrophy?'<div class="champion-captain">'+CONFIG.trophy.name+': '+s.guyKilneTrophy.captain+'</div>':'')+'</div>'+(team?'<div style="margin-left:auto;opacity:.6">'+teamCrest(team,72)+'</div>':'')
    main.appendChild(banner)
  } else {
    main.appendChild(h('div','page-title','Season '+num+' (In Progress)'))
  }

  // Tabs
  const tabs = h('div','tabs')
  const tabData = [['standings','Standings'],['awards','Awards'],['players','Top Players']]
  let activeTab = 'standings'
  const content = h('div','')

  function renderTab(tab) {
    activeTab = tab
    content.innerHTML = ''
    tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab===tab))
    if (tab === 'standings') renderSeasonStandings(content, s)
    else if (tab === 'awards') renderSeasonAwards(content, s)
    else if (tab === 'players') renderSeasonPlayers(content, s)
  }

  for (const [key,label] of tabData) {
    const t = h('div','tab'+(key===activeTab?' active':''),label)
    t.dataset.tab = key
    t.onclick = () => renderTab(key)
    tabs.appendChild(t)
  }
  main.appendChild(tabs)
  main.appendChild(content)
  renderTab('standings')
}

function renderSeasonStandings(el, s) {
  let rows = ''
  s.standings.forEach((st,i) => {
    const gd = st.gf-st.ga
    const gdStr = gd>0?'+'+gd:gd
    const cls = i<8?'color:var(--white)':'color:var(--text2)'
    rows += '<tr style="'+cls+'"><td>'+(i+1)+'</td><td style="cursor:pointer;'+cls+'" onclick="go(\\u0027statistics/teams/'+encodeURIComponent(st.team)+'\\u0027)">'+st.team+'</td><td>'+st.played+'</td><td>'+st.won+'</td><td>'+st.drawn+'</td><td>'+st.lost+'</td><td>'+st.gf+'</td><td>'+st.ga+'</td><td>'+gdStr+'</td><td style="font-weight:700">'+st.points+'</td></tr>'
  })
  el.innerHTML = '<div class="section"><div class="section-title">League Table</div><table class="stats"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>'+rows+'</tbody></table><div style="margin-top:8px;font-size:11px;color:var(--text2)">Top 8 qualify for playoffs</div></div>'
}

function renderSeasonAwards(el, s) {
  if (!s.awards) { el.innerHTML = '<div class="empty-state">No awards data</div>'; return }
  const a = s.awards
  let html = ''
  for (const [key, val] of Object.entries(a)) {
    if (!val) continue
    let detail = val.team || ''
    if (val.position) detail += ' \\u2022 ' + val.position
    if (val.grade) detail += ' \\u2022 Grade: ' + val.grade
    if (val.age) detail += ' \\u2022 Age ' + val.age
    if (val.saves) detail += ' \\u2022 ' + val.saves + ' saves'
    if (val.goals) detail += ' \\u2022 ' + val.goals + ' goals'
    if (val.assists !== undefined && key !== 'fichichi') detail += ' \\u2022 ' + val.assists + ' assists'
    if (val.perMatch) detail += ' (' + val.perMatch + '/match)'
    if (val.style) detail += ' \\u2022 ' + val.style
    html += '<div class="award-row" style="border-left:3px solid '+(AWARD_COLORS[key]||'#555')+'"><div class="award-icon">'+(AWARD_ICONS[key]||'')+'</div><div><div class="award-label">'+(AWARD_NAMES[key]||key)+'</div><div class="award-name">'+(val.name||'')+'</div><div class="award-detail">'+detail+'</div></div></div>'
  }
  el.innerHTML = '<div class="section"><div class="section-title">Season Awards</div>'+html+'</div>'
}

function renderSeasonPlayers(el, s) {
  const stats = s.playerSeasonStats.filter(p=>p.appearances>0)
  const topGoals = [...stats].sort((a,b)=>b.goals-a.goals).slice(0,10)
  const topAssists = [...stats].sort((a,b)=>b.assists-a.assists).slice(0,10)
  let html = '<div class="section"><div class="section-title">Top Scorers</div><table class="stats"><thead><tr><th>#</th><th>Player</th><th>Team</th><th>Pos</th><th>App</th><th>Goals</th><th>Assists</th></tr></thead><tbody>'
  topGoals.forEach((p,i) => { html += '<tr><td>'+(i+1)+'</td><td style="cursor:pointer;color:var(--white)" onclick="go(\\u0027statistics/players/'+encodeURIComponent(p.name)+'\\u0027)">'+p.name+'</td><td>'+p.team+'</td><td>'+p.position+'</td><td>'+p.appearances+'</td><td style="font-weight:700;color:var(--white)">'+p.goals+'</td><td>'+p.assists+'</td></tr>' })
  html += '</tbody></table></div>'
  html += '<div class="section"><div class="section-title">Top Assists</div><table class="stats"><thead><tr><th>#</th><th>Player</th><th>Team</th><th>App</th><th>Assists</th></tr></thead><tbody>'
  topAssists.forEach((p,i) => { html += '<tr><td>'+(i+1)+'</td><td style="cursor:pointer;color:var(--white)" onclick="go(\\u0027statistics/players/'+encodeURIComponent(p.name)+'\\u0027)">'+p.name+'</td><td>'+p.team+'</td><td>'+p.appearances+'</td><td style="font-weight:700;color:var(--white)">'+p.assists+'</td></tr>' })
  html += '</tbody></table></div>'
  el.innerHTML = html
}

// -- Players list --
function renderPlayersList(main) {
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / Players</div><div class="page-title">Players</div><div class="page-sub">'+LEAGUE.teams.reduce((n,t)=>n+t.players.length,0)+' players across '+LEAGUE.teams.length+' teams</div>'

  // Team filter tabs
  const tabs = h('div','tabs')
  const allTab = h('div','tab active','All')
  allTab.onclick = () => filterPlayers('')
  tabs.appendChild(allTab)
  for (const t of LEAGUE.teams) {
    const tab = h('div','tab',t.name)
    tab.style.borderColor = teamColor(t)
    tab.onclick = () => filterPlayers(t.name)
    tabs.appendChild(tab)
  }
  main.appendChild(tabs)

  const grid = h('div','grid grid-3')
  grid.id = 'players-grid'
  main.appendChild(grid)

  window._filterPlayers = filterPlayers
  filterPlayers('')

  function filterPlayers(teamName) {
    tabs.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===0?!teamName:t.textContent===teamName))
    grid.innerHTML = ''
    for (const team of LEAGUE.teams) {
      if (teamName && team.name !== teamName) continue
      for (const p of team.players) {
        const c = teamColor(team)
        const card = h('div','card')
        card.innerHTML = '<div class="card-header-bar" style="border-bottom:2px solid '+c+'30">'+miniAv(p.name,c)+'<div><div class="card-name">'+p.name+'</div><div class="card-detail">'+p.position+' \\u2022 '+team.name+' \\u2022 Rtg '+p.rating+'</div></div></div>'
        card.onclick = () => go('statistics/players/'+encodeURIComponent(p.name))
        grid.appendChild(card)
      }
    }
  }
}

// -- Player full card --
function renderPlayerCard(main, name) {
  let team=null, player=null
  for (const t of LEAGUE.teams) {
    const p = t.players.find(p=>p.name===name)
    if (p) { team=t; player=p; break }
  }
  if (!player) { main.innerHTML='<div class="empty-state">Player not found: '+name+'</div>'; return }
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / <span onclick="go(\\u0027statistics/players\\u0027)">Players</span> / '+name+'</div>'

  const c1=teamColor(team),c2=teamColor2(team)
  const isCaptain = team.captain === player.name
  const isStarter = team.players.indexOf(player) < 6
  const awards = getPlayerAwards(name, team.name)
  const champs = getPlayerChamps(name, team.name)

  // Profile header
  const header = h('div','profile-header')
  header.style.background = 'linear-gradient(135deg,'+c1+'15,'+c2+'15)'
  header.innerHTML = '<div class="profile-avatar" style="background:linear-gradient(135deg,'+c1+','+c2+')">'+player.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()+'</div><div class="profile-info"><div class="profile-name">'+player.name+(isCaptain?'<span class="captain-badge">C</span>':'')+'</div><div class="profile-team">'+team.name+' \\u2014 '+player.position+(isStarter?'':' (Sub)')+'</div><div class="profile-meta"><div>Age: <b>'+(player.age||'-')+'</b></div><div>Height: <b>'+player.height+'cm</b></div></div></div><div class="rating-circle '+rCls(player.rating)+'">'+player.rating+'</div>'
  main.appendChild(header)

  // Skills
  const sk = player.skill
  const skillItems = [{l:'SPD',v:sk.speed},{l:'PAS',v:sk.passing},{l:'SHO',v:sk.shooting},{l:'TCK',v:sk.tackling},{l:'SAV',v:sk.saving},{l:'AGI',v:sk.agility},{l:'STR',v:sk.strength},{l:'JMP',v:sk.jumping},{l:'MRK',v:sk.marking},{l:'HDG',v:sk.head_game},{l:'SET',v:sk.set_piece_taking},{l:'PEN',v:sk.penalty_taking}]
  const skillsHtml = skillItems.map(s=>'<div class="skill-item"><div class="skill-val '+skCls(s.v)+'">'+s.v+'</div><div class="skill-lbl">'+s.l+'</div></div>').join('')
  main.appendChild(h('div','section','<div class="section-title">Skills</div><div class="skills-grid">'+skillsHtml+'</div>'))

  // Championships
  const champsHtml = champs.length>0 ? champs.map(c=>'<span class="champ-badge">'+(c.lifted?'\\u{1F3C6}':'\\u{1F3C5}')+' S'+c.season+(c.lifted?' (Captain)':'')+'</span>').join('') : '<span style="color:var(--text2);font-size:13px">No championships yet</span>'
  main.appendChild(h('div','section','<div class="section-title">Championships</div>'+champsHtml))

  // Awards
  const awardsHtml = awards.length>0 ? awards.map(a=>'<span class="badge" style="background:'+a.color+'">S'+a.season+' '+a.label+'</span>').join('') : '<span style="color:var(--text2);font-size:13px">No individual awards yet</span>'
  main.appendChild(h('div','section','<div class="section-title">Awards</div>'+awardsHtml))

  // Career stats
  const isGK = player.position==='GK'
  let rows='', tot={app:0,gls:0,ast:0,sht:0,shtOn:0,pas:0,pasOn:0,tck:0,tckOn:0,fls:0,sav:0}
  for (const s of HISTORY.seasons) {
    const ps = s.playerSeasonStats.find(p=>p.name===name&&p.team===team.name)
    if (!ps||ps.appearances===0) continue
    tot.app+=ps.appearances;tot.gls+=ps.goals;tot.ast+=ps.assists;tot.sht+=ps.shots.total;tot.shtOn+=ps.shots.on;tot.pas+=ps.passes.total;tot.pasOn+=ps.passes.on;tot.tck+=ps.tackles.total;tot.tckOn+=ps.tackles.on;tot.fls+=ps.tackles.fouls;if(ps.saves!==undefined)tot.sav+=ps.saves
    if (isGK) rows+='<tr><td>S'+s.number+'</td><td>'+ps.appearances+'</td><td>'+ps.goals+'</td><td>'+ps.assists+'</td><td>'+(ps.saves||0)+'</td><td>'+ps.passes.total+'</td><td>'+pct(ps.passes.on,ps.passes.total)+'</td><td>'+ps.tackles.total+'</td><td>'+ps.tackles.fouls+'</td></tr>'
    else rows+='<tr><td>S'+s.number+'</td><td>'+ps.appearances+'</td><td>'+ps.goals+'</td><td>'+ps.assists+'</td><td>'+ps.shots.total+'</td><td>'+pct(ps.shots.on,ps.shots.total)+'</td><td>'+ps.passes.total+'</td><td>'+pct(ps.passes.on,ps.passes.total)+'</td><td>'+ps.tackles.total+'</td><td>'+ps.tackles.fouls+'</td></tr>'
  }
  const hdr = isGK?'<th>Season</th><th>App</th><th>Gls</th><th>Ast</th><th>Saves</th><th>Pass</th><th>Pas%</th><th>Tck</th><th>Fouls</th>':'<th>Season</th><th>App</th><th>Gls</th><th>Ast</th><th>Shots</th><th>Sht%</th><th>Pass</th><th>Pas%</th><th>Tck</th><th>Fouls</th>'
  const totRow = isGK?'<tr class="totals"><td>TOTAL</td><td>'+tot.app+'</td><td>'+tot.gls+'</td><td>'+tot.ast+'</td><td>'+tot.sav+'</td><td>'+tot.pas+'</td><td>'+pct(tot.pasOn,tot.pas)+'</td><td>'+tot.tck+'</td><td>'+tot.fls+'</td></tr>':'<tr class="totals"><td>TOTAL</td><td>'+tot.app+'</td><td>'+tot.gls+'</td><td>'+tot.ast+'</td><td>'+tot.sht+'</td><td>'+pct(tot.shtOn,tot.sht)+'</td><td>'+tot.pas+'</td><td>'+pct(tot.pasOn,tot.pas)+'</td><td>'+tot.tck+'</td><td>'+tot.fls+'</td></tr>'
  main.appendChild(h('div','section','<div class="section-title">Career Statistics</div><table class="stats"><thead><tr>'+hdr+'</tr></thead><tbody>'+rows+totRow+'</tbody></table>'))
}

// -- Coaches list --
function renderCoachesList(main) {
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / Coaches</div><div class="page-title">Coaches</div><div class="page-sub">'+LEAGUE.teams.length+' head coaches</div>'
  const grid = h('div','grid grid-3')
  LEAGUE.teams.forEach((t,i) => {
    if (!t.coach) return
    const c = teamColor(t)
    const card = h('div','card')
    card.innerHTML = '<div class="card-header-bar" style="border-bottom:2px solid '+c+'30">'+miniAv(t.coach.name,c)+'<div><div class="card-name">'+t.coach.name+'</div><div class="card-detail">'+t.name+' \\u2022 '+t.coach.style+' \\u2022 Rtg '+t.coach.rating+'</div></div></div>'
    card.onclick = () => go('statistics/coaches/'+i)
    grid.appendChild(card)
  })
  main.appendChild(grid)
}

// -- Coach full card --
function renderCoachCard(main, idx) {
  const team = LEAGUE.teams[idx]
  if (!team||!team.coach) { main.innerHTML='<div class="empty-state">Coach not found</div>'; return }
  const coach = team.coach
  const c1=teamColor(team),c2=teamColor2(team)
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / <span onclick="go(\\u0027statistics/coaches\\u0027)">Coaches</span> / '+coach.name+'</div>'

  const header = h('div','profile-header')
  header.style.background = 'linear-gradient(135deg,'+c1+'15,'+c2+'15)'
  header.innerHTML = '<div class="profile-avatar" style="background:linear-gradient(135deg,#2d2d2d,#444)">'+coach.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()+'</div><div class="profile-info"><div class="profile-name">'+coach.name+'</div><div class="profile-team">'+team.name+' \\u2014 Head Coach</div><div class="profile-meta"><div>Age: <b>'+(coach.age||'-')+'</b></div><div>Style: <b>'+coach.style+'</b></div></div></div><div class="rating-circle '+rCls(coach.rating)+'">'+coach.rating+'</div>'
  main.appendChild(header)

  // Career record
  let totalW=0,totalD=0,totalL=0,totalP=0,titles=0
  let rows = ''
  for (const s of HISTORY.seasons) {
    const cs = s.coachSeasonStats.find(c=>c.team===team.name)
    if (!cs||cs.played===0) continue
    totalW+=cs.won;totalD+=cs.drawn;totalL+=cs.lost;totalP+=cs.played
    const rank = s.standings.findIndex(st=>st.team===team.name)+1
    const isChamp = s.champion===team.name
    if (isChamp) titles++
    rows += '<tr><td>S'+s.number+'</td><td>'+cs.played+'</td><td>'+cs.won+'</td><td>'+cs.drawn+'</td><td>'+cs.lost+'</td><td>'+cs.points+'</td><td>#'+rank+(isChamp?' \\u{1F3C6}':'')+'</td></tr>'
  }
  const totRow = '<tr class="totals"><td>TOTAL</td><td>'+totalP+'</td><td>'+totalW+'</td><td>'+totalD+'</td><td>'+totalL+'</td><td>'+(totalW*3+totalD)+'</td><td>'+titles+' titles</td></tr>'

  main.appendChild(h('div','section','<div class="section-title">Career Record</div><div class="record-grid"><div><div class="record-val">'+totalW+'</div><div class="record-lbl">Wins</div></div><div><div class="record-val">'+totalD+'</div><div class="record-lbl">Draws</div></div><div><div class="record-val">'+totalL+'</div><div class="record-lbl">Losses</div></div><div><div class="record-val">'+titles+'</div><div class="record-lbl">Titles</div></div></div>'))

  // Championships
  const champSeasons = HISTORY.seasons.filter(s=>s.champion===team.name)
  const champsHtml = champSeasons.length>0?champSeasons.map(s=>'<span class="champ-badge">\\u{1F3C6} S'+s.number+'</span>').join(''):'<span style="color:var(--text2);font-size:13px">No championships</span>'
  main.appendChild(h('div','section','<div class="section-title">Championships</div>'+champsHtml))

  // Awards
  const coachAwards = getCoachAwards(team.name)
  const awardsHtml = coachAwards.length>0?coachAwards.map(a=>'<span class="badge" style="background:var(--purple)">S'+a.season+' '+CONFIG.awards.coachOfYear+'</span>').join(''):'<span style="color:var(--text2);font-size:13px">No awards</span>'
  main.appendChild(h('div','section','<div class="section-title">Awards</div>'+awardsHtml))

  // Season table
  main.appendChild(h('div','section','<div class="section-title">Season-by-Season Record</div><table class="stats"><thead><tr><th>Season</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Finish</th></tr></thead><tbody>'+rows+totRow+'</tbody></table>'))
}

// -- Teams list --
function renderTeamsList(main) {
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / Teams</div><div class="page-title">Teams</div><div class="page-sub">'+CONFIG.league.teamCount+' '+CONFIG.league.shortName+' teams</div>'
  const grid = h('div','grid grid-3')
  for (const t of LEAGUE.teams) {
    const c1=teamColor(t),c2=teamColor2(t)
    const card = h('div','team-card')
    // Count titles
    const titles = HISTORY.seasons.filter(s=>s.champion===t.name).length
    card.innerHTML = '<div class="team-card-header" style="background:linear-gradient(135deg,'+c1+'cc,'+c2+'cc)">'+teamCrest(t,56)+'<div><div class="team-card-name">'+t.name+'</div><div class="team-card-rating">Rating: '+t.rating+(titles?' \\u2022 '+titles+' title'+(titles>1?'s':''):'')+'</div></div></div><div class="team-card-body" style="background:linear-gradient(135deg,'+c1+'15,'+c2+'10)"><div class="team-mini-stat"><div class="tv">'+t.players.length+'</div><div class="tl">Players</div></div><div class="team-mini-stat"><div class="tv">'+(t.coach?t.coach.name:'-')+'</div><div class="tl">Coach</div></div></div>'
    card.onclick = () => go('statistics/teams/'+encodeURIComponent(t.name))
    grid.appendChild(card)
  }
  main.appendChild(grid)
}

// -- Team full card --
function renderTeamCard(main, name) {
  const team = teamByName(name)
  if (!team) { main.innerHTML='<div class="empty-state">Team not found</div>'; return }
  const c1=teamColor(team),c2=teamColor2(team)
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027statistics\\u0027)">Statistics</span> / <span onclick="go(\\u0027statistics/teams\\u0027)">Teams</span> / '+name+'</div>'

  // Team header
  const header = h('div','profile-header')
  header.style.background = 'linear-gradient(135deg,'+c1+'25,'+c2+'20)'
  const titles = HISTORY.seasons.filter(s=>s.champion===name).length
  header.innerHTML = '<div style="flex-shrink:0;display:flex;gap:12px;align-items:center">'+teamCrest(team,72)+teamJersey(team,64)+'</div><div class="profile-info"><div class="profile-name" style="color:#fff">'+name+'</div><div class="profile-team">'+(team.coach?'Coach: '+team.coach.name+' ('+team.coach.style+')':'No coach')+'</div><div class="profile-meta"><div>Rating: <b>'+team.rating+'</b></div><div>Titles: <b>'+titles+'</b></div><div>Captain: <b>'+(team.captain||'-')+'</b></div></div></div><div class="rating-circle '+rCls(team.rating)+'">'+team.rating+'</div>'
  main.appendChild(header)

  // Roster
  let rosterRows = ''
  team.players.forEach((p,i) => {
    const starter = i<6?'':'<span style="color:var(--text2);font-size:11px"> (sub)</span>'
    rosterRows += '<tr><td style="cursor:pointer;color:var(--white)" onclick="go(\\u0027statistics/players/'+encodeURIComponent(p.name)+'\\u0027)">'+p.name+starter+'</td><td>'+p.position+'</td><td>'+p.rating+'</td><td>'+(p.age||'-')+'</td><td>'+p.height+'cm</td></tr>'
  })
  main.appendChild(h('div','section','<div class="section-title">Roster</div><table class="stats"><thead><tr><th>Name</th><th>Pos</th><th>Rtg</th><th>Age</th><th>Height</th></tr></thead><tbody>'+rosterRows+'</tbody></table>'))

  // Season history
  let histRows = ''
  for (const s of HISTORY.seasons) {
    const st = s.standings.find(x=>x.team===name)
    if (!st || st.played===0) continue
    const rank = s.standings.indexOf(st)+1
    const isChamp = s.champion===name
    histRows += '<tr><td>S'+s.number+'</td><td>'+st.played+'</td><td>'+st.won+'</td><td>'+st.drawn+'</td><td>'+st.lost+'</td><td>'+st.gf+'</td><td>'+st.ga+'</td><td style="font-weight:700">'+st.points+'</td><td>#'+rank+(isChamp?' \\u{1F3C6}':'')+'</td></tr>'
  }
  main.appendChild(h('div','section','<div class="section-title">Season History</div><table class="stats"><thead><tr><th>Season</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th><th>Finish</th></tr></thead><tbody>'+histRows+'</tbody></table>'))
}

// -------------------------------------------------------------------------
// RESULTS
// -------------------------------------------------------------------------
function renderResults(main, parts) {
  if (parts.length===0 || parts[0]==='') return renderResultsMenu(main)
  return renderSeasonResults(main, parseInt(parts[0],10))
}

function renderResultsMenu(main) {
  main.innerHTML = '<div class="page-title">Results</div><div class="page-sub">Full match results by season</div>'
  const grid = h('div','grid grid-4')
  for (const s of [...HISTORY.seasons].reverse()) {
    const team = s.champion ? teamByName(s.champion) : null
    const c1 = team ? teamColor(team) : '#444'
    const card = h('div','season-card')
    card.innerHTML = '<div class="season-card-header" style="background:linear-gradient(135deg,'+c1+'20,#0b122020);min-height:80px">'+(s.champion?'<div class="season-decal" style="opacity:.08">'+championDecal(s.champion)+'</div>':'')+'<div class="season-num" style="font-size:24px">S'+s.number+'</div><div class="season-champ" style="font-size:12px">'+(s.champion?'\\u{1F3C6} '+s.champion:'In Progress')+'</div></div>'
    card.onclick = () => go('results/'+s.number)
    grid.appendChild(card)
  }
  main.appendChild(grid)
}

function renderSeasonResults(main, num) {
  const s = seasonByNum(num)
  if (!s) { main.innerHTML='<div class="empty-state">Season not found</div>'; return }
  main.innerHTML = '<div class="breadcrumb"><span onclick="go(\\u0027results\\u0027)">Results</span> / Season '+num+'</div>'

  if (s.champion) {
    const team = teamByName(s.champion)
    const c1 = team?teamColor(team):'#333'
    const banner = h('div','champion-banner')
    banner.innerHTML = '<div class="champion-trophy">\\u{1F3C6}</div><div><div class="champion-title">Season '+num+' Champion</div><div class="champion-team-name">'+s.champion+'</div>'+(s.guyKilneTrophy?'<div class="champion-captain">'+CONFIG.trophy.name+': '+s.guyKilneTrophy.captain+'</div>':'')+'</div>'
    main.appendChild(banner)
  }

  // Tabs
  const tabs = h('div','tabs')
  const content = h('div','')
  const tabData = [['regular','Regular Season'],['playoffs','Playoffs'],['awards','Awards']]
  let activeTab = 'regular'

  function renderTab(tab) {
    activeTab = tab
    content.innerHTML = ''
    tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab===tab))
    if (tab==='regular') renderRegularResults(content, s)
    else if (tab==='playoffs') renderPlayoffResults(content, s)
    else if (tab==='awards') renderSeasonAwards(content, s)
  }

  for (const [key,label] of tabData) {
    const t = h('div','tab'+(key===activeTab?' active':''),label)
    t.dataset.tab = key
    t.onclick = () => renderTab(key)
    tabs.appendChild(t)
  }
  main.appendChild(tabs)
  main.appendChild(content)
  renderTab('regular')
}

function renderRegularResults(el, s) {
  if (!s.matchResults || s.matchResults.length===0) { el.innerHTML='<div class="empty-state">No match data</div>'; return }
  let html = '<div class="section"><div class="section-title">Regular Season Matches ('+s.matchResults.length+' matches)</div>'
  for (const m of s.matchResults) {
    const homeWin = m.score[0]>m.score[1], awayWin = m.score[1]>m.score[0], draw = m.score[0]===m.score[1]
    const hCls = homeWin?'match-win':draw?'match-draw':'match-loss'
    const aCls = awayWin?'match-win':draw?'match-draw':'match-loss'
    html += '<div class="match-row"><div class="match-home '+hCls+'">'+m.home+'</div><div class="match-score">'+m.score[0]+' - '+m.score[1]+'</div><div class="match-away '+aCls+'">'+m.away+'</div></div>'
  }
  html += '</div>'
  el.innerHTML = html
}

function renderPlayoffResults(el, s) {
  if (!s.playoffs) { el.innerHTML='<div class="empty-state">No playoff data</div>'; return }
  const po = s.playoffs
  let html = ''

  // QF
  html += '<div class="section"><div class="section-title">Quarterfinals (Best of 3)</div>'
  for (const qf of po.quarterFinals) {
    html += '<div class="bracket-series"><div class="bracket-teams">#'+qf.seedNums[0]+' '+qf.higherSeed+' vs #'+qf.seedNums[1]+' '+qf.lowerSeed+' \\u2014 <span class="bracket-winner">'+qf.winner+' wins '+qf.seriesScore+'</span></div><div class="bracket-games">'
    qf.games.forEach((g,i) => { html += 'G'+(i+1)+': '+g.home+' '+g.score[0]+'-'+g.score[1]+' '+g.away+'&nbsp;&nbsp;' })
    html += '</div></div>'
  }
  html += '</div>'

  // SF
  html += '<div class="section"><div class="section-title">Semifinals (Neutral Site)</div>'
  for (const sf of po.semiFinals) {
    html += '<div class="bracket-series" style="border-left-color:var(--orange)"><div class="bracket-teams">'+sf.team1+' vs '+sf.team2+' \\u2014 <span class="bracket-winner">'+sf.winner+' wins</span></div><div class="bracket-games">'+sf.team1+' '+sf.score[0]+'-'+sf.score[1]+' '+sf.team2+'</div></div>'
  }
  html += '</div>'

  // Final
  const f = po.final
  html += '<div class="section"><div class="section-title">Final (Neutral Site)</div><div class="bracket-series" style="border-left-color:var(--gold);border-left-width:4px"><div class="bracket-teams" style="font-size:18px">'+f.team1+' vs '+f.team2+'</div><div style="font-size:24px;font-weight:800;color:var(--white);margin:8px 0">'+f.score[0]+' - '+f.score[1]+'</div><div class="bracket-winner" style="font-size:16px">\\u{1F3C6} '+f.winner+'</div>'+(f.captain?'<div style="font-size:13px;color:var(--text2);margin-top:4px">Captain '+f.captain+' lifts the '+CONFIG.trophy.name+'</div>':'')+'</div></div>'

  el.innerHTML = html
}

// -------------------------------------------------------------------------
// CURRENT SEASON
// -------------------------------------------------------------------------
let scheduleCache = null

async function fetchSchedule(force) {
  if (scheduleCache && !force) return scheduleCache
  const res = await fetch('/api/schedule')
  scheduleCache = await res.json()
  return scheduleCache
}

function starsHTML(grade) {
  let s = ''
  for (let i = 1; i <= 5; i++) {
    if (grade >= i) s += '<span class="star">\\u2605</span>'
    else if (grade >= i - 0.5) s += '<span class="star">\\u00BD</span>'
    else s += '<span class="star empty">\\u2605</span>'
  }
  return s
}

async function renderCurrentSeason(main, parts) {
  main.innerHTML = '<div class="loading">Loading schedule...</div>'
  const schedule = await fetchSchedule()
  if (!schedule || !schedule.matchdays) { main.innerHTML = '<div class="empty-state">No schedule found. Run node schedule.js first.</div>'; return }

  const part0 = parts.length > 0 ? parts[0] : ''
  const isStats = part0 === 'stats'
  const isEndOfSeason = part0 === 'endofseason'
  const isCoaches = part0 === 'coaches'
  const mdNum = (isStats || isEndOfSeason || isCoaches) ? 0 : (part0 !== '' ? parseInt(part0, 10) : 0)

  main.innerHTML = ''
  main.appendChild(h('div','page-title','Season ' + schedule.season + ' \\u2014 Current Season'))

  // Matchday nav buttons
  const nav = h('div','matchday-nav')
  for (const md of schedule.matchdays) {
    const completed = md.matches.every(m => m.status === 'completed')
    const partial = !completed && md.matches.some(m => m.status === 'completed')
    const cls = 'md-btn' + (md.number === mdNum && !isStats ? ' active' : '') + (completed ? ' completed' : '') + (partial ? ' partial' : '')
    const btn = h('div', cls, '' + md.number)
    btn.title = 'Matchday ' + md.number + (completed ? ' (completed)' : partial ? ' (in progress)' : '')
    btn.onclick = () => go('season/' + md.number)
    nav.appendChild(btn)
  }
  // Stats button
  const statsBtn = h('div', 'md-btn stats-btn' + (isStats ? ' active' : ''), '\\u{1F4CA}')
  statsBtn.title = 'Season Statistics'
  statsBtn.style.width = 'auto'
  statsBtn.style.padding = '0 12px'
  statsBtn.style.fontSize = '16px'
  statsBtn.onclick = () => go('season/stats')
  nav.appendChild(statsBtn)

  // Coaches button
  const coachBtn = h('div', 'md-btn coach-btn' + (isCoaches ? ' active' : ''), '\\u{1F4CB}')
  coachBtn.title = 'Coach Management'
  coachBtn.style.width = 'auto'
  coachBtn.style.padding = '0 12px'
  coachBtn.style.fontSize = '16px'
  coachBtn.onclick = () => go('season/coaches')
  nav.appendChild(coachBtn)

  // End of Season button (only show if all regular season matches are played)
  const allPlayed = schedule.matchdays.every(md => md.matches.every(m => m.status === 'completed'))
  if (allPlayed) {
    const eosBtn = h('div', 'md-btn eos-btn' + (isEndOfSeason ? ' active' : ''), '\\u{1F3C6}')
    eosBtn.title = 'End of Season'
    eosBtn.style.width = 'auto'
    eosBtn.style.padding = '0 12px'
    eosBtn.style.fontSize = '16px'
    eosBtn.onclick = () => go('season/endofseason')
    nav.appendChild(eosBtn)
  }
  main.appendChild(nav)

  if (isEndOfSeason) {
    renderEndOfSeason(main, schedule)
    return
  }

  if (isCoaches) {
    renderCoachManagement(main)
    return
  }

  if (isStats) {
    renderSeasonStats(main, schedule)
    return
  }

  if (mdNum === 0) {
    // Overview: show standings summary
    renderSeasonOverview(main, schedule)
    return
  }

  const md = schedule.matchdays.find(m => m.number === mdNum)
  if (!md) { main.innerHTML += '<div class="empty-state">Matchday not found</div>'; return }

  const sub = h('div','page-sub')
  const done = md.matches.filter(m => m.status === 'completed').length
  sub.textContent = 'Matchday ' + mdNum + ' \\u2014 ' + done + '/' + md.matches.length + ' matches played'
  main.appendChild(sub)

  // Simulate All button
  if (done < md.matches.length) {
    const simAll = h('button','mc-btn simulate','Simulate All Remaining')
    simAll.style.marginBottom = '16px'
    simAll.onclick = async () => {
      simAll.disabled = true
      simAll.textContent = 'Simulating...'
      for (let i = 0; i < md.matches.length; i++) {
        if (md.matches[i].status !== 'completed') {
          await fetch('/api/simulate/' + mdNum + '/' + i, { method: 'POST' })
        }
      }
      scheduleCache = null
      go('season/' + mdNum)
    }
    main.appendChild(simAll)
  }

  // Match cards
  for (let i = 0; i < md.matches.length; i++) {
    const match = md.matches[i]
    main.appendChild(buildMatchCard(match, mdNum, i))
  }
}

function renderSeasonOverview(main, schedule) {
  const sub = h('div','page-sub')
  const totalMatches = schedule.matchdays.reduce((s, md) => s + md.matches.length, 0)
  const played = schedule.matchdays.reduce((s, md) => s + md.matches.filter(m => m.status === 'completed').length, 0)
  sub.textContent = played + '/' + totalMatches + ' matches played \\u2022 Click a matchday to view'
  main.appendChild(sub)

  // Build quick standings from completed matches
  const table = {}
  for (const t of LEAGUE.teams) {
    table[t.name] = { team: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
  }
  for (const md of schedule.matchdays) {
    for (const m of md.matches) {
      if (m.status !== 'completed') continue
      const h = table[m.home], a = table[m.away]
      if (!h || !a) continue
      h.p++; a.p++
      h.gf += m.score[0]; h.ga += m.score[1]
      a.gf += m.score[1]; a.ga += m.score[0]
      if (m.score[0] > m.score[1]) { h.w++; h.pts += 3; a.l++ }
      else if (m.score[1] > m.score[0]) { a.w++; a.pts += 3; h.l++ }
      else { h.d++; a.d++; h.pts++; a.pts++ }
    }
  }
  const rows = Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)

  let html = '<div class="section"><div class="section-title">Standings</div><table class="stats"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>'
  rows.forEach((r, i) => {
    const team = teamByName(r.team)
    const c = teamColor(team)
    html += '<tr><td>' + (i + 1) + '</td><td style="cursor:pointer;color:var(--white)" onclick="go(\\u0027statistics/teams/' + encodeURIComponent(r.team) + '\\u0027)"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c + ';margin-right:8px"></span>' + r.team + '</td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td>' + r.gf + '</td><td>' + r.ga + '</td><td>' + (r.gf - r.ga) + '</td><td style="font-weight:700">' + r.pts + '</td></tr>'
  })
  html += '</tbody></table></div>'
  main.appendChild(h('div', '', html))
}

function aggregatePlayerStats(schedule) {
  const players = {}
  for (const md of schedule.matchdays) {
    for (const m of md.matches) {
      if (m.status !== 'completed' || !m.playerStats) continue
      const sides = [
        { stats: m.playerStats.home, team: m.home },
        { stats: m.playerStats.away, team: m.away }
      ]
      for (const side of sides) {
        for (const p of side.stats) {
          const key = p.name + ':' + side.team
          if (!players[key]) {
            players[key] = { name: p.name, team: side.team, position: p.position, matches: 0, goals: 0, assists: 0, saves: 0, passOn: 0, passTotal: 0, tackleOn: 0, tackleTotal: 0, gradeSum: 0 }
          }
          const r = players[key]
          r.matches++
          r.goals += p.goals || 0
          r.assists += p.assists || 0
          if (p.saves !== undefined) r.saves += p.saves
          if (p.passes) { r.passOn += p.passes.on; r.passTotal += p.passes.total }
          if (p.tackles) { r.tackleOn += p.tackles.on; r.tackleTotal += p.tackles.total }
          r.gradeSum += p.grade || 0
        }
      }
    }
  }
  return Object.values(players)
}

function renderSeasonStats(main, schedule) {
  const played = schedule.matchdays.reduce((s, md) => s + md.matches.filter(m => m.status === 'completed').length, 0)
  const sub = h('div','page-sub','Season statistics from ' + played + ' completed matches (simulated only)')
  main.appendChild(sub)

  const all = aggregatePlayerStats(schedule)
  if (all.length === 0) {
    main.appendChild(h('div','empty-state','No simulated matches yet. Simulate some matches to see statistics.'))
    return
  }

  // League table
  const table = {}
  for (const t of LEAGUE.teams) {
    table[t.name] = { team: t.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
  }
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
  const rows = Object.values(table).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)

  let thtml = '<div class="section"><div class="section-title">League Table</div><table class="stats"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>'
  rows.forEach((r, i) => {
    const team = teamByName(r.team)
    const c = teamColor(team)
    thtml += '<tr><td>' + (i + 1) + '</td><td style="cursor:pointer;color:var(--white)" onclick="go(\\u0027statistics/teams/' + encodeURIComponent(r.team) + '\\u0027)"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c + ';margin-right:8px"></span>' + r.team + '</td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td>' + r.gf + '</td><td>' + r.ga + '</td><td>' + (r.gf - r.ga) + '</td><td style="font-weight:700">' + r.pts + '</td></tr>'
  })
  thtml += '</tbody></table></div>'
  main.appendChild(h('div', '', thtml))

  // Leader boards
  const grid = h('div','leader-grid')

  function leaderBoard(title, icon, list, valueFn, formatFn, limit) {
    limit = limit || 10
    const sorted = list.filter(p => p.matches > 0).sort((a, b) => valueFn(b) - valueFn(a)).slice(0, limit)
    const card = h('div','leader-card')
    let html = '<div class="leader-title"><span class="icon">' + icon + '</span>' + title + '</div>'
    sorted.forEach((p, i) => {
      const team = teamByName(p.team)
      const c = teamColor(team)
      const val = formatFn ? formatFn(p) : valueFn(p)
      html += '<div class="leader-row"><div class="leader-rank' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c + '"></span><div class="leader-name">' + p.name + ' <span class="leader-team">' + p.position + ' \\u2022 ' + p.team + '</span></div><div class="leader-value">' + val + '</div></div>'
    })
    card.innerHTML = html
    return card
  }

  // Goals
  grid.appendChild(leaderBoard('Top Scorers', '\\u26BD', all, p => p.goals, p => p.goals + (p.matches > 0 ? ' <span style="font-size:11px;color:var(--text2);font-weight:400">(' + p.matches + ' mp)</span>' : '')))

  // Assists
  grid.appendChild(leaderBoard('Assist Leaders', '\\u{1F91D}', all, p => p.assists, p => p.assists + (p.matches > 0 ? ' <span style="font-size:11px;color:var(--text2);font-weight:400">(' + p.matches + ' mp)</span>' : '')))

  // Saves (GKs)
  const gks = all.filter(p => p.position === 'GK')
  grid.appendChild(leaderBoard('Save Leaders', '\\u{1F9E4}', gks, p => p.saves, p => p.saves + (p.matches > 0 ? ' <span style="font-size:11px;color:var(--text2);font-weight:400">(' + p.matches + ' mp)</span>' : ''), 10))

  // Pass accuracy (min 1 match)
  grid.appendChild(leaderBoard('Pass Accuracy', '\\u{1F3AF}', all.filter(p => p.passTotal >= 15), p => p.passTotal > 0 ? p.passOn / p.passTotal : 0, p => {
    const pct = p.passTotal > 0 ? Math.round(p.passOn / p.passTotal * 100) : 0
    return pct + '% <span style="font-size:11px;color:var(--text2);font-weight:400">(' + p.passOn + '/' + p.passTotal + ')</span>'
  }))

  // Tackle accuracy (min 1 match, non-GK)
  grid.appendChild(leaderBoard('Tackle Accuracy', '\\u{1F6E1}', all.filter(p => p.tackleTotal >= 5 && p.position !== 'GK'), p => p.tackleTotal > 0 ? p.tackleOn / p.tackleTotal : 0, p => {
    const pct = p.tackleTotal > 0 ? Math.round(p.tackleOn / p.tackleTotal * 100) : 0
    return pct + '% <span style="font-size:11px;color:var(--text2);font-weight:400">(' + p.tackleOn + '/' + p.tackleTotal + ')</span>'
  }))

  // Star rating (avg)
  grid.appendChild(leaderBoard('Star Rating', '\\u2B50', all.filter(p => p.matches > 0), p => p.gradeSum / p.matches, p => {
    const avg = (p.gradeSum / p.matches)
    return starsHTML(Math.round(avg * 2) / 2) + ' <span style="font-size:11px;color:var(--text2);font-weight:400">' + avg.toFixed(2) + '</span>'
  }))

  main.appendChild(grid)
}

// -------------------------------------------------------------------------
// COACH MANAGEMENT
// -------------------------------------------------------------------------
const STYLES = {
  'attacking':      { label: 'Attacking', icon: '\\u2694', desc: 'All-out offense. Boosts striker output, slight defensive vulnerability.', boosts: ['Offense +', 'Defense -'] },
  'defensive':      { label: 'Defensive', icon: '\\u{1F6E1}', desc: 'Solid backline. Reduces goals conceded, limits attacking output.', boosts: ['Defense +', 'Offense -'] },
  'balanced':       { label: 'Balanced', icon: '\\u2696', desc: 'Steady approach. Small improvements across the board.', boosts: ['Offense +', 'Defense +'] },
  'possession':     { label: 'Possession', icon: '\\u{1F504}', desc: 'Control the ball. Good offensive and defensive stability through possession.', boosts: ['Offense +', 'Defense +'] },
  'counter-attack': { label: 'Counter-Attack', icon: '\\u26A1', desc: 'Fast transitions. Strong offensive punch with modest defensive cover.', boosts: ['Offense ++', 'Defense +'] }
}

async function renderCoachManagement(main) {
  main.appendChild(h('div','page-sub','Set each coach\\u0027s tactical philosophy. Style affects match simulation based on the coach\\u0027s skill level.'))

  // Fetch fresh league data
  const res = await fetch('/api/league')
  const league = await res.json()

  for (const team of league.teams) {
    const coach = team.coach
    const tc = teamColor(team)
    const card = h('div','coach-card')

    const header = h('div','coach-card-header')
    header.innerHTML = miniAv(coach.name, tc) +
      '<div class="coach-info"><div style="font-size:16px;font-weight:700;color:var(--white)">' + coach.name + '</div>' +
      '<div style="font-size:13px;color:var(--text2)">' + team.name + ' \\u2022 Rating: <span style="color:var(--white);font-weight:600">' + coach.rating + '</span></div></div>'
    card.appendChild(header)

    const picker = h('div','style-picker')
    for (const [key, info] of Object.entries(STYLES)) {
      const opt = h('div','style-opt' + (coach.style === key ? ' active' : ''))
      opt.innerHTML = '<div>' + info.icon + ' ' + info.label + '</div><div class="style-desc">' + info.desc + '</div><div style="margin-top:4px">' +
        info.boosts.map(b => {
          const isNeg = b.includes('-')
          return '<span class="style-boost ' + (isNeg ? 'neg' : 'pos') + '">' + b + '</span>'
        }).join('') + '</div>'

      opt.onclick = async () => {
        if (coach.style === key) return
        opt.style.opacity = '0.5'
        try {
          await fetch('/api/coach-style/' + encodeURIComponent(team.name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ style: key })
          })
          coach.style = key
          picker.querySelectorAll('.style-opt').forEach(o => o.classList.remove('active'))
          opt.classList.add('active')
        } catch (e) {
          alert('Error: ' + e.message)
        }
        opt.style.opacity = '1'
      }
      picker.appendChild(opt)
    }
    card.appendChild(picker)
    main.appendChild(card)
  }
}

let developmentResults = null

async function renderEndOfSeason(main, schedule) {
  const allPlayed = schedule.matchdays.every(md => md.matches.every(m => m.status === 'completed'))
  if (!allPlayed) {
    main.appendChild(h('div','empty-state','Complete all regular season matches first.'))
    return
  }

  main.appendChild(h('div','page-sub','End of season player development \\u2014 skills evolve based on age and potential'))

  // Check if development has already been applied this session
  if (developmentResults) {
    renderDevelopmentResults(main, developmentResults)
    return
  }

  const panel = h('div','section')
  panel.style.textAlign = 'center'
  panel.innerHTML = '<div class="section-title">Player Development</div><p style="color:var(--text);margin-bottom:16px">Apply end-of-season skill development. Each player\\u0027s skills will evolve based on their age curve and potential. Young players grow, veterans may decline.</p><p style="color:var(--text2);font-size:13px;margin-bottom:20px">This will update league.json permanently. All players will age +1 year.</p>'

  const btn = h('button','mc-btn simulate','Apply Development')
  btn.style.fontSize = '16px'
  btn.style.padding = '12px 32px'
  btn.onclick = async () => {
    btn.disabled = true
    btn.textContent = 'Processing...'
    try {
      const res = await fetch('/api/develop-season', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        developmentResults = data
        go('season/endofseason')
      } else {
        panel.innerHTML += '<div style="color:var(--red);margin-top:12px">Error: ' + (data.error || 'Unknown error') + '</div>'
      }
    } catch (e) {
      panel.innerHTML += '<div style="color:var(--red);margin-top:12px">Error: ' + e.message + '</div>'
    }
  }
  panel.appendChild(btn)
  main.appendChild(panel)

  // Start New Season button
  const newSeasonPanel = h('div','section')
  newSeasonPanel.style.textAlign = 'center'
  newSeasonPanel.style.marginTop = '24px'
  newSeasonPanel.innerHTML = '<div class="section-title">Start Next Season</div><p style="color:var(--text);margin-bottom:16px">Create Season ' + (HISTORY.currentSeason + 1) + ' using the current rosters. You can edit teams, players, and coaches before generating the schedule.</p>'
  const newBtn = h('button','se-btn success','Start Season ' + (HISTORY.currentSeason + 1))
  newBtn.style.fontSize = '16px'
  newBtn.style.padding = '12px 32px'
  newBtn.onclick = async () => {
    if (!confirm('Start Season ' + (HISTORY.currentSeason + 1) + '? This will create a new schedule from current rosters.')) return
    newBtn.disabled = true
    newBtn.textContent = 'Creating season...'
    try {
      const resp = await fetch('/api/start-new-season', { method: 'POST' })
      const data = await resp.json()
      if (data.success) {
        go('edit-season/' + data.season)
        setTimeout(() => window.location.reload(), 200)
      } else {
        alert('Error: ' + (data.error || 'Unknown'))
        newBtn.disabled = false
        newBtn.textContent = 'Start Season ' + (HISTORY.currentSeason + 1)
      }
    } catch(e) {
      alert('Error: ' + e.message)
      newBtn.disabled = false
      newBtn.textContent = 'Start Season ' + (HISTORY.currentSeason + 1)
    }
  }
  newSeasonPanel.appendChild(newBtn)
  main.appendChild(newSeasonPanel)
}

function renderDevelopmentResults(main, data) {
  // Summary stats
  const totalPlayers = data.results.length
  const improved = data.results.filter(r => r.ratingDelta > 0).length
  const declined = data.results.filter(r => r.ratingDelta < 0).length
  const unchanged = data.results.filter(r => r.ratingDelta === 0).length

  const summary = h('div','section')
  summary.innerHTML = '<div class="section-title">Development Summary</div>' +
    '<div style="display:flex;gap:32px;flex-wrap:wrap;margin-bottom:8px">' +
    '<div><div style="font-size:24px;font-weight:800;color:var(--green)">' + improved + '</div><div style="font-size:12px;color:var(--text2)">Improved</div></div>' +
    '<div><div style="font-size:24px;font-weight:800;color:var(--text2)">' + unchanged + '</div><div style="font-size:12px;color:var(--text2)">Unchanged</div></div>' +
    '<div><div style="font-size:24px;font-weight:800;color:var(--red)">' + declined + '</div><div style="font-size:12px;color:var(--text2)">Declined</div></div>' +
    '<div><div style="font-size:24px;font-weight:800;color:var(--white)">' + totalPlayers + '</div><div style="font-size:12px;color:var(--text2)">Total Players</div></div>' +
    '</div>'
  main.appendChild(summary)

  // Top improvers
  main.appendChild(h('div','section-title','\\u{1F4C8} Biggest Improvers'))
  const impGrid = h('div','grid grid-2')
  impGrid.style.marginBottom = '24px'
  for (const r of data.improvers.filter(x => x.ratingDelta > 0)) {
    impGrid.appendChild(devCard(r))
  }
  main.appendChild(impGrid)

  // Top decliners
  main.appendChild(h('div','section-title','\\u{1F4C9} Biggest Decliners'))
  const decGrid = h('div','grid grid-2')
  decGrid.style.marginBottom = '24px'
  for (const r of data.decliners.filter(x => x.ratingDelta < 0)) {
    decGrid.appendChild(devCard(r))
  }
  main.appendChild(decGrid)

  // Full team-by-team breakdown
  main.appendChild(h('div','section-title','\\u{1F4CB} All Players'))
  const teams = {}
  for (const r of data.results) {
    if (!teams[r.team]) teams[r.team] = []
    teams[r.team].push(r)
  }

  for (const [teamName, players] of Object.entries(teams)) {
    const team = teamByName(teamName)
    const c = teamColor(team)
    const sec = h('div','section')
    let html = '<div class="section-title"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c + ';margin-right:8px"></span>' + teamName + '</div>'
    html += '<table class="stats"><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Pot</th><th>Old</th><th>New</th><th>+/-</th></tr></thead><tbody>'
    for (const r of players) {
      const cls = r.ratingDelta > 0 ? 'color:var(--green)' : r.ratingDelta < 0 ? 'color:var(--red)' : 'color:var(--text2)'
      const potPct = Math.round((r.potential - 0.6) / 0.8 * 100)
      const potColor = r.potential >= 1.1 ? 'var(--green)' : r.potential >= 0.9 ? 'var(--gold)' : 'var(--red)'
      html += '<tr><td style="color:var(--white)">' + r.name + '</td><td>' + r.position + '</td><td>' + r.age + '\\u2192' + (r.age + 1) + '</td><td><div class="pot-bar"><div class="pot-fill" style="width:' + potPct + '%;background:' + potColor + '"></div></div></td><td>' + r.oldRating + '</td><td style="font-weight:700">' + r.newRating + '</td><td style="' + cls + ';font-weight:700">' + (r.ratingDelta >= 0 ? '+' : '') + r.ratingDelta + '</td></tr>'
    }
    html += '</tbody></table>'
    sec.innerHTML = html
    main.appendChild(sec)
  }
}

function devCard(r) {
  const card = h('div','dev-card')
  const team = teamByName(r.team)
  const c = teamColor(team)
  const cls = r.ratingDelta > 0 ? 'up' : r.ratingDelta < 0 ? 'down' : 'same'
  const sign = r.ratingDelta > 0 ? '+' : ''

  let skillsHTML = ''
  for (const [skill, change] of Object.entries(r.changes)) {
    if (Math.abs(change.delta) >= 2) {
      const sCls = change.delta > 0 ? 'up' : 'down'
      const sSign = change.delta > 0 ? '+' : ''
      skillsHTML += '<span class="dev-skill ' + sCls + '">' + skill.replace(/_/g, ' ') + ' ' + sSign + change.delta + '</span>'
    }
  }

  card.innerHTML = '<div class="dev-delta ' + cls + '">' + sign + r.ratingDelta + '</div>' +
    miniAv(r.name, c) +
    '<div style="flex:1"><div class="dev-name">' + r.name + '</div><div class="dev-meta">' + r.position + ' \\u2022 ' + r.team + ' \\u2022 Age ' + r.age + '\\u2192' + (r.age + 1) + '</div>' +
    (skillsHTML ? '<div class="dev-skills">' + skillsHTML + '</div>' : '') +
    '</div>'
  return card
}

function buildMatchCard(match, mdNum, idx) {
  const card = h('div', 'match-card' + (match.status === 'completed' ? ' completed' : ''))
  const homeTeam = teamByName(match.home)
  const awayTeam = teamByName(match.away)
  const hc = teamColor(homeTeam), ac = teamColor(awayTeam)

  let headerHTML = '<div class="mc-team">' + miniAv(match.home, hc) + '<div class="mc-team-name">' + match.home + '</div></div>'

  if (match.status === 'completed') {
    const hWin = match.score[0] > match.score[1], aWin = match.score[1] > match.score[0]
    headerHTML += '<div class="mc-score"><div class="mc-score-value">' + match.score[0] + ' - ' + match.score[1] + '</div><div class="mc-score-label">' + (match.method === 'simulated' ? 'Simulated' : 'Manual') + '</div></div>'
    headerHTML += '<div class="mc-team away"><div class="mc-team-name">' + match.away + '</div>' + miniAv(match.away, ac) + '</div>'
  } else {
    headerHTML += '<div class="mc-score"><div class="mc-pending" id="pending-' + mdNum + '-' + idx + '">'
    headerHTML += '<button class="mc-btn simulate" onclick="simulateMatch(' + mdNum + ',' + idx + ')">Simulate</button>'
    headerHTML += '<button class="mc-btn enter" onclick="showScoreInput(' + mdNum + ',' + idx + ')">Enter Score</button>'
    headerHTML += '</div></div>'
    headerHTML += '<div class="mc-team away"><div class="mc-team-name">' + match.away + '</div>' + miniAv(match.away, ac) + '</div>'
  }

  const header = h('div', 'mc-header')
  header.innerHTML = headerHTML
  card.appendChild(header)

  // Goal events for completed matches
  if (match.status === 'completed' && match.goalEvents) {
    const ge = match.goalEvents
    const eventsEl = h('div', 'mc-goal-events')
    let evHTML = '<div class="mc-goals-col">'
    if (ge.home && ge.home.length > 0) {
      for (const ev of ge.home) {
        if (ev.missed) { evHTML += '<div class="mc-goal-ev missed">\\u274C <span class="mc-pen-label">PEN</span> ' + ev.scorer + '</div>'; continue }
        evHTML += '<div class="mc-goal-ev">' + (ev.penalty ? '<span class="mc-pen-label">PEN</span> ' : '\\u26BD ') + ev.scorer + (ev.assister ? ' <span class="mc-assist">(' + ev.assister + ')</span>' : '') + '</div>'
      }
    }
    evHTML += '</div><div class="mc-goals-col away">'
    if (ge.away && ge.away.length > 0) {
      for (const ev of ge.away) {
        if (ev.missed) { evHTML += '<div class="mc-goal-ev missed">' + ev.scorer + ' <span class="mc-pen-label">PEN</span> \\u274C</div>'; continue }
        evHTML += '<div class="mc-goal-ev">' + (ev.assister ? '<span class="mc-assist">(' + ev.assister + ')</span> ' : '') + ev.scorer + (ev.penalty ? ' <span class="mc-pen-label">PEN</span>' : ' \\u26BD') + '</div>'
      }
    }
    evHTML += '</div>'
    eventsEl.innerHTML = evHTML
    card.appendChild(eventsEl)
  }

  // Player stats details for completed matches
  if (match.status === 'completed' && match.playerStats) {
    const details = h('div', 'mc-details')
    let detailsHTML = '<div class="mc-roster">'

    // Home roster
    detailsHTML += '<div class="mc-roster-team"><div class="mc-roster-title">' + match.home + '</div>'
    for (const p of match.playerStats.home) {
      detailsHTML += playerStatRow(p)
    }
    detailsHTML += '</div>'

    // Away roster
    detailsHTML += '<div class="mc-roster-team"><div class="mc-roster-title">' + match.away + '</div>'
    for (const p of match.playerStats.away) {
      detailsHTML += playerStatRow(p)
    }
    detailsHTML += '</div></div>'

    details.innerHTML = detailsHTML
    card.appendChild(details)
  }

  return card
}

function playerStatRow(p) {
  const statsText = []
  if (p.goals > 0) statsText.push(p.goals + 'G')
  if (p.assists > 0) statsText.push(p.assists + 'A')
  if (p.saves !== undefined) statsText.push(p.saves + 'S')
  const statStr = statsText.length > 0 ? statsText.join(' ') : '-'
  return '<div class="mc-player"><span class="mc-player-name">' + p.name + ' <span style="color:var(--text2);font-size:11px">' + p.position + '</span></span><span class="mc-player-stats">' + statStr + '</span><span class="mc-player-grade">' + starsHTML(p.grade) + '</span></div>'
}

async function simulateMatch(mdNum, idx) {
  const pending = document.getElementById('pending-' + mdNum + '-' + idx)
  if (pending) pending.innerHTML = '<div class="loading">Simulating...</div>'
  try {
    await fetch('/api/simulate/' + mdNum + '/' + idx, { method: 'POST' })
    scheduleCache = null
    go('season/' + mdNum)
  } catch (e) {
    if (pending) pending.innerHTML = '<div style="color:var(--red)">Error: ' + e.message + '</div>'
  }
}

function showScoreInput(mdNum, idx) {
  const pending = document.getElementById('pending-' + mdNum + '-' + idx)
  if (!pending) return
  pending.innerHTML = '<div class="score-input"><input type="number" id="sh-' + mdNum + '-' + idx + '" min="0" max="10" value="0"><span class="vs">-</span><input type="number" id="sa-' + mdNum + '-' + idx + '" min="0" max="10" value="0"></div><div style="display:flex;gap:8px;justify-content:center;margin-top:4px"><button class="score-submit" onclick="submitScore(' + mdNum + ',' + idx + ')">Save</button><button class="score-cancel" onclick="go(\\u0027season/' + mdNum + '\\u0027)">Cancel</button></div>'
}

async function submitScore(mdNum, idx) {
  const hVal = parseInt(document.getElementById('sh-' + mdNum + '-' + idx).value, 10) || 0
  const aVal = parseInt(document.getElementById('sa-' + mdNum + '-' + idx).value, 10) || 0
  try {
    await fetch('/api/enter-score/' + mdNum + '/' + idx, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: [hVal, aVal] })
    })
    scheduleCache = null
    go('season/' + mdNum)
  } catch (e) {
    alert('Error: ' + e.message)
  }
}

// -------------------------------------------------------------------------
// Season Editor
// -------------------------------------------------------------------------
async function renderSeasonEditor(main, seasonNum) {
  seasonNum = parseInt(seasonNum, 10) || HISTORY.currentSeason
  main.innerHTML = '<div class="loading">Loading season data...</div>'

  let teams
  try {
    const resp = await fetch('/api/season-editor/' + seasonNum)
    const data = await resp.json()
    if (data.error) { main.innerHTML = '<div class="empty-state">' + data.error + '</div>'; return }
    teams = data.teams
  } catch(e) { main.innerHTML = '<div class="empty-state">Failed to load: ' + e.message + '</div>'; return }

  main.innerHTML = ''
  main.appendChild(h('div','breadcrumb','<span onclick="go(\\'\\')">Home</span> / Edit Season ' + seasonNum))
  main.appendChild(h('div','page-title','Edit Season ' + seasonNum))
  main.appendChild(h('div','page-sub','Edit teams, players, coaches, colors, and abbreviations. Changes are saved to the league data.'))

  const container = h('div','se-container')
  const statusEl = h('div','se-status')
  const editorState = { teams: JSON.parse(JSON.stringify(teams)) }

  for (let ti = 0; ti < editorState.teams.length; ti++) {
    const team = editorState.teams[ti]
    team._originalName = team.name
    const panel = h('div','se-team-panel')
    panel.id = 'se-panel-' + ti

    // Header
    const header = h('div','se-team-header')
    header.innerHTML = '<div class="mini-avatar" style="background:' + team.colors.primary + ';width:28px;height:28px;font-size:11px;color:' + (hexLum(team.colors.primary) > 180 ? '#222' : '#fff') + '">' + (team.abbreviation || team.name.split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase()) + '</div>' +
      '<span class="se-team-name-h">' + team.name + '</span>' +
      '<span class="se-team-rating">OVR ' + team.rating + '</span>' +
      '<span class="se-arrow">\\u25B6</span>'
    header.onclick = function() {
      this.classList.toggle('open')
      this.nextElementSibling.classList.toggle('open')
    }
    panel.appendChild(header)

    // Body
    const body = h('div','se-team-body')

    // Team info section
    body.innerHTML = '<div class="se-section"><div class="se-section-title">Team Info</div>' +
      '<div class="se-row"><span class="se-label">Name</span><input class="se-input lg" value="' + escAttr(team.name) + '" data-ti="' + ti + '" data-field="name" onchange="seUpdate(this)"></div>' +
      '<div class="se-row"><span class="se-label">Abbrev</span><input class="se-input sm" value="' + escAttr(team.abbreviation || '') + '" data-ti="' + ti + '" data-field="abbreviation" onchange="seUpdate(this)" maxlength="4" placeholder="Auto"></div>' +
      '<div class="se-row"><span class="se-label">Primary</span><input type="color" class="se-color" value="' + team.colors.primary + '" data-ti="' + ti + '" data-field="colorPrimary" onchange="seUpdate(this)"><span class="se-label">Secondary</span><input type="color" class="se-color" value="' + team.colors.secondary + '" data-ti="' + ti + '" data-field="colorSecondary" onchange="seUpdate(this)"></div>' +
      '</div>'

    // Coach section
    const coach = team.coach || { name: '', rating: '60', style: 'balanced' }
    body.innerHTML += '<div class="se-section"><div class="se-section-title">Coach</div>' +
      '<div class="se-row"><span class="se-label">Name</span><input class="se-input lg" value="' + escAttr(coach.name) + '" data-ti="' + ti + '" data-field="coachName" onchange="seUpdate(this)"></div>' +
      '<div class="se-row"><span class="se-label">Rating</span><input class="se-input sm" type="number" min="40" max="99" value="' + coach.rating + '" data-ti="' + ti + '" data-field="coachRating" onchange="seUpdate(this)">' +
      '<span class="se-label">Style</span><select class="se-select" style="width:160px" data-ti="' + ti + '" data-field="coachStyle" onchange="seUpdate(this)">' +
      ['attacking','defensive','balanced','possession','counter-attack'].map(s => '<option value="' + s + '"' + (coach.style === s ? ' selected' : '') + '>' + s + '</option>').join('') +
      '</select></div></div>'

    // Players section
    let playersHTML = '<div class="se-section"><div class="se-section-title">Players (' + team.players.length + ')</div>'
    playersHTML += '<div class="se-player-row" style="font-weight:700;font-size:11px;color:var(--text2);border-bottom:2px solid var(--border)"><div>#</div><div>Name</div><div>Pos</div><div>Rtg</div><div>Age</div><div></div></div>'
    for (let pi = 0; pi < team.players.length; pi++) {
      const p = team.players[pi]
      const isStarter = pi < 6
      playersHTML += '<div class="se-player-row">' +
        '<div class="se-player-idx">' + (pi + 1) + (isStarter ? '<div class="se-player-starter">S</div>' : '') + '</div>' +
        '<input class="se-input" style="width:100%" value="' + escAttr(p.name) + '" data-ti="' + ti + '" data-pi="' + pi + '" data-field="playerName" onchange="seUpdate(this)">' +
        '<select class="se-select" style="width:60px" data-ti="' + ti + '" data-pi="' + pi + '" data-field="playerPos" onchange="seUpdate(this)">' +
        ['GK','CB','CM','ST'].map(pos => '<option' + (p.position === pos ? ' selected' : '') + '>' + pos + '</option>').join('') +
        '</select>' +
        '<input class="se-input sm" type="number" min="40" max="99" value="' + p.rating + '" data-ti="' + ti + '" data-pi="' + pi + '" data-field="playerRating" onchange="seUpdate(this)">' +
        '<input class="se-input sm" type="number" min="16" max="45" value="' + (p.age || 25) + '" data-ti="' + ti + '" data-pi="' + pi + '" data-field="playerAge" onchange="seUpdate(this)">' +
        '<button class="se-btn danger small" title="Transfer" onclick="seTransfer(' + ti + ',' + pi + ')">\\u21C4</button>' +
        '</div>'
    }
    playersHTML += '</div>'
    body.innerHTML += playersHTML

    panel.appendChild(body)
    container.appendChild(panel)
  }

  // Actions bar
  const actions = h('div','se-actions')
  actions.innerHTML = '<button class="se-btn primary" onclick="seSave()">Save All Changes</button><button class="se-btn success" onclick="go(\\'\\')">Back to Home</button>'
  container.appendChild(actions)
  container.appendChild(statusEl)
  statusEl.id = 'se-status'

  main.appendChild(container)

  // Store editor state globally for event handlers
  window._seState = editorState
  window._seSeasonNum = seasonNum
}

function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;') }

function seUpdate(el) {
  const state = window._seState
  if (!state) return
  const ti = parseInt(el.dataset.ti, 10)
  const team = state.teams[ti]
  const field = el.dataset.field
  const val = el.value

  if (field === 'name') team.name = val
  else if (field === 'abbreviation') team.abbreviation = val || undefined
  else if (field === 'colorPrimary') team.colors.primary = val
  else if (field === 'colorSecondary') team.colors.secondary = val
  else if (field === 'coachName') team.coach.name = val
  else if (field === 'coachRating') team.coach.rating = val
  else if (field === 'coachStyle') team.coach.style = val
  else if (field.startsWith('player')) {
    const pi = parseInt(el.dataset.pi, 10)
    const p = team.players[pi]
    if (field === 'playerName') p.name = val
    else if (field === 'playerPos') p.position = val
    else if (field === 'playerRating') p.rating = val
    else if (field === 'playerAge') p.age = parseInt(val, 10)
  }
}

async function seSave() {
  const state = window._seState
  if (!state) return
  const statusEl = document.getElementById('se-status')

  // Prepare payload with originalName for matching
  const payload = state.teams.map(t => ({
    originalName: t._originalName,
    name: t.name,
    abbreviation: t.abbreviation,
    colors: t.colors,
    rating: t.rating,
    coach: t.coach,
    players: t.players.map(p => ({ name: p.name, position: p.position, rating: p.rating, age: p.age }))
  }))

  statusEl.className = 'se-status show ok'
  statusEl.textContent = 'Saving...'

  try {
    const resp = await fetch('/api/season-editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams: payload })
    })
    const data = await resp.json()
    if (data.success) {
      statusEl.className = 'se-status show ok'
      statusEl.textContent = 'Saved successfully! Site rebuilt.'
      // Update originalNames for subsequent saves
      for (let i = 0; i < state.teams.length; i++) {
        state.teams[i]._originalName = state.teams[i].name
      }
    } else {
      statusEl.className = 'se-status show err'
      statusEl.textContent = 'Error: ' + (data.error || 'Unknown')
    }
  } catch(e) {
    statusEl.className = 'se-status show err'
    statusEl.textContent = 'Error: ' + e.message
  }
}

function seTransfer(ti, pi) {
  const state = window._seState
  if (!state) return
  const team = state.teams[ti]
  const player = team.players[pi]

  // Build transfer modal
  const modal = h('div','se-transfer-modal')
  let optHTML = ''
  for (let i = 0; i < state.teams.length; i++) {
    if (i === ti) continue
    optHTML += '<option value="' + i + '">' + state.teams[i].name + '</option>'
  }
  modal.innerHTML = '<div class="se-transfer-box"><h3>Transfer ' + escAttr(player.name) + '</h3>' +
    '<div style="margin-bottom:12px;font-size:13px;color:var(--text2)">From: ' + escAttr(team.name) + '</div>' +
    '<div style="margin-bottom:12px"><label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Transfer to:</label><select class="se-select" id="se-transfer-target">' + optHTML + '</select></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="se-btn primary" id="se-transfer-confirm">Transfer</button><button class="se-btn" style="background:var(--card2);color:var(--text)" id="se-transfer-cancel">Cancel</button></div></div>'

  document.body.appendChild(modal)

  document.getElementById('se-transfer-cancel').onclick = () => modal.remove()
  document.getElementById('se-transfer-confirm').onclick = async () => {
    const targetIdx = parseInt(document.getElementById('se-transfer-target').value, 10)
    try {
      const resp = await fetch('/api/transfer-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: player.name, fromTeam: team._originalName, toTeam: state.teams[targetIdx]._originalName })
      })
      const data = await resp.json()
      if (data.success) {
        modal.remove()
        // Refresh editor
        go('edit-season/' + window._seSeasonNum)
      } else {
        alert('Error: ' + (data.error || 'Unknown'))
      }
    } catch(e) { alert('Error: ' + e.message) }
  }
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
render()
`
}
