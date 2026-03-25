// ---------------------------------------------------------------------------
// Player Development Module
// Skills evolve each season based on age. Peak around 28-32.
// ---------------------------------------------------------------------------

// Skill aging profiles: how fast each skill develops (young) and declines (old)
const SKILL_PROFILES = {
  speed:           { dev: 1.0, dec: 1.8 },   // peaks early, drops fast
  agility:         { dev: 1.0, dec: 1.5 },
  jumping:         { dev: 1.0, dec: 1.3 },
  strength:        { dev: 0.7, dec: 0.8 },   // peaks late, holds well
  passing:         { dev: 1.2, dec: 0.6 },   // technical, improves with exp
  shooting:        { dev: 1.1, dec: 0.7 },
  tackling:        { dev: 1.0, dec: 1.0 },
  marking:         { dev: 0.9, dec: 0.7 },   // tactical, holds
  head_game:       { dev: 1.3, dec: 0.5 },   // mental, keeps improving
  saving:          { dev: 1.0, dec: 0.9 },
  penalty_taking:  { dev: 0.8, dec: 0.5 },   // experience-based, very stable
  set_piece_taking:{ dev: 1.0, dec: 0.6 }
}

// Position weights for rating delta calculation
const POSITION_WEIGHTS = {
  GK: { saving:.30, agility:.12, jumping:.10, strength:.08, head_game:.10,
        passing:.08, speed:.05, marking:.05, tackling:.04, shooting:.02,
        penalty_taking:.03, set_piece_taking:.03 },
  CB: { tackling:.20, marking:.18, strength:.12, head_game:.10, jumping:.10,
        speed:.08, passing:.08, agility:.06, shooting:.03, saving:.01,
        penalty_taking:.02, set_piece_taking:.02 },
  CM: { passing:.20, head_game:.12, shooting:.12, tackling:.10, agility:.10,
        speed:.08, marking:.08, strength:.06, set_piece_taking:.05, jumping:.04,
        penalty_taking:.03, saving:.02 },
  ST: { shooting:.22, speed:.14, agility:.12, head_game:.10, passing:.08,
        jumping:.08, strength:.08, penalty_taking:.06, set_piece_taking:.05,
        marking:.03, tackling:.02, saving:.02 }
}

function gaussianRandom(mean, stdDev) {
  mean = mean || 0; stdDev = stdDev || 1
  const u1 = Math.random(), u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return z * stdDev + mean
}

// Base skill change per season at a given age
function baseAgeDelta(age) {
  if (age <= 20) return 3.0
  if (age <= 23) return 2.0
  if (age <= 26) return 1.0
  if (age <= 30) return 0.0
  if (age <= 32) return -1.0
  if (age <= 34) return -2.0
  return -3.5
}

// Compute position-weighted rating delta from skill changes
function weightedRatingDelta(position, skillChanges) {
  const weights = POSITION_WEIGHTS[position]
  if (!weights) return 0
  let delta = 0
  for (const [skill, change] of Object.entries(skillChanges)) {
    delta += (change.delta || 0) * (weights[skill] || 0)
  }
  return delta
}

// Generate a deterministic potential for a player based on name hash (0.6 - 1.4)
function playerPotential(player) {
  if (player.potential !== undefined) return player.potential
  // Hash the name for determinism
  let hash = 0
  const name = player.name || ''
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  // Map to 0.6 - 1.4 range
  return 0.6 + (((hash >>> 0) % 80) / 100)
}

// Apply one season of development. Mutates player. Returns change summary.
// potential: 0.6 (low ceiling) to 1.4 (wonderkid). Defaults to name-derived value.
function developPlayer(player, age) {
  if (age === undefined) age = player.age
  const pot = playerPotential(player)
  const base = baseAgeDelta(age)
  const changes = {}
  let totalDelta = 0

  for (const [skill, profile] of Object.entries(SKILL_PROFILES)) {
    const currentVal = parseInt(player.skill[skill] || '50', 10)
    const modifier = base >= 0 ? profile.dev : profile.dec
    // Low skills (<20) develop half as fast (player not training them)
    const lowSkillPenalty = currentVal < 20 && base > 0 ? 0.5 : 1.0
    // High skills (>90) are harder to improve
    const ceilingPenalty = currentVal > 90 && base > 0 ? 0.5 : 1.0
    // Potential scales development (growth and decline both affected, but growth more)
    const potFactor = base >= 0 ? pot : (0.5 + pot * 0.5) // decline less affected by potential
    const delta = Math.round(base * modifier * lowSkillPenalty * ceilingPenalty * potFactor + gaussianRandom(0, 1.2))
    const newVal = Math.max(1, Math.min(99, currentVal + delta))

    if (newVal !== currentVal) {
      changes[skill] = { from: currentVal, to: newVal, delta: newVal - currentVal }
      totalDelta += newVal - currentVal
    }
    player.skill[skill] = String(newVal)
  }

  // Rating: use stored rating as anchor, adjust by weighted skill changes
  const oldRating = parseInt(player.rating, 10)
  const rDelta = Math.round(weightedRatingDelta(player.position, changes))
  const newRating = Math.max(40, Math.min(99, oldRating + rDelta))
  player.rating = String(newRating)

  return {
    name: player.name,
    position: player.position,
    age,
    oldRating,
    newRating,
    ratingDelta: newRating - oldRating,
    changes,
    totalSkillDelta: totalDelta
  }
}

// Non-destructive: get adjusted skills for a player at a specific age
// Anchored from the player's current age and skills. Walks forward or backward.
// Uses player potential to scale adjustments.
function getSkillsAtAge(player, targetAge) {
  const currentAge = player.age
  const pot = playerPotential(player)
  const skill = {}

  for (const [name, profile] of Object.entries(SKILL_PROFILES)) {
    const baseVal = parseInt(player.skill[name] || '50', 10)
    let adjustment = 0

    if (targetAge < currentAge) {
      for (let a = targetAge; a < currentAge; a++) {
        const d = baseAgeDelta(a)
        const potFactor = d >= 0 ? pot : (0.5 + pot * 0.5)
        adjustment -= d * (d >= 0 ? profile.dev : profile.dec) * potFactor
      }
    } else if (targetAge > currentAge) {
      for (let a = currentAge; a < targetAge; a++) {
        const d = baseAgeDelta(a)
        const potFactor = d >= 0 ? pot : (0.5 + pot * 0.5)
        adjustment += d * (d >= 0 ? profile.dev : profile.dec) * potFactor
      }
    }

    skill[name] = String(Math.max(1, Math.min(99, Math.round(baseVal + adjustment))))
  }

  return skill
}

// Get rating for a player at a hypothetical age
// Uses stored rating as anchor and applies weighted skill delta
function getRatingAtAge(player, targetAge) {
  const currentAge = player.age
  const storedRating = parseInt(player.rating, 10)
  const currentSkills = player.skill
  const targetSkills = getSkillsAtAge(player, targetAge)

  const weights = POSITION_WEIGHTS[player.position]
  if (!weights) return storedRating

  let delta = 0
  for (const [s, w] of Object.entries(weights)) {
    delta += (parseInt(targetSkills[s], 10) - parseInt(currentSkills[s] || '50', 10)) * w
  }

  return Math.max(40, Math.min(99, Math.round(storedRating + delta)))
}

module.exports = {
  SKILL_PROFILES,
  POSITION_WEIGHTS,
  playerPotential,
  developPlayer,
  getSkillsAtAge,
  getRatingAtAge,
  baseAgeDelta,
  gaussianRandom
}
